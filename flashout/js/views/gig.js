// One gig: Rig, Prep, Patch and Print tabs.
import * as store from '../store.js';
import { esc, sheet, confirmSheet, formData, toast, offerFile, printNow } from '../ui.js';
import { go, refresh } from '../app.js';
import {
  footprint, isPatched, formatAddress, absoluteAddress, autoAddress, findIssues,
  universeSummary, patchCSV, parseAddress, naturalCompare, UNIVERSE_SIZE,
} from '../patch.js';
import {
  prepState, openFaults, typeLabel, modeLabel, sortFixtures, positionsOf, typeOptions, modeOptions,
  wireTypeMode, positionDatalist, riggingField, editFixtureSheet, faultsSheet,
} from './common.js';
import { editGigSheet } from './gigs.js';
import { importMVR } from './mvrImport.js';
import { power, powerPrintHtml } from './power.js';

const ui = {
  prepPosition: '__all',
  prepIncomplete: false,
  patchSort: 'unit',
  printMode: 'sheet',
  printGroup: 'position',
  printPosition: '__all',
  undo: null, // { gigId, before: [{id, universe, address}] }
  rigSelect: false, // multi-select mode in the Rig tab
  rigSel: new Set(),
  rigGig: null,
  rigUndo: null, // { gigId, removed: [{ fixture, index }] }
};

const TABS = [['rig', 'Rig'], ['prep', 'Prep'], ['patch', 'Patch'], ['power', 'Power'], ['print', 'Print']];
const getType = (id) => store.getType(id);
const posName = (p) => p || 'No position';

export const gigView = {
  render({ id, tab }) {
    const gig = store.getGig(id);
    if (!gig) return { title: 'Gig not found', back: 'gigs', html: '<div class="empty"><p>This gig no longer exists.</p></div>' };
    const tabs = `<nav class="tabs" role="tablist">${TABS.map(([k, label]) =>
      `<a role="tab" href="#gig-${gig.id}-${k}" class="${k === tab ? 'active' : ''}" aria-selected="${k === tab}">${label}</a>`).join('')}</nav>`;
    const body = { rig, prep, patch, power, print }[tab](gig);
    return {
      title: gig.name || 'Gig',
      back: 'gigs',
      section: 'gigs',
      html: `<div class="gig-head">
          <p class="muted">${esc([gig.venue, gig.client, gig.date].filter(Boolean).join(' · ')) || 'No venue set'}</p>
          <button class="btn small" data-action="editGig">Edit</button>
        </div>${tabs}${body.html}`,
      mount: body.mount,
      wide: body.wide,
      actions: {
        async editGig() { await editGigSheet(gig); refresh(); },
        ...body.actions,
      },
    };
  },
};

// ---------------- RIG ----------------

function addFixturesSheet(gig, preset = {}) {
  const types = store.getState().fixtureTypes;
  if (!types.length) {
    return sheet('Add fixtures', `
      <p>Your fixture library is empty. Add the fixture types you're working with first: search Open Fixture Library, import a GDTF file, or type one in.</p>
      <div class="row-end"><button class="btn" data-close>Cancel</button><a class="btn primary" href="#library" data-close>Go to library</a></div>`);
  }
  const nextUnit = gig.fixtures.reduce((m, f) => Math.max(m, parseInt(f.unit, 10) || 0), 0) + 1;
  const firstType = preset.typeId ? getType(preset.typeId) : types[0];
  return sheet('Add fixtures', `
    <form class="form" data-form>
      <label>Fixture<select name="typeId">${typeOptions(firstType.id)}</select></label>
      <label>Mode<select name="modeIndex">${modeOptions(firstType, 0)}</select></label>
      <div class="grid2">
        <label>How many<input name="qty" type="number" min="1" max="500" value="${preset.qty || 1}" inputmode="numeric" required></label>
        <label>First unit #<input name="unit" type="number" min="0" value="${nextUnit}" inputmode="numeric"></label>
      </div>
      <label>Position<input name="position" list="positions" value="${esc(preset.position || '')}" placeholder="e.g. FOH truss, Mid truss, SL boom"></label>
      ${positionDatalist(gig)}
      ${riggingField(preset.rigging)}
      <div class="row-end"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary">Add</button></div>
    </form>`, (root, close) => {
    wireTypeMode(root);
    root.querySelector('[data-form]').addEventListener('submit', (e) => {
      e.preventDefault();
      const d = formData(e.target);
      const qty = Math.min(500, Math.max(1, parseInt(d.qty, 10) || 1));
      const start = d.unit === '' ? null : parseInt(d.unit, 10);
      const list = Array.from({ length: qty }, (_, i) => ({
        typeId: d.typeId, modeIndex: +d.modeIndex || 0, position: d.position.trim(), rigging: d.rigging,
        unit: start === null ? '' : String(start + i),
      }));
      store.addFixtures(gig.id, list);
      toast(`Added ${qty} fixture${qty > 1 ? 's' : ''}`);
      close(true);
    });
  });
}

function rig(gig) {
  if (ui.rigGig !== gig.id) { ui.rigGig = gig.id; ui.rigSelect = false; ui.rigSel.clear(); ui.rigUndo = null; }
  for (const id of [...ui.rigSel]) if (!gig.fixtures.some((f) => f.id === id)) ui.rigSel.delete(id);
  const selecting = ui.rigSelect;
  const nSel = ui.rigSel.size;
  const groups = new Map();
  for (const f of sortFixtures(gig.fixtures)) {
    const k = f.position || '';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(f);
  }
  const settings = store.getState().settings;
  const counts = new Map();
  for (const f of gig.fixtures) {
    const t = getType(f.typeId);
    const k = typeLabel(t);
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  const watts = gig.fixtures.reduce((s, f) => s + (getType(f.typeId)?.powerW || 0), 0);

  const summary = gig.fixtures.length ? `
    <section class="card summary">
      <p><strong>${gig.fixtures.length}</strong> fixtures${watts ? ` · approx <strong>${(watts / 1000).toFixed(1)} kW</strong>` : ''}</p>
      <ul class="chips">${[...counts].sort((a, b) => b[1] - a[1]).map(([k, n]) => `<li>${n}× ${esc(k)}</li>`).join('')}</ul>
    </section>` : '';

  const list = [...groups.keys()].sort(naturalCompare).map((pos) => `
    <section class="group">
      <header class="group-head">
        <h3>${esc(posName(pos))} <span class="muted">(${groups.get(pos).length})</span></h3>
        ${selecting ? `<button class="btn small" data-action="selPos" data-pos="${esc(pos)}">${groups.get(pos).every((f) => ui.rigSel.has(f.id)) ? 'Deselect' : 'Select'} all ${groups.get(pos).length}</button>` : `<span>
          <button class="btn small" data-action="addTo" data-pos="${esc(pos)}">+ Add</button>
          <button class="icon-btn" data-action="posMenu" data-pos="${esc(pos)}" aria-label="Position options">⋯</button>
        </span>`}
      </header>
      <ul class="rows">${groups.get(pos).map((f) => {
        const t = getType(f.typeId);
        const p = prepState(f, settings);
        const nf = openFaults(f).length;
        const on = ui.rigSel.has(f.id);
        return `<li><button class="row ${selecting ? 'selecting' : ''} ${on ? 'picked' : ''}" data-action="${selecting ? 'toggleSel' : 'edit'}" data-id="${f.id}" ${selecting ? `aria-pressed="${on}"` : ''}>
          ${selecting ? `<span class="selbox">${on ? '✓' : ''}</span>` : ''}
          <span class="unit">${esc(f.unit || '–')}</span>
          <span class="row-main"><strong>${esc(typeLabel(t))}</strong><small>${esc(modeLabel(t, f.modeIndex))}</small></span>
          <span class="row-side">
            <span class="addr">${formatAddress(f)}</span>
            <small><span class="tag ${f.rigging}">${f.rigging === 'ground' ? 'Ground' : 'Flown'}</span> ${p.done}/${p.total}${nf ? ` <span class="bad-text">⚠${nf}</span>` : ''}</small>
          </span>
        </button></li>`;
      }).join('')}</ul>
    </section>`).join('');

  return {
    html: `
      ${selecting ? `
      <div class="toolbar select-toolbar">
        <button class="btn primary" data-action="selDone">Done</button>
        <button class="btn" data-action="selAll">${nSel === gig.fixtures.length ? 'Deselect all' : `Select all ${gig.fixtures.length}`}</button>
        <select data-change="selType" aria-label="Select all of a fixture type">
          <option value="">Select by fixture…</option>
          ${[...counts.keys()].sort().map((k) => `<option value="${esc(k)}">${esc(k)} (${counts.get(k)})</option>`).join('')}
        </select>
      </div>
      <div class="action-bar" ${nSel ? '' : 'hidden'}>
        <span><strong>${nSel}</strong> selected</span>
        <button class="btn danger-fill" data-action="deleteSel">Delete ${nSel}</button>
      </div>` : `
      <div class="toolbar">
        <button class="btn primary" data-action="add">+ Add fixtures</button>
        <button class="btn" data-action="mvr">Import MVR</button>
        ${gig.fixtures.length ? '<button class="btn" data-action="selStart">Select</button>' : ''}
        ${ui.rigUndo?.gigId === gig.id ? `<button class="btn" data-action="undoDelete">Undo delete (${ui.rigUndo.removed.length})</button>` : ''}
      </div>`}
      ${summary}
      ${list || '<div class="empty"><h3>No fixtures in this rig</h3><p class="muted">Add fixtures by position, e.g. 8 moving heads on the FOH truss.</p></div>'}`,
    actions: {
      async add() { if (await addFixturesSheet(gig)) refresh(); },
      async mvr() { if (await importMVR(gig)) refresh(); },
      async addTo(el) {
        const sample = gig.fixtures.find((f) => (f.position || '') === el.dataset.pos);
        if (await addFixturesSheet(gig, { position: el.dataset.pos, rigging: sample?.rigging, typeId: sample?.typeId })) refresh();
      },
      async edit(el) { if (await editFixtureSheet(gig, store.getFixture(gig, el.dataset.id))) refresh(); },
      selStart() { ui.rigSelect = true; ui.rigSel.clear(); refresh(); },
      selDone() { ui.rigSelect = false; ui.rigSel.clear(); refresh(); },
      toggleSel(el) { const id = el.dataset.id; ui.rigSel.has(id) ? ui.rigSel.delete(id) : ui.rigSel.add(id); refresh(); },
      selAll() {
        if (ui.rigSel.size === gig.fixtures.length) ui.rigSel.clear();
        else gig.fixtures.forEach((f) => ui.rigSel.add(f.id));
        refresh();
      },
      selPos(el) {
        const inPos = gig.fixtures.filter((f) => (f.position || '') === el.dataset.pos);
        const all = inPos.every((f) => ui.rigSel.has(f.id));
        inPos.forEach((f) => (all ? ui.rigSel.delete(f.id) : ui.rigSel.add(f.id)));
        refresh();
      },
      selType(el) {
        if (!el.value) return;
        gig.fixtures.forEach((f) => { if (typeLabel(getType(f.typeId)) === el.value) ui.rigSel.add(f.id); });
        refresh();
      },
      async deleteSel() {
        const ids = [...ui.rigSel];
        if (!ids.length) return;
        const chosen = gig.fixtures.filter((f) => ui.rigSel.has(f.id));
        const faults = chosen.reduce((n, f) => n + f.faults.length, 0);
        const ok = await confirmSheet(`Delete ${ids.length} fixture${ids.length > 1 ? 's' : ''}?`,
          `Their patch, prep ticks${faults ? ` and ${faults} fault note${faults > 1 ? 's' : ''}` : ''} go too. You can undo this until you leave the gig.`, `Delete ${ids.length}`, true);
        if (!ok) return;
        ui.rigUndo = { gigId: gig.id, removed: gig.fixtures.map((f, index) => ({ fixture: f, index })).filter((x) => ui.rigSel.has(x.fixture.id)) };
        store.deleteFixtures(gig.id, ids);
        ui.rigSelect = false;
        ui.rigSel.clear();
        toast(`Deleted ${ids.length} fixture${ids.length > 1 ? 's' : ''}`);
        refresh();
      },
      undoDelete() {
        const { removed } = ui.rigUndo;
        for (const { fixture, index } of removed) gig.fixtures.splice(Math.min(index, gig.fixtures.length), 0, fixture);
        ui.rigUndo = null;
        store.save();
        toast(`Restored ${removed.length} fixture${removed.length > 1 ? 's' : ''}`);
        refresh();
      },
      async posMenu(el) {
        const pos = el.dataset.pos;
        const fixtures = gig.fixtures.filter((f) => (f.position || '') === pos);
        const choice = await sheet(posName(pos), `
          <form class="form" data-form>
            <label>Rename position<input name="name" value="${esc(pos)}"></label>
            <div class="row-end"><button class="btn primary">Rename</button></div>
          </form>
          <div class="menu">
            <button class="btn block" data-v="flown">Set all ${fixtures.length} to Flown</button>
            <button class="btn block" data-v="ground">Set all ${fixtures.length} to Ground</button>
            <button class="btn block danger" data-v="delete">Remove all ${fixtures.length} fixtures</button>
          </div>`, (root, close) => {
          root.querySelector('[data-form]').addEventListener('submit', (e) => {
            e.preventDefault();
            const name = e.target.name.value.trim();
            fixtures.forEach((f) => (f.position = name));
            store.save();
            close('done');
          });
          root.querySelector('.menu').addEventListener('click', (e) => { const b = e.target.closest('[data-v]'); if (b) close(b.dataset.v); });
        });
        if (choice === 'flown' || choice === 'ground') { fixtures.forEach((f) => (f.rigging = choice)); store.save(); }
        if (choice === 'delete' && (await confirmSheet('Remove fixtures?', `Remove all ${fixtures.length} fixtures in ${posName(pos)}?`, 'Remove', true))) {
          store.deleteFixtures(gig.id, fixtures.map((f) => f.id));
        }
        refresh();
      },
    },
  };
}

// ---------------- PREP ----------------

function prep(gig) {
  const settings = store.getState().settings;
  const positions = positionsOf(gig);
  if (ui.prepPosition !== '__all' && ui.prepPosition !== '__faults' && !positions.includes(ui.prepPosition)) ui.prepPosition = '__all';

  let all = sortFixtures(gig.fixtures);
  let total = 0, done = 0, completeUnits = 0;
  for (const f of all) {
    const p = prepState(f, settings);
    total += p.total; done += p.done; if (p.complete) completeUnits++;
  }
  const faultCount = all.reduce((n, f) => n + openFaults(f).length, 0);

  let shown = all;
  if (ui.prepPosition === '__faults') shown = shown.filter((f) => openFaults(f).length);
  else if (ui.prepPosition !== '__all') shown = shown.filter((f) => (f.position || '') === ui.prepPosition);
  if (ui.prepIncomplete) shown = shown.filter((f) => !prepState(f, settings).complete);

  const pct = total ? Math.round((done / total) * 100) : 0;
  const chip = (v, label) => `<button class="chip ${ui.prepPosition === v ? 'on' : ''}" data-action="prepPos" data-v="${esc(v)}">${label}</button>`;

  const cards = shown.map((f) => {
    const t = getType(f.typeId);
    const p = prepState(f, settings);
    const nf = openFaults(f).length;
    return `
    <article class="card prep-card ${p.complete ? 'complete' : ''}" id="p-${f.id}">
      <header>
        <span class="unit">${esc(f.unit || '–')}</span>
        <span class="row-main prep-head">
          <strong>${esc(typeLabel(t))}</strong>
          <small>${esc(posName(f.position))} · ${esc(modeLabel(t, f.modeIndex))}</small>
        </span>
        <span class="seg mini" role="group" aria-label="Rigging">
          <button class="${f.rigging !== 'ground' ? 'on' : ''}" data-action="rigging" data-id="${f.id}" data-v="flown">Flown</button>
          <button class="${f.rigging === 'ground' ? 'on' : ''}" data-action="rigging" data-id="${f.id}" data-v="ground">Ground</button>
        </span>
      </header>
      <div class="checks">
        ${p.items.map((item) => {
          const on = !!f.checks[item];
          const addr = /address/i.test(item) ? `<small class="check-addr ${isPatched(f) ? '' : 'none'}">${isPatched(f) ? formatAddress(f) : 'not patched'}</small>` : '';
          return `<button class="check ${on ? 'on' : ''}" aria-pressed="${on}" data-action="check" data-id="${f.id}" data-item="${esc(item)}"><span class="box">${on ? '✓' : ''}</span><span class="check-text">${esc(item)}${addr}</span></button>`;
        }).join('')}
      </div>
      <footer>
        <span class="muted">${p.done}/${p.total} done</span>
        <span>
          <button class="btn small ${nf ? 'danger' : ''}" data-action="faults" data-id="${f.id}">${nf ? `⚠ ${nf} fault${nf > 1 ? 's' : ''}` : 'Log fault'}</button>
          ${p.complete
            ? `<button class="btn small" data-action="all" data-id="${f.id}" data-v="0">Clear</button>`
            : `<button class="btn small" data-action="all" data-id="${f.id}" data-v="1">All done</button>`}
        </span>
      </footer>
    </article>`;
  }).join('');

  return {
    html: gig.fixtures.length ? `
      <section class="card summary">
        <p><strong>${completeUnits}/${all.length}</strong> fixtures fully prepped · ${pct}%${faultCount ? ` · <span class="bad-text">${faultCount} open fault${faultCount > 1 ? 's' : ''}</span>` : ''}</p>
        <div class="bar"><span style="width:${pct}%"></span></div>
      </section>
      <div class="chips-scroll">
        ${chip('__all', 'All')}
        ${positions.map((p) => chip(p, esc(posName(p)))).join('')}
        ${faultCount ? chip('__faults', '⚠ Faults') : ''}
      </div>
      <label class="switch"><input type="checkbox" data-change="incomplete" ${ui.prepIncomplete ? 'checked' : ''}> Hide finished fixtures</label>
      ${cards || '<div class="empty"><p class="muted">Nothing left to prep here. 🎉</p></div>'}`
      : '<div class="empty"><h3>No fixtures to prep</h3><p class="muted">Add fixtures in the Rig tab first.</p></div>',
    actions: {
      prepPos(el) { ui.prepPosition = el.dataset.v; refresh(); },
      incomplete(el) { ui.prepIncomplete = el.checked; refresh(); },
      check(el) {
        const f = store.getFixture(gig, el.dataset.id);
        f.checks[el.dataset.item] = !f.checks[el.dataset.item];
        store.save();
        refresh();
      },
      all(el) {
        const f = store.getFixture(gig, el.dataset.id);
        for (const item of prepState(f, settings).items) f.checks[item] = el.dataset.v === '1';
        store.save();
        refresh();
      },
      rigging(el) { store.updateFixture(gig.id, el.dataset.id, { rigging: el.dataset.v }); refresh(); },
      async faults(el) { await faultsSheet(gig, store.getFixture(gig, el.dataset.id)); refresh(); },
    },
  };
}

// ---------------- PATCH ----------------

function sortForPatch(list, how) {
  const arr = [...list];
  if (how === 'address') {
    arr.sort((a, b) => {
      const pa = isPatched(a), pb = isPatched(b);
      if (pa !== pb) return pa ? -1 : 1;
      if (pa) return absoluteAddress(a.universe, a.address) - absoluteAddress(b.universe, b.address);
      return naturalCompare(a.unit, b.unit);
    });
  } else if (how === 'position') {
    arr.sort((a, b) => naturalCompare(a.position, b.position) || naturalCompare(a.unit, b.unit));
  } else arr.sort((a, b) => naturalCompare(a.unit, b.unit));
  return arr;
}

function autoAddressSheet(gig) {
  const positions = positionsOf(gig);
  const types = [...new Set(gig.fixtures.map((f) => f.typeId))].map(getType).filter(Boolean);
  const patched = gig.fixtures.filter(isPatched);
  const last = patched.sort((a, b) => absoluteAddress(b.universe, b.address) - absoluteAddress(a.universe, a.address))[0];
  let nextU = 1, nextA = 1;
  if (last) {
    const end = last.address + footprint(last, getType);
    nextU = end > UNIVERSE_SIZE ? last.universe + 1 : last.universe;
    nextA = end > UNIVERSE_SIZE ? 1 : end;
  }
  return sheet('Auto-address', `
    <form class="form" data-form>
      <label>Which fixtures
        <select name="which">
          <option value="unpatched">Not patched yet (${gig.fixtures.length - patched.length})</option>
          <option value="all">All fixtures (${gig.fixtures.length}), re-address everything</option>
          ${positions.map((p) => `<option value="pos:${esc(p)}">Position: ${esc(posName(p))}</option>`).join('')}
          ${types.map((t) => `<option value="type:${t.id}">Fixture: ${esc(t.name)}</option>`).join('')}
        </select>
      </label>
      <label>Order
        <select name="order">
          <option value="unit">By unit number</option>
          <option value="position">By position, then unit number</option>
          <option value="type">By fixture type, then unit number</option>
        </select>
      </label>
      <div class="grid3">
        <label>Universe<input name="universe" type="number" min="1" value="${nextU}" inputmode="numeric"></label>
        <label>Start address<input name="address" type="number" min="1" max="512" value="${nextA}" inputmode="numeric"></label>
        <label>Gap (ch)<input name="gap" type="number" min="0" max="511" value="0" inputmode="numeric"></label>
      </div>
      <p class="muted small">Fixtures never split across universes. Addresses already used by other fixtures are skipped over.</p>
      <div class="row-end"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary">Address</button></div>
    </form>`, (root, close) => {
    root.querySelector('[data-form]').addEventListener('submit', (e) => {
      e.preventDefault();
      const d = formData(e.target);
      let list = gig.fixtures;
      if (d.which === 'unpatched') list = list.filter((f) => !isPatched(f));
      else if (d.which.startsWith('pos:')) list = list.filter((f) => (f.position || '') === d.which.slice(4));
      else if (d.which.startsWith('type:')) list = list.filter((f) => f.typeId === d.which.slice(5));
      const tn = (f) => typeLabel(getType(f.typeId));
      list = [...list].sort((a, b) =>
        (d.order === 'position' ? naturalCompare(a.position, b.position) : 0) ||
        (d.order === 'type' ? tn(a).localeCompare(tn(b)) : 0) ||
        naturalCompare(a.unit, b.unit));
      close({ list, opts: { universe: Math.max(1, +d.universe || 1), address: Math.min(512, Math.max(1, +d.address || 1)), gap: Math.max(0, +d.gap || 0) } });
    });
  });
}

function patch(gig) {
  const issues = findIssues(gig.fixtures, getType);
  const issueIds = new Map();
  for (const i of issues) if (i.level !== 'info') for (const id of i.ids) issueIds.set(id, i.level === 'error' ? 'error' : issueIds.get(id) || 'warn');
  const unis = universeSummary(gig.fixtures, getType);
  const rows = sortForPatch(gig.fixtures, ui.patchSort);
  const sortBtn = (v, label) => `<button class="chip ${ui.patchSort === v ? 'on' : ''}" data-action="sort" data-v="${v}">${label}</button>`;
  const errors = issues.filter((i) => i.level !== 'info');
  const info = issues.filter((i) => i.level === 'info');
  const hasUndo = ui.undo?.gigId === gig.id;

  return {
    html: gig.fixtures.length ? `
      <div class="toolbar">
        <button class="btn primary" data-action="auto">Auto-address</button>
        ${hasUndo ? '<button class="btn" data-action="undo">Undo</button>' : ''}
        <button class="btn" data-action="csv">Export CSV</button>
        <button class="btn" data-action="clear">Clear patch</button>
      </div>
      <section class="card ${errors.length ? 'issues-bad' : 'issues-ok'}">
        ${errors.length
          ? `<h3>${errors.length} problem${errors.length > 1 ? 's' : ''}</h3><ul class="issues">${errors.map((i) => `<li class="${i.level}">${esc(i.text)}</li>`).join('')}</ul>`
          : '<p><strong>✓ No clashes</strong></p>'}
        ${info.map((i) => `<p class="muted">${esc(i.text)}</p>`).join('')}
        ${unis.length ? `<ul class="chips">${unis.map((u) => `<li class="${u.used > UNIVERSE_SIZE ? 'bad' : ''}">U${u.universe}: ${u.used}/512 ch · ${u.fixtures} fx</li>`).join('')}</ul>` : ''}
      </section>
      <div class="chips-scroll">Sort: ${sortBtn('unit', 'Unit')}${sortBtn('address', 'Address')}${sortBtn('position', 'Position')}</div>
      <div class="table-wrap">
        <table class="patch-table">
          <thead><tr><th>Unit</th><th>Fixture</th><th>Ch</th><th>Address</th><th class="wide">End</th></tr></thead>
          <tbody>${rows.map((f) => {
            const t = getType(f.typeId);
            const fp = footprint(f, getType);
            const lvl = issueIds.get(f.id) || '';
            return `<tr class="${lvl}">
              <td class="unit-cell">${esc(f.unit || '–')}</td>
              <td><button class="link" data-action="edit" data-id="${f.id}">${esc(typeLabel(t))}</button><small>${esc([t?.modes?.[f.modeIndex]?.name, f.position].filter(Boolean).join(' · '))}</small></td>
              <td>${fp || '?'}</td>
              <td><input class="addr-input" value="${isPatched(f) ? formatAddress(f) : ''}" placeholder="—" data-change="addr" data-id="${f.id}" inputmode="decimal" aria-label="Address for unit ${esc(f.unit)}"></td>
              <td class="muted wide">${isPatched(f) && fp ? `${f.universe}.${String(f.address + fp - 1).padStart(3, '0')}` : ''}</td>
            </tr>`;
          }).join('')}</tbody>
        </table>
      </div>
      <p class="muted small">Type an address as universe.address (2.101) or absolute (613). Clear the box to unpatch.</p>`
      : '<div class="empty"><h3>Nothing to patch</h3><p class="muted">Add fixtures in the Rig tab first.</p></div>',
    actions: {
      sort(el) { ui.patchSort = el.dataset.v; refresh(); },
      async auto() {
        const res = await autoAddressSheet(gig);
        if (!res) return;
        if (!res.list.length) { toast('No fixtures matched'); return; }
        ui.undo = { gigId: gig.id, before: gig.fixtures.map((f) => ({ id: f.id, universe: f.universe, address: f.address })) };
        const result = autoAddress(res.list, gig.fixtures, getType, res.opts);
        let skipped = 0;
        for (const r of result) {
          const f = store.getFixture(gig, r.id);
          f.universe = r.universe; f.address = r.address;
          if (r.skipped) skipped++;
        }
        store.save();
        toast(`Addressed ${result.length - skipped} fixture${result.length - skipped === 1 ? '' : 's'}${skipped ? ` · ${skipped} skipped (no channel count)` : ''}`);
        refresh();
      },
      undo() {
        for (const b of ui.undo.before) {
          const f = store.getFixture(gig, b.id);
          if (f) { f.universe = b.universe; f.address = b.address; }
        }
        ui.undo = null;
        store.save();
        toast('Patch restored');
        refresh();
      },
      async clear() {
        if (!(await confirmSheet('Clear patch?', 'Remove the address from every fixture in this gig?', 'Clear', true))) return;
        ui.undo = { gigId: gig.id, before: gig.fixtures.map((f) => ({ id: f.id, universe: f.universe, address: f.address })) };
        gig.fixtures.forEach((f) => { f.universe = null; f.address = null; });
        store.save();
        refresh();
      },
      addr(el) {
        const f = store.getFixture(gig, el.dataset.id);
        const v = el.value.trim();
        if (!v) { f.universe = null; f.address = null; store.save(); refresh(); return; }
        const a = parseAddress(v);
        if (!a || a.universe < 1 || a.address < 1 || a.address > 512) {
          toast('Use universe.address like 1.001, or an absolute address like 513', 'bad');
          el.value = isPatched(f) ? formatAddress(f) : '';
          return;
        }
        Object.assign(f, a);
        store.save();
        refresh();
      },
      async edit(el) { if (await editFixtureSheet(gig, store.getFixture(gig, el.dataset.id))) refresh(); },
      csv() {
        const name = (gig.name || 'patch').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-');
        offerFile(`${name}-patch.csv`, patchCSV(sortForPatch(gig.fixtures, ui.patchSort), getType), 'text/csv');
      },
    },
  };
}

// ---------------- PRINT ----------------

function print(gig) {
  const positions = positionsOf(gig);
  const filter = (list) => (ui.printPosition === '__all' ? list : list.filter((f) => (f.position || '') === ui.printPosition));
  const fixtures = filter(sortForPatch(gig.fixtures, 'unit'));
  const hdr = `<div class="print-title"><h2>${esc(gig.name)}</h2><p>${esc([gig.venue, gig.client, gig.date].filter(Boolean).join(' · '))}</p></div>`;

  let preview = '';
  if (ui.printMode === 'sheet') {
    const groups = new Map();
    const keyOf = (f) => (ui.printGroup === 'universe' ? (isPatched(f) ? `Universe ${f.universe}` : 'Not patched') : ui.printGroup === 'position' ? posName(f.position) : 'All fixtures');
    const sorted = ui.printGroup === 'universe' ? sortForPatch(fixtures, 'address') : fixtures;
    for (const f of sorted) { const k = keyOf(f); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(f); }
    const keys = [...groups.keys()].sort(naturalCompare);
    preview = hdr + keys.map((k) => `
      <h3>${esc(k)} <small>(${groups.get(k).length})</small></h3>
      <table class="print-table">
        <thead><tr><th>Unit</th><th>Fixture</th><th>Mode</th><th>Ch</th><th>Address</th><th>Abs</th><th>Position</th><th>Rig</th></tr></thead>
        <tbody>${groups.get(k).map((f) => {
          const t = getType(f.typeId);
          const m = t?.modes?.[f.modeIndex];
          return `<tr><td>${esc(f.unit)}</td><td>${esc(typeLabel(t))}</td><td>${esc(m?.name)}</td><td>${m?.channels ?? ''}</td>
            <td><strong>${formatAddress(f)}</strong></td><td>${isPatched(f) ? absoluteAddress(f.universe, f.address) : ''}</td>
            <td>${esc(f.position)}</td><td>${f.rigging === 'ground' ? 'G' : 'F'}</td></tr>`;
        }).join('')}</tbody>
      </table>`).join('');
  } else if (ui.printMode === 'labels') {
    preview = `<div class="labels">${fixtures.map((f) => {
      const t = getType(f.typeId);
      const m = t?.modes?.[f.modeIndex];
      return `<div class="label">
        <div class="label-unit">${esc(f.unit || '–')}</div>
        <div class="label-addr">${formatAddress(f)}</div>
        <div class="label-name">${esc(typeLabel(t))}</div>
        <div class="label-meta">${esc(m ? `${m.name} · ${m.channels}ch` : '')}</div>
        <div class="label-meta">${esc(f.position)}</div>
      </div>`;
    }).join('')}</div>`;
  } else if (ui.printMode === 'power') {
    preview = hdr + '<h3>Power plan</h3>' + powerPrintHtml(gig);
  } else {
    const faulty = fixtures.filter((f) => f.faults.length);
    preview = hdr + '<h3>Fault report</h3>' + (faulty.length ? `<table class="print-table">
      <thead><tr><th>Unit</th><th>Fixture</th><th>Position</th><th>Fault</th><th>Logged</th><th>Status</th></tr></thead>
      <tbody>${faulty.flatMap((f) => f.faults.map((x) => `<tr>
        <td>${esc(f.unit)}</td><td>${esc(typeLabel(getType(f.typeId)))}</td><td>${esc(f.position)}</td>
        <td>${esc(x.text)}</td><td>${new Date(x.date).toLocaleDateString()}</td><td>${x.resolved ? 'Fixed' : '<strong>Open</strong>'}</td></tr>`)).join('')}</tbody>
      </table>` : '<p>No faults logged.</p>');
  }

  const mode = (v, label) => `<button class="chip ${ui.printMode === v ? 'on' : ''}" data-action="pmode" data-v="${v}">${label}</button>`;
  const group = (v, label) => `<button class="chip ${ui.printGroup === v ? 'on' : ''}" data-action="pgroup" data-v="${v}">${label}</button>`;

  return {
    html: `
      <div class="no-print">
        <div class="chips-scroll">${mode('sheet', 'Patch sheet')}${mode('labels', 'Labels')}${mode('power', 'Power plan')}${mode('faults', 'Fault report')}</div>
        ${ui.printMode === 'sheet' ? `<div class="chips-scroll">Group by: ${group('position', 'Position')}${group('universe', 'Universe')}${group('none', 'None')}</div>` : ''}
        <label>Fixtures
          <select data-change="ppos">
            <option value="__all">All positions</option>
            ${positions.map((p) => `<option value="${esc(p)}" ${ui.printPosition === p ? 'selected' : ''}>${esc(posName(p))}</option>`).join('')}
          </select>
        </label>
        <div class="toolbar"><button class="btn primary" data-action="print">Print</button></div>
        ${ui.printMode === 'labels' ? '<p class="muted small">Labels are laid out 3 across on A4 (63.5 × 38.1 mm, 21 per sheet).</p>' : ''}
      </div>
      <div class="print-area ${ui.printMode === 'labels' ? 'print-labels' : ''}">${fixtures.length || ui.printMode === 'power' ? preview : '<p class="muted">No fixtures to print.</p>'}</div>`,
    actions: {
      pmode(el) { ui.printMode = el.dataset.v; refresh(); },
      pgroup(el) { ui.printGroup = el.dataset.v; refresh(); },
      ppos(el) { ui.printPosition = el.value; refresh(); },
      print: printNow,
    },
  };
}
