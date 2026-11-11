// Patch & DMX logic. Pure functions: no DOM, no storage.

export const UNIVERSE_SIZE = 512;

// Natural sort for unit numbers like "2", "10", "101A".
export const naturalCompare = (a, b) =>
  String(a ?? '').localeCompare(String(b ?? ''), undefined, { numeric: true, sensitivity: 'base' });

export function footprint(fixture, getType) {
  const type = getType(fixture.typeId);
  const mode = type?.modes?.[fixture.modeIndex];
  return Math.max(0, mode?.channels || 0);
}

export const isPatched = (f) => Number.isInteger(f.universe) && Number.isInteger(f.address);

export const absoluteAddress = (u, a) => (u - 1) * UNIVERSE_SIZE + a;

export const formatAddress = (f) =>
  isPatched(f) ? `${f.universe}.${String(f.address).padStart(3, '0')}` : '—';

// Parse "2.101", "2/101", or an absolute address "613" into {universe, address}.
export function parseAddress(text) {
  const t = String(text).trim();
  if (!t) return null;
  const m = t.match(/^(\d+)\s*[./:\s]\s*(\d+)$/);
  if (m) return { universe: +m[1], address: +m[2] };
  if (/^\d+$/.test(t)) {
    const abs = +t;
    if (abs < 1) return null;
    return { universe: Math.floor((abs - 1) / UNIVERSE_SIZE) + 1, address: ((abs - 1) % UNIVERSE_SIZE) + 1 };
  }
  return null;
}

// Assign addresses in order, without overlapping fixtures outside the set.
// Fixtures never split across universes. `gap` adds spare channels after each fixture.
export function autoAddress(toPatch, allFixtures, getType, { universe = 1, address = 1, gap = 0 } = {}) {
  const moving = new Set(toPatch.map((f) => f.id));
  const occupied = new Map(); // universe -> [[start, end]]
  for (const f of allFixtures) {
    if (moving.has(f.id) || !isPatched(f)) continue;
    const fp = footprint(f, getType);
    if (!fp) continue;
    if (!occupied.has(f.universe)) occupied.set(f.universe, []);
    occupied.get(f.universe).push([f.address, f.address + fp - 1]);
  }

  const result = [];
  let u = universe;
  let a = address;
  for (const f of toPatch) {
    const fp = footprint(f, getType);
    if (!fp) { result.push({ id: f.id, universe: null, address: null, skipped: 'No channel count for this mode' }); continue; }
    if (fp > UNIVERSE_SIZE) { result.push({ id: f.id, universe: null, address: null, skipped: 'Footprint larger than a universe' }); continue; }
    let guard = 0;
    while (true) {
      if (a + fp - 1 > UNIVERSE_SIZE) { u += 1; a = 1; }
      const clash = (occupied.get(u) || []).find(([s, e]) => a <= e && a + fp - 1 >= s);
      if (!clash) break;
      a = clash[1] + 1;
      if (++guard > 100000) throw new Error('Could not find free addresses');
    }
    result.push({ id: f.id, universe: u, address: a });
    if (!occupied.has(u)) occupied.set(u, []);
    occupied.get(u).push([a, a + fp - 1]);
    a += fp + gap;
  }
  return result;
}

// Problems with the current patch.
export function findIssues(fixtures, getType) {
  const issues = [];
  const byUniverse = new Map();
  for (const f of fixtures) {
    const fp = footprint(f, getType);
    if (!getType(f.typeId)) issues.push({ level: 'error', ids: [f.id], text: `Unit ${f.unit || '?'}: fixture type missing from library` });
    else if (!fp) issues.push({ level: 'warn', ids: [f.id], text: `Unit ${f.unit || '?'}: mode has no channel count` });
    if (!isPatched(f)) continue;
    const end = f.address + Math.max(fp, 1) - 1;
    if (f.universe < 1 || f.address < 1 || end > UNIVERSE_SIZE) {
      issues.push({ level: 'error', ids: [f.id], text: `Unit ${f.unit || '?'} at ${formatAddress(f)} runs past channel 512 (needs ${fp} ch)` });
    }
    if (!byUniverse.has(f.universe)) byUniverse.set(f.universe, []);
    byUniverse.get(f.universe).push({ f, start: f.address, end });
  }

  for (const [u, list] of byUniverse) {
    list.sort((x, y) => x.start - y.start);
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length && list[j].start <= list[i].end; j++) {
        const A = list[i].f, B = list[j].f;
        issues.push({
          level: 'error', ids: [A.id, B.id],
          text: `Universe ${u}: unit ${A.unit || '?'} (${formatAddress(A)}) overlaps unit ${B.unit || '?'} (${formatAddress(B)})`,
        });
      }
    }
  }

  const seen = new Map();
  for (const f of fixtures) {
    const k = String(f.unit ?? '').trim();
    if (!k) continue;
    if (!seen.has(k)) seen.set(k, []);
    seen.get(k).push(f.id);
  }
  for (const [k, ids] of seen) if (ids.length > 1) issues.push({ level: 'warn', ids, text: `Unit number ${k} used ${ids.length} times` });

  const unpatched = fixtures.filter((f) => !isPatched(f));
  if (unpatched.length) issues.push({ level: 'info', ids: unpatched.map((f) => f.id), text: `${unpatched.length} fixture${unpatched.length > 1 ? 's' : ''} not patched yet` });
  return issues;
}

// Universe usage summary: { universe, used, fixtures }
export function universeSummary(fixtures, getType) {
  const map = new Map();
  for (const f of fixtures) {
    if (!isPatched(f)) continue;
    const s = map.get(f.universe) || { universe: f.universe, used: 0, fixtures: 0 };
    s.used += footprint(f, getType);
    s.fixtures += 1;
    map.set(f.universe, s);
  }
  return [...map.values()].sort((a, b) => a.universe - b.universe);
}

const csvCell = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function patchCSV(fixtures, getType) {
  const head = ['Unit', 'Fixture', 'Manufacturer', 'Mode', 'Channels', 'Universe', 'Address', 'Absolute Address', 'Position', 'Rigging', 'Notes'];
  const rows = fixtures.map((f) => {
    const t = getType(f.typeId);
    const m = t?.modes?.[f.modeIndex];
    const p = isPatched(f);
    return [
      f.unit, t?.name, t?.manufacturer, m?.name, m?.channels,
      p ? f.universe : '', p ? f.address : '', p ? absoluteAddress(f.universe, f.address) : '',
      f.position, f.rigging, f.notes,
    ];
  });
  return [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
}
