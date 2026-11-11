// Shared bits for gig views: checklist rules, labels, fixture editing and faults.
import * as store from '../store.js';
import { esc, sheet, confirmSheet, formData } from '../ui.js';
import { formatAddress, parseAddress, naturalCompare } from '../patch.js';

export const checklistFor = (f, settings) => settings.checklists[f.rigging === 'ground' ? 'ground' : 'flown'] || [];

export function prepState(f, settings) {
  const items = checklistFor(f, settings);
  const done = items.filter((i) => f.checks[i]).length;
  return { items, done, total: items.length, complete: items.length > 0 && done === items.length };
}

export const openFaults = (f) => f.faults.filter((x) => !x.resolved);

export function typeLabel(type) {
  if (!type) return 'Unknown fixture';
  return type.name;
}

export function modeLabel(type, modeIndex) {
  const m = type?.modes?.[modeIndex];
  if (!m) return 'No mode';
  const ch = `${m.channels}ch`;
  return m.name.replace(/\s+/g, '').toLowerCase() === ch ? ch : `${m.name} · ${ch}`;
}

export const sortFixtures = (list) =>
  [...list].sort((a, b) => naturalCompare(a.unit, b.unit) || naturalCompare(a.position, b.position));

export function positionsOf(gig) {
  return [...new Set(gig.fixtures.map((f) => f.position || ''))].sort(naturalCompare);
}

export function typeOptions(selectedId) {
  const types = [...store.getState().fixtureTypes].sort((a, b) =>
    (a.manufacturer + a.name).localeCompare(b.manufacturer + b.name));
  return types.map((t) =>
    `<option value="${t.id}" ${t.id === selectedId ? 'selected' : ''}>${esc(t.manufacturer ? t.manufacturer + ' – ' : '')}${esc(t.name)}</option>`).join('');
}

export function modeOptions(type, selected = 0) {
  return (type?.modes || []).map((m, i) =>
    `<option value="${i}" ${i === +selected ? 'selected' : ''}>${esc(m.name)} (${m.channels}ch)</option>`).join('');
}

// Keep the mode list in sync with the selected fixture type inside a form.
export function wireTypeMode(root) {
  const typeSel = root.querySelector('[name=typeId]');
  const modeSel = root.querySelector('[name=modeIndex]');
  if (!typeSel || !modeSel) return;
  typeSel.addEventListener('change', () => { modeSel.innerHTML = modeOptions(store.getType(typeSel.value)); });
}

export function positionDatalist(gig) {
  return `<datalist id="positions">${positionsOf(gig).filter(Boolean).map((p) => `<option value="${esc(p)}">`).join('')}</datalist>`;
}

export const riggingField = (value = 'flown') => `
  <fieldset class="seg">
    <legend>Rigging</legend>
    <label><input type="radio" name="rigging" value="flown" ${value !== 'ground' ? 'checked' : ''}><span>Flown</span></label>
    <label><input type="radio" name="rigging" value="ground" ${value === 'ground' ? 'checked' : ''}><span>Ground</span></label>
  </fieldset>`;

// Edit one rig fixture. Resolves true if something changed.
export function editFixtureSheet(gig, f) {
  const type = store.getType(f.typeId);
  return sheet(`Unit ${f.unit || '?'} · ${typeLabel(type)}`, `
    <form class="form" data-form>
      <div class="grid2">
        <label>Unit #<input name="unit" value="${esc(f.unit)}" inputmode="numeric"></label>
        <label>Address<input name="addr" value="${esc(formatAddress(f) === '—' ? '' : formatAddress(f))}" placeholder="1.001 or 513"></label>
      </div>
      <label>Fixture<select name="typeId">${typeOptions(f.typeId)}</select></label>
      <label>Mode<select name="modeIndex">${modeOptions(type, f.modeIndex)}</select></label>
      <label>Position<input name="position" list="positions" value="${esc(f.position)}" placeholder="e.g. FOH truss, SL boom"></label>
      ${positionDatalist(gig)}
      ${riggingField(f.rigging)}
      <label>Notes<textarea name="notes" rows="2">${esc(f.notes)}</textarea></label>
      <p class="error" data-err hidden></p>
      <div class="row-split">
        <button type="button" class="btn danger" data-del>Remove</button>
        <span><button type="button" class="btn" data-close>Cancel</button> <button class="btn primary">Save</button></span>
      </div>
    </form>`, (root, close) => {
    wireTypeMode(root);
    root.querySelector('[data-form]').addEventListener('submit', (e) => {
      e.preventDefault();
      const d = formData(e.target);
      const patch = { unit: d.unit.trim(), typeId: d.typeId, modeIndex: +d.modeIndex || 0, position: d.position.trim(), rigging: d.rigging, notes: d.notes };
      if (d.addr.trim()) {
        const a = parseAddress(d.addr);
        if (!a || a.address < 1 || a.address > 512 || a.universe < 1) {
          const err = root.querySelector('[data-err]');
          err.textContent = 'Address should look like 1.001 (universe.address) or an absolute address like 513.';
          err.hidden = false;
          return;
        }
        Object.assign(patch, a);
      } else Object.assign(patch, { universe: null, address: null });
      store.updateFixture(gig.id, f.id, patch);
      close(true);
    });
    root.querySelector('[data-del]').addEventListener('click', async () => {
      if (await confirmSheet('Remove fixture?', `Remove unit ${f.unit || '?'} from this gig?`, 'Remove', true)) {
        store.deleteFixtures(gig.id, [f.id]);
        close(true);
      }
    });
  });
}

// Fault notes for one fixture.
export function faultsSheet(gig, f) {
  const type = store.getType(f.typeId);
  const draw = (root) => {
    const list = root.querySelector('[data-list]');
    list.innerHTML = f.faults.length
      ? [...f.faults].reverse().map((x) => `
        <li class="fault ${x.resolved ? 'resolved' : ''}">
          <div><p>${esc(x.text)}</p><p class="meta">${new Date(x.date).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}${x.resolved ? ' · fixed' : ''}</p></div>
          <span class="fault-actions">
            <button type="button" class="btn small" data-toggle="${x.id}">${x.resolved ? 'Reopen' : 'Mark fixed'}</button>
            <button type="button" class="icon-btn" data-remove="${x.id}" aria-label="Delete note">🗑</button>
          </span>
        </li>`).join('')
      : '<li class="muted">No faults logged for this unit.</li>';
  };
  return sheet(`Faults · Unit ${f.unit || '?'} ${typeLabel(type)}`, `
    <form class="form" data-form>
      <label>New fault note<textarea name="text" rows="2" placeholder="e.g. Tilt motor noisy, gobo 4 cracked, won't take DMX" required></textarea></label>
      <div class="row-end"><button class="btn primary">Add note</button></div>
    </form>
    <ul class="faults" data-list></ul>`, (root) => {
    draw(root);
    root.querySelector('[data-form]').addEventListener('submit', (e) => {
      e.preventDefault();
      const text = e.target.text.value.trim();
      if (!text) return;
      f.faults.push({ id: store.uid(), text, date: Date.now(), resolved: false });
      store.save();
      e.target.reset();
      draw(root);
    });
    root.querySelector('[data-list]').addEventListener('click', (e) => {
      const t = e.target.closest('[data-toggle]');
      const r = e.target.closest('[data-remove]');
      if (t) { const x = f.faults.find((y) => y.id === t.dataset.toggle); x.resolved = !x.resolved; store.save(); draw(root); }
      if (r) { f.faults = f.faults.filter((y) => y.id !== r.dataset.remove); store.save(); draw(root); }
    });
  });
}
