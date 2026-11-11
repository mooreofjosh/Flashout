// Built-in fixture library (converted from grandMA2 library exports by tools/convert_ma2.py).
// Format: { fixtures: [[manufacturer, name, beamType, [[mode, channels, status], ...]], ...] }
// status: 1 = counted from the fixture file, 0 = name only (channel count may be unknown),
//         2 = file and mode name disagreed (larger used, check the manual).

let cache = null;

export async function loadBuiltin() {
  if (cache) return cache;
  const res = await fetch(new URL('../data/ma2-library.json', import.meta.url));
  if (!res.ok) throw new Error('Could not load the built-in library');
  const data = await res.json();
  cache = data.fixtures.map(([manufacturer, name, beam, modes], i) => ({
    i, manufacturer, name, beam, modes,
    hay: `${manufacturer} ${name}`.toLowerCase().replace(/[^a-z0-9 ]/g, ' '),
    compact: `${manufacturer}${name}`.toLowerCase().replace(/[^a-z0-9]/g, ''),
  }));
  return cache;
}

export function searchBuiltin(list, query, limit = 50) {
  const words = query.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
  if (!words.length) return { results: [], total: 0 };
  const hits = [];
  for (const f of list) {
    let score = 0;
    let ok = true;
    for (const w of words) {
      const at = f.hay.indexOf(w);
      if (at >= 0) score += at === 0 || f.hay[at - 1] === ' ' ? 2 : 1;
      else if (f.compact.includes(w)) score += 1;
      else { ok = false; break; }
    }
    if (ok) hits.push([score, f]);
  }
  hits.sort((a, b) => b[0] - a[0] || a[1].name.length - b[1].name.length || a[1].name.localeCompare(b[1].name));
  return { results: hits.slice(0, limit).map((h) => h[1]), total: hits.length };
}

export function fixtureFromBuiltin(f) {
  return {
    name: f.name,
    manufacturer: f.manufacturer,
    source: 'library',
    sourceKey: `ma2:${f.manufacturer}/${f.name}`,
    categories: f.beam ? [f.beam] : [],
    powerW: null,
    weightKg: null,
    connector: '',
    modes: f.modes.map(([name, channels, status]) => ({ name, channels, ...(status !== 1 || !channels ? { check: true } : {}) })),
  };
}
