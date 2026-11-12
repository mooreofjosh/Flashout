// Power distribution maths (UK/EU 230/400V). Pure functions: no DOM, no storage.

export const PHASES = ['L1', 'L2', 'L3'];
export const WARN_PCT = 0.8; // continuous-load planning limit

export const DEFAULT_POWER = () => ({ voltage: 230, pf: 0.9, distros: [] });

const id = () => Math.random().toString(36).slice(2, 10);

// Distro presets. Three-phase outputs rotate L1, L2, L3 so neighbouring circuits spread the load.
export const VIA = ['10A', 'Socapex', 'Wieland', '16A', '32A'];
export const MULTICORE = { Socapex: { circuits: 6, short: 'Soca' }, Wieland: { circuits: 4, short: 'Wieland' } };
export const isMulticore = (c) => !!MULTICORE[c.via];
// Cable identity: a multicore run is shared by its circuits; anything else is one cable per circuit.
export const runKey = (d, c) => (isMulticore(c) ? `${d.id}:${c.via}:${c.run || c.id}` : `${d.id}:${c.id}`);

export const TEMPLATES = [
  { key: '32-3-12x10-soca', label: '32A 3-phase → 12 × 10A on 2 × Socapex', supply: '3ph', ratingA: 32, outputs: 12, outA: 10, via: 'Socapex', runSize: 6, runName: 'Soca' },
  { key: '32-3-12x10-wieland', label: '32A 3-phase → 12 × 10A on 3 × Wieland', supply: '3ph', ratingA: 32, outputs: 12, outA: 10, via: 'Wieland', runSize: 4, runName: 'Wieland' },
  { key: '32-3-12x10', label: '32A 3-phase → 12 × 10A outlets', supply: '3ph', ratingA: 32, outputs: 12, outA: 10, via: '10A' },
  { key: '63-3-18', label: '63A 3-phase → 18 × 16A', supply: '3ph', ratingA: 63, outputs: 18, outA: 16 },
  { key: '63-3-6x32', label: '63A 3-phase → 6 × 32A', supply: '3ph', ratingA: 63, outputs: 6, outA: 32 },
  { key: '32-3-6', label: '32A 3-phase → 6 × 16A', supply: '3ph', ratingA: 32, outputs: 6, outA: 16 },
  { key: '125-3-6x32', label: '125A 3-phase → 6 × 32A + 6 × 16A', supply: '3ph', ratingA: 125, outputs: 12, outA: [32, 32, 32, 32, 32, 32, 16, 16, 16, 16, 16, 16] },
  { key: '32-1-2', label: '32A single-phase → 2 × 16A', supply: '1ph', ratingA: 32, outputs: 2, outA: 16 },
  { key: '16-1-1', label: '16A single-phase socket', supply: '1ph', ratingA: 16, outputs: 1, outA: 16 },
];

// Name multicore runs: "Soca 1" for circuits 1-6, "Soca 2" for 7-12, ...
export const runFor = (i, runSize, runName) => (runSize ? `${runName || 'Run'} ${Math.floor(i / runSize) + 1}` : '');

export function makeDistro({ name, supply = '3ph', ratingA = 63, outputs = 18, outA = 16, via = '', runSize = 0, runName = '' }) {
  const circuits = Array.from({ length: outputs }, (_, i) => {
    const rating = Array.isArray(outA) ? outA[i] : outA;
    return {
      id: id(),
      label: String(i + 1),
      phase: supply === '3ph' ? PHASES[i % 3] : 'L1',
      ratingA: rating,
      via: via || (rating <= 10 ? '10A' : rating <= 16 ? '16A' : '32A'),
      run: runFor(i, runSize, runName),
    };
  });
  return { id: id(), name, supply, ratingA, circuits };
}

export const makeCircuit = (label, phase = 'L1', ratingA = 10, via = '10A', run = '') => ({ id: id(), label, phase, ratingA, via, run });

export const amps = (watts, power) => watts / ((power.voltage || 230) * (power.pf || 1));

// Power connectors a fixture can have.
export const POWER_IN = ['10A plug', 'powerCON', 'powerCON TRUE1', 'IEC', '16A', 'Hardwired'];

// A fixture's draw: the type's stated current wins (rated at 230V, scaled to the gig voltage);
// otherwise work it out from watts.
export function fixtureAmps(f, getType, power) {
  const t = getType(f.typeId);
  if (!t) return 0;
  if (t.currentA) return t.currentA * (230 / (power.voltage || 230));
  return t.powerW ? amps(t.powerW, power) : 0;
}
export function fixtureWatts(f, getType, power = { voltage: 230, pf: 1 }) {
  const t = getType(f.typeId);
  if (!t) return 0;
  return t.powerW || (t.currentA ? Math.round(t.currentA * (power.voltage || 230) * (power.pf || 1)) : 0);
}
export const hasPowerSpec = (t) => !!(t && (t.powerW || t.currentA));

// How many of this type fit on one circuit under the warning limit (and the link limit, if any).
export function perCircuit(type, ratingA, power) {
  const a = type.currentA ? type.currentA * (230 / (power.voltage || 230)) : type.powerW ? amps(type.powerW, power) : 0;
  if (!a) return null;
  let n = Math.floor((ratingA * WARN_PCT) / a);
  if (type.linkMax) n = Math.min(n, type.linkMax);
  return Math.max(0, n);
}

// Where is each circuit? circuitId -> { distro, circuit }
export function circuitIndex(power) {
  const map = new Map();
  for (const d of power.distros) for (const c of d.circuits) map.set(c.id, { distro: d, circuit: c });
  return map;
}

// Full load picture for a gig.
export function analyse(fixtures, power, getType) {
  const index = circuitIndex(power);
  const circuits = new Map(); // id -> { watts, amps, fixtures: [] }
  for (const [cid] of index) circuits.set(cid, { watts: 0, amps: 0, fixtures: [] });
  const unassigned = [];
  const noWatts = [];
  for (const f of fixtures) {
    const w = fixtureWatts(f, getType, power);
    if (!hasPowerSpec(getType(f.typeId))) noWatts.push(f);
    const slot = f.circuit && circuits.get(f.circuit);
    if (!slot) { unassigned.push(f); continue; }
    slot.watts += w;
    slot.amps += fixtureAmps(f, getType, power);
    slot.fixtures.push(f);
  }

  const distros = power.distros.map((d) => {
    const phases = Object.fromEntries((d.supply === '3ph' ? PHASES : ['L1']).map((p) => [p, 0]));
    let watts = 0;
    for (const c of d.circuits) {
      const s = circuits.get(c.id);
      phases[c.phase in phases ? c.phase : 'L1'] += s.amps;
      watts += s.watts;
    }
    const vals = Object.values(phases);
    const max = Math.max(...vals);
    const min = Math.min(...vals);
    const imbalance = d.supply === '3ph' && max > 0 ? (max - min) / max : 0;
    // Worth flagging only when it's a real difference in amps, not just a % on a light load.
    const unbalanced = imbalance > 0.25 && max - min >= 5;
    return { distro: d, phases, watts, maxPhase: max, imbalance, unbalanced };
  });

  const totalWatts = fixtures.reduce((s, f) => s + fixtureWatts(f, getType, power), 0);
  const totalAmps = fixtures.reduce((s, f) => s + fixtureAmps(f, getType, power), 0);
  return { circuits, distros, unassigned, noWatts, totalWatts, totalAmps };
}

export function powerIssues(a, power, getType) {
  const issues = [];
  for (const { distro: d, phases, imbalance, unbalanced } of a.distros) {
    for (const c of d.circuits) {
      const s = a.circuits.get(c.id);
      const pct = s.amps / c.ratingA;
      if (pct > 1) issues.push({ level: 'error', text: `${d.name} circuit ${c.label}: ${s.amps.toFixed(1)}A on a ${c.ratingA}A circuit (overloaded)` });
      else if (pct > WARN_PCT) issues.push({ level: 'warn', text: `${d.name} circuit ${c.label}: ${Math.round(pct * 100)}% of ${c.ratingA}A` });
    }
    for (const [p, A] of Object.entries(phases)) {
      const pct = A / d.ratingA;
      if (pct > 1) issues.push({ level: 'error', text: `${d.name} ${d.supply === '3ph' ? p : 'supply'}: ${A.toFixed(1)}A on a ${d.ratingA}A supply (overloaded)` });
      else if (pct > WARN_PCT) issues.push({ level: 'warn', text: `${d.name} ${d.supply === '3ph' ? p : 'supply'}: ${Math.round(pct * 100)}% of ${d.ratingA}A` });
    }
    if (unbalanced) issues.push({ level: 'warn', text: `${d.name}: phases unbalanced by ${Math.round(imbalance * 100)}%` });
  }
  const types = new Map();
  for (const f of a.noWatts) { const t = getType(f.typeId); if (t) types.set(t.id, t); }
  for (const t of types.values()) issues.push({ level: 'warn', text: `${t.name}: no power specs, so it counts as 0A`, typeId: t.id });
  // Link limits: more units of a type on one circuit than its power-out allows.
  for (const { distro: d } of a.distros) {
    for (const c of d.circuits) {
      const per = new Map();
      for (const f of a.circuits.get(c.id).fixtures) per.set(f.typeId, (per.get(f.typeId) || 0) + 1);
      for (const [tid, n] of per) {
        const t = getType(tid);
        if (t?.linkMax && n > t.linkMax) issues.push({ level: 'warn', text: `${d.name} circuit ${c.label}: ${n} × ${t.name}, but it links ${t.linkMax} max. Needs more than one feed` });
      }
    }
  }
  if (a.unassigned.length) issues.push({ level: 'info', text: `${a.unassigned.length} fixture${a.unassigned.length > 1 ? 's' : ''} not on a circuit yet` });
  return issues;
}

// Put unassigned fixtures on circuits.
// 1. Split each position into even, circuit-sized groups (fixtures in a position stay together).
// 2. Place the biggest groups first, each on an empty circuit on the least-loaded phase (by % of supply).
// 3. Anything left over goes fixture by fixture onto any circuit with room.
// Stays under the warning limit on circuits and phases. Returns { assigned: Map(fid->cid), skipped: [] }.
export function autoAssign(fixtures, power, getType, { onlyIds = null, distroId = null } = {}) {
  const a = analyse(fixtures, power, getType);
  const distros = power.distros.filter((d) => !distroId || d.id === distroId);
  const circuits = distros.flatMap((d) => d.circuits.map((c) => ({ d, c })));
  const assigned = new Map();
  const skipped = [];
  if (!circuits.length) return { assigned, skipped: a.unassigned.map((f) => ({ f, why: 'no circuit with room' })) };

  const load = new Map(circuits.map(({ c }) => [c.id, a.circuits.get(c.id).amps]));
  const used = new Set(circuits.filter(({ c }) => a.circuits.get(c.id).fixtures.length).map(({ c }) => c.id));
  const phaseKey = (d, c) => `${d.id}:${d.supply === '3ph' ? c.phase : 'L1'}`;
  const phaseLoad = new Map();
  for (const { d, c } of circuits) phaseLoad.set(phaseKey(d, c), (phaseLoad.get(phaseKey(d, c)) || 0) + load.get(c.id));
  const phasePct = (d, c, extra = 0) => (phaseLoad.get(phaseKey(d, c)) + extra) / d.ratingA;
  const fits = ({ d, c }, need) => load.get(c.id) + need <= c.ratingA * WARN_PCT && phasePct(d, c, need) <= WARN_PCT;
  const place = (fs, slot, need) => {
    for (const f of fs) assigned.set(f.id, slot.c.id);
    load.set(slot.c.id, load.get(slot.c.id) + need);
    phaseLoad.set(phaseKey(slot.d, slot.c), phaseLoad.get(phaseKey(slot.d, slot.c)) + need);
    used.add(slot.c.id);
  };

  const todo = [];
  for (const f of a.unassigned) {
    if (onlyIds && !onlyIds.has(f.id)) continue;
    if (!hasPowerSpec(getType(f.typeId))) skipped.push({ f, why: 'no wattage' });
    else todo.push(f);
  }
  const need = (f) => fixtureAmps(f, getType, power);
  const byUnit = (x, y) => String(x.unit).localeCompare(String(y.unit), undefined, { numeric: true });

  // Typical circuit size decides group size.
  const ratings = circuits.map(({ c }) => c.ratingA).sort((x, y) => x - y);
  const cap = ratings[Math.floor(ratings.length / 2)] * WARN_PCT;

  const threePhase = distros.some((d) => d.supply === '3ph');
  const groups = [];
  const byPos = new Map();
  for (const f of todo) { const k = f.position || ''; if (!byPos.has(k)) byPos.set(k, []); byPos.get(k).push(f); }
  for (const list of byPos.values()) {
    list.sort(byUnit);
    const total = list.reduce((s, f) => s + need(f), 0);
    let k = Math.max(1, Math.ceil(total / cap));
    // On 3-phase, split into a multiple of 3 groups when there are enough fixtures, so phases stay even.
    if (threePhase && list.length >= 3) k = Math.min(list.length, Math.ceil(k / 3) * 3);
    const target = total / k;
    let cur = [];
    let curA = 0;
    let made = 0;
    for (const f of list) {
      const n = need(f);
      const remainingGroups = k - made;
      if (cur.length && remainingGroups > 1 && (curA + n > cap || curA + n / 2 > target)) {
        groups.push({ fs: cur, amps: curA }); made++; cur = []; curA = 0;
      }
      cur.push(f); curA += n;
    }
    if (cur.length) groups.push({ fs: cur, amps: curA });
  }
  groups.sort((x, y) => y.amps - x.amps);

  // Which positions each multicore run already feeds.
  const runPos = new Map();
  const notePos = (slot, pos) => { const k = runKey(slot.d, slot.c); if (!runPos.has(k)) runPos.set(k, new Set()); runPos.get(k).add(pos); };
  for (const slot of circuits) for (const f of a.circuits.get(slot.c.id).fixtures) notePos(slot, f.position || '');
  // 0 = run already feeds this position, 1 = unused run, 2 = would mix positions on one run
  const runFit = (slot, pos) => {
    if (!isMulticore(slot.c)) return 1;
    const set = runPos.get(runKey(slot.d, slot.c));
    if (!set || !set.size) return 1;
    return set.has(pos) && set.size === 1 ? 0 : 2;
  };

  const leftovers = [];
  for (const g of groups) {
    let best = null;
    const pos = g.fs[0].position || '';
    for (const slot of circuits) {
      if (used.has(slot.c.id) || !fits(slot, g.amps)) continue;
      // keep runs to one position, then lightest phase, then smallest circuit that fits
      const score = runFit(slot, pos) * 1e6 + phasePct(slot.d, slot.c, g.amps) * 1000 + slot.c.ratingA;
      if (!best || score < best.score) best = { slot, score };
    }
    if (best) { place(g.fs, best.slot, g.amps); notePos(best.slot, pos); }
    else leftovers.push(...g.fs);
  }

  for (const f of leftovers.sort(byUnit)) {
    const n = need(f);
    let best = null;
    for (const slot of circuits) {
      if (!fits(slot, n)) continue;
      const samePos = fixtures.some((x) => (assigned.get(x.id) || (x.circuit === slot.c.id && x.circuit)) === slot.c.id && (x.position || '') === (f.position || ''));
      const score = (samePos ? 0 : 1) * 2e6 + runFit(slot, f.position || '') * 1e6 + phasePct(slot.d, slot.c, n) * 1000 + load.get(slot.c.id);
      if (!best || score < best.score) best = { slot, score };
    }
    if (best) { place([f], best.slot, n); notePos(best.slot, f.position || ''); }
    else skipped.push({ f, why: 'no circuit with room' });
  }
  return { assigned, skipped };
}

// Multicore cable count: Socapex / Wieland runs in use, one breakout per run.
export function cableCount(fixtures, power) {
  const fixturesOn = new Map();
  for (const f of fixtures) if (f.circuit) { if (!fixturesOn.has(f.circuit)) fixturesOn.set(f.circuit, []); fixturesOn.get(f.circuit).push(f); }
  const runs = new Map();
  for (const d of power.distros) {
    for (const c of d.circuits) {
      if (!isMulticore(c)) continue;
      const k = runKey(d, c);
      if (!runs.has(k)) runs.set(k, { distro: d, via: c.via, name: c.run || `${MULTICORE[c.via].short} (circuit ${c.label})`, circuits: [], used: 0, positions: new Set() });
      const r = runs.get(k);
      r.circuits.push(c);
      const on = fixturesOn.get(c.id) || [];
      if (on.length) r.used++;
      for (const f of on) r.positions.add(f.position || 'No position');
    }
  }
  const list = [...runs.values()];
  const totals = {};
  for (const r of list) {
    if (!r.used) continue;
    const t = (totals[r.via] ||= { runs: 0, breakouts: 0 });
    t.runs++;
    t.breakouts++;
  }
  const warnings = [];
  for (const r of list) {
    if (r.used && r.positions.size > 1) warnings.push(`${r.distro.name} ${r.name} feeds ${[...r.positions].join(' and ')}. It needs to reach both, or move fixtures`);
    if (r.circuits.length > MULTICORE[r.via].circuits) warnings.push(`${r.distro.name} ${r.name} has ${r.circuits.length} circuits, but a ${r.via} carries ${MULTICORE[r.via].circuits}`);
  }
  return { runs: list, totals, warnings };
}

// Resistor colour code, used to colour multicore runs: run 1 brown, 2 red, 3 orange...
export const RESISTOR = [
  { name: 'Black', bg: '#111111', fg: '#ffffff' },
  { name: 'Brown', bg: '#7a4419', fg: '#ffffff' },
  { name: 'Red', bg: '#d42a2a', fg: '#ffffff' },
  { name: 'Orange', bg: '#ff8a1f', fg: '#111111' },
  { name: 'Yellow', bg: '#ffd83a', fg: '#111111' },
  { name: 'Green', bg: '#1f9d4c', fg: '#ffffff' },
  { name: 'Blue', bg: '#2563eb', fg: '#ffffff' },
  { name: 'Violet', bg: '#8b3fd9', fg: '#ffffff' },
  { name: 'Grey', bg: '#8f959e', fg: '#111111' },
  { name: 'White', bg: '#ffffff', fg: '#111111' },
];

// Run number for a multicore circuit: the number in its run name ("Soca 2" -> 2),
// otherwise its order among the distro's runs of that type.
export function runNumber(distro, circuit) {
  if (!isMulticore(circuit)) return null;
  const m = String(circuit.run || '').match(/(\d+)\s*$/);
  if (m) return +m[1];
  const seen = [];
  for (const c of distro.circuits) {
    if (c.via !== circuit.via) continue;
    const k = c.run || c.id;
    if (!seen.includes(k)) seen.push(k);
    if (c === circuit) break;
  }
  return seen.length;
}

export function runColour(distro, circuit) {
  const n = runNumber(distro, circuit);
  return n == null ? null : RESISTOR[n % 10];
}

// "101, 102, 103, 105" -> "101–103, 105"
export function unitRanges(units) {
  const nums = units.map((u) => String(u));
  const out = [];
  let i = 0;
  while (i < nums.length) {
    let j = i;
    while (j + 1 < nums.length && /^\d+$/.test(nums[j]) && /^\d+$/.test(nums[j + 1]) && +nums[j + 1] === +nums[j] + 1) j++;
    out.push(j - i >= 2 ? `${nums[i]}–${nums[j]}` : nums.slice(i, j + 1).join(', '));
    i = j + 1;
  }
  return out.join(', ');
}
