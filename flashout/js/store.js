// Local data store. Everything lives on this device (localStorage), with JSON backup/restore.

const KEY = 'lighting-prep-v1';

export const DEFAULT_CHECKLISTS = {
  flown: ['Clamps', 'Safeties', 'ID sticker', 'Addressed', 'Power cable', 'Flashed out'],
  ground: ['ID sticker', 'Addressed', 'Power cable', 'Flashed out'],
};

const empty = () => ({
  version: 1,
  fixtureTypes: [],
  gigs: [],
  settings: { checklists: structuredClone(DEFAULT_CHECKLISTS) },
});

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

let state = empty();
let persistent = true;
const listeners = new Set();

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) state = migrate(JSON.parse(raw));
  } catch (e) {
    persistent = false;
    console.warn('Storage unavailable, data will not be saved', e);
  }
  try { navigator.storage?.persist?.(); } catch {}
  return state;
}

function migrate(s) {
  const base = empty();
  const out = { ...base, ...s, settings: { ...base.settings, ...(s.settings || {}) } };
  out.settings.checklists = { ...base.settings.checklists, ...(out.settings.checklists || {}) };
  for (const g of out.gigs) {
    g.fixtures ||= [];
    for (const f of g.fixtures) { f.checks ||= {}; f.faults ||= []; }
  }
  return out;
}

export function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); persistent = true; }
  catch (e) { persistent = false; console.warn('Save failed', e); }
  listeners.forEach((fn) => fn(state));
}

export const isPersistent = () => persistent;
export const getState = () => state;
export const onChange = (fn) => listeners.add(fn);

export function replaceAll(data) {
  if (!data || !Array.isArray(data.gigs) || !Array.isArray(data.fixtureTypes)) {
    throw new Error('This is not a Flashout backup file');
  }
  state = migrate(data);
  save();
}

// ---------- fixture types ----------
export const getType = (id) => state.fixtureTypes.find((t) => t.id === id);

export function addType(t) {
  // Avoid duplicates of the same library fixture
  const dup = t.sourceKey && state.fixtureTypes.find((x) => x.source === t.source && x.sourceKey === t.sourceKey);
  if (dup) return dup;
  const type = { id: uid(), notes: '', ...t };
  state.fixtureTypes.push(type);
  save();
  return type;
}

export function updateType(id, patch) { Object.assign(getType(id), patch); save(); }

export function deleteType(id) {
  state.fixtureTypes = state.fixtureTypes.filter((t) => t.id !== id);
  save();
}

export const typeInUse = (id) => state.gigs.some((g) => g.fixtures.some((f) => f.typeId === id));

// ---------- gigs ----------
export const getGig = (id) => state.gigs.find((g) => g.id === id);

export function addGig(g) {
  const gig = { id: uid(), name: '', venue: '', client: '', date: '', notes: '', created: Date.now(), fixtures: [], ...g };
  state.gigs.unshift(gig);
  save();
  return gig;
}

export function updateGig(id, patch) { Object.assign(getGig(id), patch); save(); }

export function deleteGig(id) { state.gigs = state.gigs.filter((g) => g.id !== id); save(); }

// Copy a gig's rig as a new gig, with prep checks and addresses optionally reset.
export function duplicateGig(id, { keepPatch = true } = {}) {
  const src = getGig(id);
  const copy = structuredClone(src);
  copy.id = uid();
  copy.name = src.name + ' (copy)';
  copy.created = Date.now();
  copy.date = '';
  for (const f of copy.fixtures) {
    f.id = uid();
    f.checks = {};
    f.faults = [];
    if (!keepPatch) { f.universe = null; f.address = null; }
  }
  state.gigs.unshift(copy);
  save();
  return copy;
}

// ---------- rig fixtures ----------
export function addFixtures(gigId, list) {
  const gig = getGig(gigId);
  for (const f of list) {
    gig.fixtures.push({
      id: uid(), typeId: null, modeIndex: 0, unit: '', position: '', rigging: 'flown',
      universe: null, address: null, notes: '', channel: '', purpose: '', colour: '', gobo: '', accessories: '',
      checks: {}, faults: [], ...f,
    });
  }
  save();
}

export const getFixture = (gig, fid) => gig.fixtures.find((f) => f.id === fid);

export function updateFixture(gigId, fid, patch) {
  Object.assign(getFixture(getGig(gigId), fid), patch);
  save();
}

export function deleteFixtures(gigId, ids) {
  const gig = getGig(gigId);
  const set = new Set(ids);
  gig.fixtures = gig.fixtures.filter((f) => !set.has(f.id));
  save();
}
