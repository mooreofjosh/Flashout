// MVR (My Virtual Rig) import: reads GeneralSceneDescription.xml and any embedded GDTF files.
import { readZip } from './zip.js';
import { fixtureFromGDTF } from './fixtures.js';
import { parseAddress } from './patch.js';

// "{ux,uy,uz}{vx,vy,vz}{wx,wy,wz}{ox,oy,oz}" -> { u, v, w, o }
function parseMatrix(text) {
  const nums = [...String(text || '').matchAll(/\{([^}]*)\}/g)].map((m) => m[1].split(',').map(Number));
  if (nums.length !== 4 || nums.some((v) => v.length !== 3 || v.some((n) => !Number.isFinite(n)))) return null;
  return { u: nums[0], v: nums[1], w: nums[2], o: nums[3] };
}

const IDENTITY = { u: [1, 0, 0], v: [0, 1, 0], w: [0, 0, 1], o: [0, 0, 0] };
const apply = (m, p) => [0, 1, 2].map((i) => m.u[i] * p[0] + m.v[i] * p[1] + m.w[i] * p[2]);
const compose = (parent, child) => ({
  u: apply(parent, child.u), v: apply(parent, child.v), w: apply(parent, child.w),
  o: apply(parent, child.o).map((n, i) => n + parent.o[i]),
});

const childEls = (el, tag) => [...el.children].filter((c) => !tag || c.localName === tag);
const childText = (el, tag) => childEls(el, tag)[0]?.textContent.trim() || '';

// MVR addresses are absolute (513 = 2.001) or written as "2.1".
function mvrAddress(fixtureEl) {
  const addrs = childEls(fixtureEl, 'Addresses')[0];
  if (!addrs) return null;
  const list = childEls(addrs, 'Address');
  const first = list.find((a) => (a.getAttribute('break') || '0') === '0') || list[0];
  if (!first) return null;
  const a = parseAddress(first.textContent);
  return a && a.address >= 1 && a.address <= 512 ? a : null;
}

export function parseSceneXml(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('Could not read the scene description in this MVR');
  const root = doc.documentElement;
  if (root.localName !== 'GeneralSceneDescription') throw new Error('This file does not look like an MVR scene');

  // Named positions from AUXData
  const positions = new Map();
  for (const p of root.getElementsByTagName('Position')) {
    if (p.parentElement?.localName === 'AUXData' && p.getAttribute('uuid')) positions.set(p.getAttribute('uuid').toLowerCase(), p.getAttribute('name') || '');
  }

  const fixtures = [];
  // Walk the scene tree, tracking world transform and nearest named container.
  function walk(el, world, ctx) {
    for (const child of childEls(el)) {
      const tag = child.localName;
      if (tag === 'ChildList') { walk(child, world, ctx); continue; }
      if (!['Fixture', 'Truss', 'GroupObject', 'SceneObject', 'Support', 'VideoScreen', 'Projector', 'Layer'].includes(tag)) continue;
      const local = parseMatrix(childText(child, 'Matrix')) || IDENTITY;
      const here = compose(world, local);
      const name = child.getAttribute('name') || '';
      if (tag === 'Fixture') {
        const posUuid = childText(child, 'Position').toLowerCase();
        fixtures.push({
          uuid: child.getAttribute('uuid') || '',
          name,
          fixtureId: childText(child, 'FixtureID') || childText(child, 'FixtureIDNumeric') || childText(child, 'UnitNumber'),
          spec: childText(child, 'GDTFSpec'),
          modeName: childText(child, 'GDTFMode'),
          address: mvrAddress(child),
          position: positions.get(posUuid) || ctx.container || ctx.layer || '',
          zMm: here.o[2],
          inTruss: ctx.inTruss,
        });
      }
      const next = {
        layer: tag === 'Layer' ? name : ctx.layer,
        container: (tag === 'Truss' || tag === 'GroupObject') && name ? name : ctx.container,
        inTruss: ctx.inTruss || tag === 'Truss',
      };
      walk(child, here, next);
    }
  }
  const layers = root.getElementsByTagName('Layers')[0];
  if (layers) walk(layers, IDENTITY, { layer: '', container: '', inTruss: false });
  return { fixtures };
}

// Returns { fixtures, specs: Map(spec -> { type | null, error, modeNames:Set, count }) }
export async function readMVR(file) {
  const zip = await readZip(file);
  const xml = await zip.text('GeneralSceneDescription.xml');
  if (!xml) throw new Error('This MVR file has no GeneralSceneDescription.xml');
  const { fixtures } = parseSceneXml(xml);

  const specs = new Map();
  for (const f of fixtures) {
    if (!specs.has(f.spec)) specs.set(f.spec, { spec: f.spec, type: null, error: '', modeNames: new Set(), count: 0 });
    const s = specs.get(f.spec);
    s.count++;
    if (f.modeName) s.modeNames.add(f.modeName);
  }
  for (const s of specs.values()) {
    if (!s.spec) { s.error = 'No GDTF file named'; continue; }
    const fileName = /\.gdtf$/i.test(s.spec) ? s.spec : s.spec + '.gdtf';
    const bytes = (await zip.bytes(fileName)) || (await zip.bytes(fileName.split('/').pop()));
    if (!bytes) { s.error = 'GDTF file not included in the MVR'; continue; }
    try { s.type = await fixtureFromGDTF(bytes); }
    catch (e) { s.error = 'Could not read embedded GDTF: ' + e.message; }
  }
  return { fixtures, specs };
}

// Friendly name from a spec file like "Robe Lighting@Robin 600E Spot.gdtf"
export function specLabel(spec) {
  const base = String(spec || 'Unknown fixture').replace(/\.gdtf$/i, '').split('/').pop();
  const [man, name] = base.includes('@') ? base.split('@') : ['', base];
  return { manufacturer: man.trim(), name: (name || base).trim() };
}

// Find the mode index in a type that best matches an MVR mode name.
export function matchMode(type, modeName) {
  if (!type?.modes?.length) return 0;
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const want = norm(modeName);
  if (!want) return 0;
  let i = type.modes.findIndex((m) => norm(m.name) === want);
  if (i < 0) i = type.modes.findIndex((m) => norm(m.name).includes(want) || want.includes(norm(m.name)));
  return i < 0 ? 0 : i;
}
