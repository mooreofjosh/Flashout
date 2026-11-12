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
      <div class="grid2">
        <label>Channel<input name="channel" value="${esc(f.channel || '')}" placeholder="console channel / FID"></label>
        <label>Purpose<input name="purpose" value="${esc(f.purpose || '')}" placeholder="e.g. DS wash, specials"></label>
        <label>Colour<input name="colour" value="${esc(f.colour || '')}" placeholder="e.g. L201"></label>
        <label>Gobo<input name="gobo" value="${esc(f.gobo || '')}"></label>
      </div>
      <label>Accessories<input name="accessories" value="${esc(f.accessories || '')}" placeholder="e.g. top hat, barn doors, safety"></label>
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
      const patch = {
        unit: d.unit.trim(), typeId: d.typeId, modeIndex: +d.modeIndex || 0, position: d.position.trim(), rigging: d.rigging, notes: d.notes,
        channel: d.channel.trim(), purpose: d.purpose.trim(), colour: d.colour.trim(), gobo: d.gobo.trim(), accessories: d.accessories.trim(),
      };
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

// Phone: one fixture's details, with its prep checklist to tick and its faults.
export function fixtureInfoSheet(gig, f) {
  const settings = store.getState().settings;
  const type = store.getType(f.typeId);
  const info = [
    ['Address', isPatchedAddr(f)], ['Channel', f.channel], ['Mode', modeLabel(type, f.modeIndex)],
    ['Position', f.position], ['Purpose', f.purpose], ['Colour', f.colour], ['Gobo', f.gobo], ['Accessories', f.accessories], ['Notes', f.notes],
  ].filter(([, v]) => v);
  const draw = (root) => {
    const p = prepState(f, settings);
    root.querySelector('[data-checks]').innerHTML = p.items.map((item) => {
      const on = !!f.checks[item];
      return `<button type="button" class="check ${on ? 'on' : ''}" aria-pressed="${on}" data-item="${esc(item)}"><span class="box">${on ? '✓' : ''}</span><span class="check-text">${esc(item)}</span></button>`;
    }).join('');
    root.querySelector('[data-progress]').textContent = `${p.done}/${p.total} done`;
    const nf = openFaults(f).length;
    root.querySelector('[data-faults]').textContent = nf ? `⚠ ${nf} fault${nf > 1 ? 's' : ''}` : 'Log fault';
    root.querySelector('[data-faults]').classList.toggle('danger', !!nf);
  };
  return sheet(`Unit ${f.unit || '?'} · ${typeLabel(type)}`, `
    <dl class="info-list">${info.map(([k, v]) => `<dt>${k}</dt><dd class="${k === 'Address' || k === 'Channel' ? 'mono' : ''}">${esc(v)}</dd>`).join('')}</dl>
    <div class="row-split"><strong>Prep · ${f.rigging === 'ground' ? 'Ground' : 'Flown'}</strong><span class="muted small" data-progress></span></div>
    <div class="checks" data-checks></div>
    <div class="row-split">
      <button type="button" class="btn small" data-faults></button>
      <span><button type="button" class="btn small" data-edit>Edit details</button> <button type="button" class="btn small primary" data-close>Done</button></span>
    </div>`, (root, close) => {
    draw(root);
    root.querySelector('[data-checks]').addEventListener('click', (e) => {
      const b = e.target.closest('[data-item]');
      if (!b) return;
      f.checks[b.dataset.item] = !f.checks[b.dataset.item];
      store.save();
      draw(root);
    });
    root.querySelector('[data-faults]').addEventListener('click', async () => { close(true); await faultsSheet(gig, f); });
    root.querySelector('[data-edit]').addEventListener('click', async () => { close(true); await editFixtureSheet(gig, f); });
  });
}

const isPatchedAddr = (f) => (formatAddress(f) === '—' ? 'Not patched' : formatAddress(f));
