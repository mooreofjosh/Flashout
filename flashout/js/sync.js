// Sync between devices through the host's per-person document store (claude.ai `db`).
//
// The app always works on the local copy (localStorage). This module mirrors it into the
// signed-in person's private area, data/users/<id>/, and merges changes from other devices.
//
// Data is split into small "units", each with a last-changed time `_t`:
//   settings                         doc "settings"              key "settings"
//   each fixture type                doc "lib-<bucket>"          key <typeId>
//   each gig's details / power       doc "gig-<gigId>"           keys "meta", "power"
//   each fixture in a gig            doc "gfx-<gigId>-<bucket>"  key <fixtureId>
// A document body is { u: { key: value } }. Changed units are written with update(), which
// merges into the stored map, so devices don't overwrite each other's other units. Merging
// is per unit: the newer `_t` wins. Deletions are written as { deleted: true, _t }.
import * as store from './store.js';

const BASE_KEY = 'flashout-sync-base-v1';
const LIB_BUCKETS = 8;
const FX_BUCKETS = 4;
const DEVICE_ONLY_SETTINGS = ['layout'];

const status = { state: 'off', detail: '', lastSync: 0 };
const listeners = new Set();
export const getSyncStatus = () => ({ ...status });
export const onSyncStatus = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const setStatus = (state, detail = '') => {
  status.state = state; status.detail = detail;
  if (state === 'synced') status.lastSync = Date.now();
  listeners.forEach((fn) => fn(getSyncStatus()));
};

let db = null;
let col = null; // the person's private collection
let onRemote = () => {};
let base = new Map(); // unitId -> JSON (without _t) last known to match the store
const known = new Set(); // documents seen in the store
const remote = new Map(); // unitId -> remote value
const dirty = new Map(); // unitId -> { doc, key, value }
const inflight = new Map(); // unitId -> the dirty entry currently being written
const GONE = '"__deleted__"'; // base marker: this unit was deleted and the delete is synced
const deleted = new Map(); // unitId -> when we deleted it (this visit)
const deletedAt = (id) => deleted.get(id) || 0;
const writing = new Map(); // doc -> promise chain
let detectTimer = null;
let retryTimer = null;
let started = false;
let applying = false;

// ---------- helpers ----------
const hash = (s) => { let h = 0; for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h; };
const unitId = (doc, key) => `${doc}|${key}`;
// Comparison form: ignores change times, and treats null like a missing field.
const strip = (v) => JSON.stringify(v, function (k, x) { return k === '_t' || (x === null && !Array.isArray(this)) ? undefined : x; });
// Replace an object's contents in place, so screens holding a reference stay connected.
const replaceInPlace = (target, value) => { for (const k of Object.keys(target)) delete target[k]; Object.assign(target, value); return target; };
// For a merge-update: fields present remotely but gone locally are written as null.
function withRemovals(local, remoteVal) {
  if (!local || typeof local !== 'object' || Array.isArray(local)) return local;
  const out = { ...local };
  if (remoteVal && typeof remoteVal === 'object' && !Array.isArray(remoteVal)) {
    for (const k of Object.keys(remoteVal)) {
      if (!(k in out)) out[k] = null;
      else out[k] = withRemovals(out[k], remoteVal[k]);
    }
  }
  return out;
}
const loadBase = () => { try { base = new Map(Object.entries(JSON.parse(localStorage.getItem(BASE_KEY) || '{}'))); } catch { base = new Map(); } };
const saveBase = () => { try { localStorage.setItem(BASE_KEY, JSON.stringify(Object.fromEntries(base))); } catch { /* sync still works this visit */ } };

// Every syncable unit in the local store, with a reference to the live object.
function localUnits() {
  const s = store.getState();
  const out = new Map();
  // stamp(t) records the change time on the stored data itself, so it survives reloads.
  const add = (doc, key, value, stamp = (t) => { value._t = t; }) => out.set(unitId(doc, key), { doc, key, value, stamp });
  const settings = { ...s.settings };
  DEVICE_ONLY_SETTINGS.forEach((k) => delete settings[k]);
  add('settings', 'settings', settings, (t) => { s.settings._t = t; settings._t = t; });
  for (const t of s.fixtureTypes) add(`lib-${hash(t.id) % LIB_BUCKETS}`, t.id, t);
  for (const g of s.gigs) {
    const { fixtures, power, _tm, ...meta } = g;
    meta._t = _tm;
    add(`gig-${g.id}`, 'meta', meta, (t) => { g._tm = t; meta._t = t; });
    if (power) add(`gig-${g.id}`, 'power', power);
    for (const f of fixtures) add(`gfx-${g.id}-${hash(f.id) % FX_BUCKETS}`, f.id, f);
  }
  return out;
}

// ---------- applying remote units to the local store ----------
function applyUnit(doc, key, value) {
  const s = store.getState();
  const del = !value || value.deleted;
  if (doc === 'settings') {
    if (del) return;
    const keep = Object.fromEntries(DEVICE_ONLY_SETTINGS.map((k) => [k, s.settings[k]]).filter(([, v]) => v !== undefined));
    s.settings = { ...s.settings, ...value, ...keep };
    return;
  }
  if (doc.startsWith('lib-')) {
    const i = s.fixtureTypes.findIndex((t) => t.id === key);
    if (del) { if (i >= 0) s.fixtureTypes.splice(i, 1); return; }
    if (i >= 0) replaceInPlace(s.fixtureTypes[i], structuredClone(value)); else s.fixtureTypes.push(structuredClone(value));
    return;
  }
  if (doc.startsWith('gig-')) {
    const gid = doc.slice(4);
    let g = s.gigs.find((x) => x.id === gid);
    if (key === 'meta') {
      if (del) { s.gigs = s.gigs.filter((x) => x.id !== gid); return; }
      if (!g) { g = { fixtures: [] }; s.gigs.push(g); }
      const { fixtures, power } = g;
      for (const k of Object.keys(g)) delete g[k];
      const { _t, ...rest } = structuredClone(value);
      Object.assign(g, rest, { id: gid, fixtures: fixtures || [], _tm: _t });
      if (power !== undefined) g.power = power;
      s.gigs.sort((a, b) => (b.created || 0) - (a.created || 0));
      return;
    }
    if (key === 'power') {
      if (!g) g = stubGig(gid);
      if (del || !value) delete g.power; else if (g.power) replaceInPlace(g.power, structuredClone(value)); else g.power = structuredClone(value);
    }
    return;
  }
  if (doc.startsWith('gfx-')) {
    const gid = doc.slice(4, doc.lastIndexOf('-'));
    let g = s.gigs.find((x) => x.id === gid);
    if (!g) { if (del) return; g = stubGig(gid); }
    const i = g.fixtures.findIndex((f) => f.id === key);
    if (del) { if (i >= 0) g.fixtures.splice(i, 1); return; }
    const f = structuredClone(value);
    f.checks ||= {}; f.faults ||= [];
    if (i >= 0) replaceInPlace(g.fixtures[i], f); else g.fixtures.push(f);
  }
}

function stubGig(gid) {
  const g = { id: gid, name: 'Syncing…', venue: '', client: '', date: '', notes: '', created: 0, fixtures: [] };
  store.getState().gigs.push(g);
  return g;
}

// Three-way merge of plain objects against the last synced version: a field changed on only
// one side keeps that change; a field changed on both sides takes the newer side's value.
const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);
export function merge3(b, l, r, remoteNewer) {
  if (!isObj(b) || !isObj(l) || !isObj(r)) return remoteNewer ? r : l;
  const out = {};
  for (const k of new Set([...Object.keys(b), ...Object.keys(l), ...Object.keys(r)])) {
    if (k === '_t') continue;
    const bj = JSON.stringify(b[k]), lj = JSON.stringify(l[k]), rj = JSON.stringify(r[k]);
    let v;
    if (lj === rj) v = l[k];
    else if (lj === bj) v = r[k];
    else if (rj === bj) v = l[k];
    else v = isObj(l[k]) && isObj(r[k]) ? merge3(isObj(b[k]) ? b[k] : {}, l[k], r[k], remoteNewer) : (remoteNewer ? r[k] : l[k]);
    if (v !== undefined) out[k] = v;
  }
  out._t = Math.max(l._t || 0, r._t || 0);
  return out;
}

// Merge one remote unit against the local one. Returns true if local data changed.
function mergeUnit(doc, key, rv, locals) {
  const id = unitId(doc, key);
  remote.set(id, rv);
  const lu = locals.get(id);
  const lv = lu?.value;
  const rDeleted = !rv || rv.deleted;
  if (!lu) {
    if (rDeleted) { base.set(id, GONE); dirty.delete(id); return false; }
    // Remote unit we don't have. If our base has it, we deleted it locally: keep the delete
    // unless the remote change is newer than our base snapshot.
    // Unchanged on the other side since we last synced it means we deleted it here: keep the delete.
    if (base.has(id) && base.get(id) === strip(rv)) return false;
    if (base.get(id) === GONE && (rv._t || 0) <= deletedAt(id)) return false;
    applyUnit(doc, key, rv);
    base.set(id, strip(rv));
    return true;
  }
  if (rDeleted) {
    if ((rv?._t || 0) >= (lv._t || 0)) { applyUnit(doc, key, null); base.set(id, GONE); dirty.delete(id); return true; }
    queue(doc, key, lv); // our edit is newer than their delete: keep ours
    return false;
  }
  if (strip(lv) === strip(rv)) { base.set(id, strip(rv)); dirty.delete(id); return false; }
  const b = base.has(id) ? JSON.parse(base.get(id)) : null;
  const localUnchanged = b && strip(lv) === base.get(id);
  if (localUnchanged) { applyUnit(doc, key, rv); base.set(id, strip(rv)); dirty.delete(id); return true; }
  // Both sides changed since the last sync (or we have no record): merge field by field.
  const merged = b ? merge3(b, lv, rv, (rv._t || 0) > (lv._t || 0)) : ((rv._t || 0) > (lv._t || 0) ? rv : lv);
  const changedLocal = strip(merged) !== strip(lv);
  if (changedLocal) applyUnit(doc, key, merged);
  if (strip(merged) !== strip(rv)) {
    base.set(id, strip(rv)); // remote as last known; detect() will see the merge and push it
  } else { base.set(id, strip(rv)); dirty.delete(id); }
  return changedLocal;
}

// ---------- pushing local changes ----------
function queue(doc, key, value) {
  dirty.set(unitId(doc, key), { doc, key, value });
}

// Find local units that changed since they last matched the store, stamp them, and push.
function detect() {
  if (!col || applying) return;
  const locals = localUnits();
  const now = Date.now();
  let stamped = false;
  for (const [id, u] of locals) {
    const j = strip(u.value);
    if (base.get(id) === j) continue;
    u.stamp(now);
    stamped = true;
    queue(u.doc, u.key, u.value);
  }
  for (const [id, b] of base) {
    if (locals.has(id) || b === GONE) continue;
    const [doc, key] = id.split('|');
    queue(doc, key, { deleted: true, _t: now });
  }
  if (stamped) { applying = true; store.save(); applying = false; }
  flush();
}

function flush() {
  const waiting = [...dirty].some(([id, u]) => inflight.get(id) !== u);
  if (!col || !waiting) {
    // nothing new to send (anything left is already on its way)
    if (col && !dirty.size && status.state !== 'error') setStatus(navigator.onLine === false ? 'offline' : 'synced');
    return;
  }
  setStatus('syncing');
  const byDoc = new Map();
  for (const [id, u] of dirty) {
    if (inflight.get(id) === u) continue; // already on its way
    inflight.set(id, u);
    if (!byDoc.has(u.doc)) byDoc.set(u.doc, new Map());
    byDoc.get(u.doc).set(id, u);
  }
  const jobs = [];
  for (const [doc, units] of byDoc) {
    const body = {};
    for (const u of units.values()) body[u.key] = u.value && !u.value.deleted ? JSON.parse(JSON.stringify(u.value)) : { deleted: true, _t: u.value?._t || Date.now() };
    const prev = writing.get(doc) || Promise.resolve();
    const job = prev.then(() => writeDoc(doc, body)).then((written) => {
      for (const [id, u] of units) {
        if (dirty.get(id) === u) dirty.delete(id);
        const v = written[u.key];
        if (v && !v.deleted) base.set(id, strip(v)); else { base.set(id, GONE); deleted.set(id, v?._t || Date.now()); }
      }
    }).finally(() => { for (const [id, u] of units) if (inflight.get(id) === u) inflight.delete(id); });
    writing.set(doc, job.catch(() => {}));
    jobs.push(job);
  }
  Promise.allSettled(jobs).then((rs) => {
    saveBase();
    const failed = rs.find((r) => r.status === 'rejected');
    if (failed) {
      const code = failed.reason?.code;
      if (code === 'quota_exceeded') setStatus('error', 'Sync storage is full. Delete old gigs to free space.');
      else if (code === 'revoked' || code === 'not_granted' || code === 'capability_disabled') { setStatus('unavailable', 'Sync is not available here.'); col = null; }
      else setStatus('offline', 'Changes are saved on this device and will sync when the connection is back.');
      clearTimeout(retryTimer);
      retryTimer = setTimeout(flush, 15000);
    } else setStatus(dirty.size ? 'syncing' : 'synced');
  });
}

// Write units to one document: read the latest stored version first and merge field by field
// with anything another device changed since we last synced, then merge-update.
async function writeDoc(doc, units) {
  const ref = col.doc(doc);
  const snap = await ref.get();
  const cur = (snap.exists && snap.data()?.u) || {};
  let localChanged = false;
  for (const [key, val] of Object.entries(units)) {
    const id = unitId(doc, key);
    const r = cur[key];
    if (!r || val?.deleted) continue;
    const b = base.get(id);
    if (b === undefined || strip(r) === b || strip(r) === strip(val)) continue;
    if (r.deleted) continue; // our edit wins over a delete made before it
    const merged = merge3(JSON.parse(b), val, r, (r._t || 0) > (val._t || 0));
    merged._t = Math.max(val._t || 0, r._t || 0, Date.now());
    if (strip(merged) !== strip(val)) { applying = true; applyUnit(doc, key, merged); applying = false; localChanged = true; }
    units[key] = merged;
  }
  const body = {};
  for (const [key, val] of Object.entries(units)) body[key] = val?.deleted ? val : withRemovals(val, cur[key]);
  if (snap.exists) await ref.update({ u: body });
  else await ref.set({ u: body });
  known.add(doc);
  if (localChanged) { applying = true; store.save(); applying = false; onRemote(); }
  return units;
}

// ---------- start ----------
export async function startSync({ onRemoteChange } = {}) {
  if (started) return;
  started = true;
  onRemote = onRemoteChange || (() => {});
  if (!window.claude?.use) { setStatus('unavailable', 'Sync works when Flashout is opened in claude.ai.'); return; }
  setStatus('connecting');
  const [dbNs, user] = await Promise.all([
    Promise.resolve(window.claude.use('db')).catch(() => null),
    Promise.resolve(window.claude.use('user')).catch(() => null),
  ]);
  const uid = user ? await user.id() : null;
  if (!dbNs || !uid) { setStatus('signedout', 'Sign in to Claude to sync between your devices.'); return; }
  db = dbNs;
  loadBase();
  col = db.collection(`data/users/${uid}`);

  let first = true;
  const timeout = setTimeout(() => { if (first) setStatus('offline', "Can't reach sync yet. Working on this device's copy."); }, 10000);
  col.onSnapshot((snap) => {
    const locals = localUnits();
    let changed = false;
    applying = true;
    const docs = first ? snap.docs : snap.docChanges().filter((c) => c.type !== 'removed').map((c) => c.doc);
    // gig details first, so fixtures land in a gig that exists
    const ordered = [...docs].sort((a, b) => (a.id.startsWith('gig-') ? 0 : 1) - (b.id.startsWith('gig-') ? 0 : 1));
    for (const d of ordered) {
      known.add(d.id);
      const u = d.data()?.u || {};
      for (const [key, rv] of Object.entries(u)) {
        const prev = remote.get(unitId(d.id, key));
        if (!first && prev && strip(prev) === strip(rv) && (prev._t || 0) === (rv?._t || 0)) continue;
        if (mergeUnit(d.id, key, rv, locals)) changed = true;
      }
    }
    if (changed) store.save();
    applying = false;
    if (first && !snap.metadata.fromCache) {
      first = false;
      clearTimeout(timeout);
      // Local units the store has never seen: push them.
      for (const [id, u] of localUnits()) if (!remote.has(id) && !base.has(id)) queue(u.doc, u.key, u.value);
    }
    saveBase();
    if (changed) onRemote();
    detect();
  }, (err) => {
    clearTimeout(timeout);
    setStatus(err?.code === 'revoked' ? 'unavailable' : 'offline', 'Sync stopped. Your changes are safe on this device; reopen Flashout to reconnect.');
  });

  store.onChange(() => {
    if (applying) return;
    clearTimeout(detectTimer);
    detectTimer = setTimeout(detect, 700);
  });
  window.addEventListener('online', () => flush());
  window.addEventListener('offline', () => setStatus('offline', 'Offline. Changes are saved on this device and will sync when the connection is back.'));
}

export function syncNow() { detect(); }
