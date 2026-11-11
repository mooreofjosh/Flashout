// Fixture type sources: Open Fixture Library (JSON / live API) and GDTF files.
import { readZip } from './zip.js';

const OFL = 'https://open-fixture-library.org';

const titleCase = (s) => s.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

// ---------- Open Fixture Library ----------

// Count channels in an OFL mode, expanding matrix inserts where possible.
function oflModeChannels(mode, fixture) {
  let count = 0;
  const pixelKeys = oflPixelKeys(fixture);
  for (const ch of mode.channels || []) {
    if (ch && typeof ch === 'object' && ch.insert === 'matrixChannels') {
      let repeat = 0;
      if (Array.isArray(ch.repeatFor)) repeat = ch.repeatFor.length;
      else if (typeof ch.repeatFor === 'string' && ch.repeatFor.startsWith('eachPixel')) repeat = pixelKeys.length;
      else if (ch.repeatFor === 'eachPixelGroup') repeat = Object.keys(fixture.matrix?.pixelGroups || {}).length;
      count += repeat * (ch.templateChannels || []).length;
    } else {
      count += 1; // channel key or null (unused channel)
    }
  }
  return count;
}

function oflPixelKeys(fixture) {
  const m = fixture.matrix;
  if (!m) return [];
  if (m.pixelCount) {
    const [x = 1, y = 1, z = 1] = m.pixelCount;
    return Array.from({ length: x * y * z }, (_, i) => String(i));
  }
  if (m.pixelKeys) return m.pixelKeys.flat(2).filter((k) => k !== null);
  return [];
}

export function fixtureFromOFL(json, key = '') {
  const [manKey] = key.split('/');
  const physical = json.physical || {};
  return {
    name: json.name || titleCase(key.split('/')[1] || 'Fixture'),
    manufacturer: json.manufacturer || (manKey ? titleCase(manKey) : ''),
    source: 'ofl',
    sourceKey: key,
    categories: json.categories || [],
    powerW: physical.power ?? null,
    weightKg: physical.weight ?? null,
    connector: physical.DMXconnector || '',
    modes: (json.modes || []).map((m) => ({
      name: m.name || m.shortName || 'Mode',
      shortName: m.shortName || '',
      channels: oflModeChannels(m, json),
    })),
  };
}

export async function searchOFL(query) {
  const res = await fetch(`${OFL}/api/v1/get-search-results`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ searchQuery: query, manufacturersQuery: [], categoriesQuery: [] }),
  });
  if (!res.ok) throw new Error('Search failed (' + res.status + ')');
  return res.json(); // array of "manufacturer/fixture" keys
}

export async function fetchOFL(key) {
  const res = await fetch(`${OFL}/${key}.json`);
  if (!res.ok) throw new Error('Could not load ' + key + ' (' + res.status + ')');
  return fixtureFromOFL(await res.json(), key);
}

export function oflPageUrl(key) { return `${OFL}/${key}`; }

// ---------- GDTF ----------

function parseXml(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('Could not read XML in file');
  return doc;
}

// Highest DMX offset used in break 1 of a mode, including geometry references.
function gdtfModeFootprint(modeEl, ft) {
  const refsByGeometry = new Map();
  for (const ref of ft.getElementsByTagName('GeometryReference')) {
    const target = ref.getAttribute('Geometry');
    const breaks = [...ref.getElementsByTagName('Break')].map((b) => ({
      brk: +b.getAttribute('DMXBreak') || 1,
      offset: +b.getAttribute('DMXOffset') || 1,
    }));
    if (!refsByGeometry.has(target)) refsByGeometry.set(target, []);
    refsByGeometry.get(target).push(breaks);
  }

  const perBreak = {};
  const note = (brk, ch) => { perBreak[brk] = Math.max(perBreak[brk] || 0, ch); };

  for (const ch of modeEl.getElementsByTagName('DMXChannel')) {
    const offAttr = ch.getAttribute('Offset');
    if (!offAttr || offAttr === 'None') continue; // virtual channel
    const offsets = offAttr.split(',').map((n) => +n).filter(Boolean);
    const maxOff = Math.max(...offsets);
    const breakAttr = ch.getAttribute('DMXBreak') || '1';
    const geo = ch.getAttribute('Geometry');
    const refs = refsByGeometry.get(geo);
    if (refs && refs.length && breakAttr !== 'Overwrite') {
      for (const breaks of refs) {
        const b = breaks.find((x) => x.brk === +breakAttr) || breaks[0];
        if (b) note(b.brk, b.offset + maxOff - 1);
      }
    } else {
      note(breakAttr === 'Overwrite' ? 1 : +breakAttr || 1, maxOff);
    }
  }
  const breaks = Object.keys(perBreak).length;
  return { channels: perBreak[1] || Object.values(perBreak)[0] || 0, breaks };
}

export function fixtureFromGDTFXml(text) {
  const doc = parseXml(text);
  const ft = doc.getElementsByTagName('FixtureType')[0];
  if (!ft) throw new Error('No FixtureType found in GDTF description');
  const num = (tag) => {
    const el = ft.getElementsByTagName(tag)[0];
    const v = el ? parseFloat(el.getAttribute('Value')) : NaN;
    return Number.isFinite(v) && v > 0 ? v : null;
  };
  const modes = [...ft.getElementsByTagName('DMXMode')].map((m) => {
    const fp = gdtfModeFootprint(m, ft);
    return { name: m.getAttribute('Name') || 'Mode', shortName: '', channels: fp.channels, breaks: fp.breaks };
  });
  return {
    name: ft.getAttribute('LongName') || ft.getAttribute('Name') || 'Fixture',
    manufacturer: ft.getAttribute('Manufacturer') || '',
    source: 'gdtf',
    sourceKey: ft.getAttribute('FixtureTypeID') || '',
    categories: [],
    powerW: num('PowerConsumption'),
    weightKg: num('Weight'),
    connector: '',
    modes,
  };
}

export async function fixtureFromGDTF(fileOrBuffer) {
  const zip = await readZip(fileOrBuffer);
  const xml = await zip.text('description.xml');
  if (!xml) throw new Error('This GDTF file has no description.xml');
  return fixtureFromGDTFXml(xml);
}

// Import a file the user picked: .gdtf or OFL .json
export async function fixtureFromFile(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith('.gdtf') || name.endsWith('.zip')) return fixtureFromGDTF(file);
  if (name.endsWith('.json')) {
    const json = JSON.parse(await file.text());
    if (!json.modes) throw new Error('This JSON file is not an Open Fixture Library fixture');
    const base = file.name.replace(/\.json$/i, '');
    return fixtureFromOFL(json, json.manufacturerKey ? `${json.manufacturerKey}/${base}` : `/${base}`);
  }
  throw new Error('Unsupported file type. Use a .gdtf or Open Fixture Library .json file');
}
