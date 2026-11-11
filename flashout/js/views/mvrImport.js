// MVR import flow: pick file -> preview & map fixture types -> create rig.
import * as store from '../store.js';
import { esc, sheet, formData, toast, pickFile } from '../ui.js';
import { readMVR, specLabel, matchMode } from '../mvr.js';
import { naturalCompare } from '../patch.js';

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

function libraryGuess(label) {
  const want = norm(label.name);
  return store.getState().fixtureTypes.find((t) => norm(t.name) === want && (!label.manufacturer || !t.manufacturer || norm(t.manufacturer).startsWith(norm(label.manufacturer).slice(0, 4))));
}

function typeChoiceOptions(s) {
  const label = specLabel(s.spec);
  const guess = libraryGuess(label);
  const lib = [...store.getState().fixtureTypes].sort((a, b) => (a.manufacturer + a.name).localeCompare(b.manufacturer + b.name));
  const opts = [];
  if (s.type) opts.push(`<option value="gdtf" ${guess ? '' : 'selected'}>Use GDTF from the MVR (${s.type.modes.length} modes)</option>`);
  opts.push(...lib.map((t) => `<option value="lib:${t.id}" ${guess?.id === t.id ? 'selected' : ''}>Library: ${esc(t.manufacturer ? t.manufacturer + ' – ' : '')}${esc(t.name)}</option>`));
  opts.push(`<option value="placeholder" ${!s.type && !guess ? 'selected' : ''}>New placeholder (add channel counts later)</option>`);
  return opts.join('');
}

function resolveType(s, choice) {
  const label = specLabel(s.spec);
  if (choice === 'gdtf' && s.type) return store.addType({ ...s.type, name: s.type.name || label.name, manufacturer: s.type.manufacturer || label.manufacturer });
  if (choice?.startsWith('lib:')) return store.getType(choice.slice(4));
  const modes = [...s.modeNames].map((n) => ({ name: n, channels: 0 }));
  return store.addType({
    name: label.name, manufacturer: label.manufacturer, source: 'mvr', sourceKey: 'mvr:' + s.spec,
    powerW: null, weightKg: null, modes: modes.length ? modes : [{ name: 'Default', channels: 0 }],
  });
}

// targetGig: existing gig to add to, or null to create a new gig. Resolves with the gig id, or null.
export async function importMVR(targetGig = null) {
  const file = await pickFile('.mvr,.zip');
  if (!file) return null;
  let data;
  try { data = await readMVR(file); }
  catch (e) { toast(`${file.name}: ${e.message}`, 'bad'); return null; }
  if (!data.fixtures.length) { toast('No fixtures found in this MVR file', 'bad'); return null; }

  const specs = [...data.specs.values()].sort((a, b) => b.count - a.count);
  const positions = new Map();
  for (const f of data.fixtures) positions.set(f.position || 'No position', (positions.get(f.position || 'No position') || 0) + 1);
  const patched = data.fixtures.filter((f) => f.address).length;
  const existing = new Set((targetGig?.fixtures || []).map((f) => f.mvrUuid).filter(Boolean));
  const dupes = data.fixtures.filter((f) => f.uuid && existing.has(f.uuid)).length;
  const fileBase = file.name.replace(/\.(mvr|zip)$/i, '');

  const result = await sheet('Import MVR', `
    <form class="form" data-form>
      <p><strong>${data.fixtures.length} fixtures</strong> in ${positions.size} position${positions.size === 1 ? '' : 's'} · ${patched} with DMX addresses</p>
      <ul class="chips">${[...positions].sort((a, b) => naturalCompare(a[0], b[0])).map(([p, n]) => `<li>${esc(p)} (${n})</li>`).join('')}</ul>
      ${targetGig ? '' : `<label>New gig name<input name="gigName" value="${esc(fileBase)}" required></label>`}
      <fieldset><legend>Fixture types</legend>
        ${specs.map((s, i) => {
          const label = specLabel(s.spec);
          return `<label class="spec">
            <span><strong>${s.count}× ${esc(label.name)}</strong> ${label.manufacturer ? `<small>${esc(label.manufacturer)}</small>` : ''}
            <small class="${s.error ? 'bad-text' : 'muted'}">${s.error ? esc(s.error) : ''}${s.modeNames.size ? `${s.error ? ' · ' : ''}Mode: ${esc([...s.modeNames].join(', '))}` : ''}</small></span>
            <select name="spec${i}">${typeChoiceOptions(s)}</select>
          </label>`;
        }).join('')}
      </fieldset>
      <label>Count as flown if in a truss or higher than (m)<input name="flownAbove" type="number" step="0.1" min="0" value="2" inputmode="decimal"></label>
      <label class="switch"><input type="checkbox" name="keepPatch" ${patched ? 'checked' : ''}> Keep DMX addresses from the MVR</label>
      ${dupes ? `<label class="switch"><input type="checkbox" name="skipDupes" checked> Skip ${dupes} fixture${dupes === 1 ? '' : 's'} already imported into this gig</label>` : ''}
      <p class="muted small">You can change any fixture's position, rigging or address after import.</p>
      <div class="row-end"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary">Import ${data.fixtures.length} fixtures</button></div>
    </form>`, (root, close) => {
    root.querySelector('[data-form]').addEventListener('submit', (e) => {
      e.preventDefault();
      close(formData(e.target));
    });
  });
  if (!result) return null;

  const typeFor = new Map(specs.map((s, i) => [s.spec, resolveType(s, result['spec' + i])]));
  const flownMm = (parseFloat(result.flownAbove) || 0) * 1000;
  let seq = (targetGig?.fixtures || []).reduce((m, f) => Math.max(m, parseInt(f.unit, 10) || 0), 0);

  const list = [];
  for (const f of data.fixtures) {
    if (result.skipDupes && f.uuid && existing.has(f.uuid)) continue;
    const type = typeFor.get(f.spec);
    const keep = result.keepPatch && f.address;
    list.push({
      typeId: type?.id || null,
      modeIndex: matchMode(type, f.modeName),
      unit: f.fixtureId || String(++seq),
      position: f.position,
      rigging: f.inTruss || f.zMm >= flownMm ? 'flown' : 'ground',
      universe: keep ? f.address.universe : null,
      address: keep ? f.address.address : null,
      notes: f.name && f.name !== specLabel(f.spec).name ? f.name : '',
      mvrUuid: f.uuid,
    });
  }

  const gig = targetGig || store.addGig({ name: result.gigName || fileBase });
  store.addFixtures(gig.id, list);
  const placeholders = [...typeFor.values()].filter((t) => t?.modes.every((m) => !m.channels)).length;
  toast(`Imported ${list.length} fixtures${placeholders ? ` · set channel counts for ${placeholders} fixture type${placeholders > 1 ? 's' : ''} in Library` : ''}`);
  return gig.id;
}
