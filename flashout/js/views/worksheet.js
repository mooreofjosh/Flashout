// Worksheet: spreadsheet of every fixture in a gig (laptop layout).
// Click a cell to select it; type, Enter, F2 or double-click to edit. Enter/Tab commit and move,
// arrows move, Esc cancels. Click headers to sort (shift-click adds a second sort). Click row
// numbers to select rows (shift for a range, Ctrl/Cmd to add). Ctrl/Cmd+D fills down.
import * as store from '../store.js';
import { esc, toast, confirmSheet } from '../ui.js';
import { refresh } from '../app.js';
import { isPatched, formatAddress, absoluteAddress, parseAddress, naturalCompare, footprint, findIssues } from '../patch.js';
import { prepState, openFaults, typeLabel, typeOptions, faultsSheet, editFixtureSheet } from './common.js';
import { circuitIndex, DEFAULT_POWER } from '../power.js';

const getType = (id) => store.getType(id);

// ---------- columns ----------
// get: display text; sort: sort key (defaults to get); edit: 'text' | 'type' | 'mode' | 'rigging' | 'address' | null
const COLUMNS = [
  { key: 'position', label: 'Position', w: 140, edit: 'text', get: (f) => f.position || '' },
  { key: 'unit', label: 'Unit', w: 64, edit: 'text', get: (f) => f.unit || '' },
  { key: 'type', label: 'Fixture', w: 190, edit: 'type', get: (f) => typeLabel(getType(f.typeId)) },
  { key: 'mode', label: 'Mode', w: 130, edit: 'mode', get: (f) => getType(f.typeId)?.modes?.[f.modeIndex]?.name || '' },
  { key: 'chs', label: 'Ch', w: 44, num: true, get: (f) => String(footprint(f, getType) || ''), sort: (f) => footprint(f, getType) },
  { key: 'address', label: 'Address', w: 84, edit: 'address', mono: true, get: (f) => (isPatched(f) ? formatAddress(f) : ''), sort: (f) => (isPatched(f) ? absoluteAddress(f.universe, f.address) : Infinity) },
  { key: 'channel', label: 'Channel', w: 74, edit: 'text', mono: true, get: (f) => f.channel || '' },
  { key: 'purpose', label: 'Purpose', w: 150, edit: 'text', get: (f) => f.purpose || '' },
  { key: 'colour', label: 'Colour', w: 90, edit: 'text', get: (f) => f.colour || '' },
  { key: 'gobo', label: 'Gobo', w: 90, edit: 'text', get: (f) => f.gobo || '' },
  { key: 'accessories', label: 'Accessories', w: 130, edit: 'text', get: (f) => f.accessories || '' },
  { key: 'rigging', label: 'Rig', w: 70, edit: 'rigging', get: (f) => (f.rigging === 'ground' ? 'Ground' : 'Flown') },
  { key: 'watts', label: 'Watts', w: 62, num: true, get: (f) => String(getType(f.typeId)?.powerW || ''), sort: (f) => getType(f.typeId)?.powerW || 0 },
  { key: 'circuit', label: 'Circuit', w: 110, get: (f, ctx) => ctx.circuitName(f) },
  { key: 'prep', label: 'Prep', w: 60, get: (f, ctx) => { const p = prepState(f, ctx.settings); return p.total ? `${p.done}/${p.total}` : ''; }, sort: (f, ctx) => { const p = prepState(f, ctx.settings); return p.total ? p.done / p.total : 0; } },
  { key: 'faults', label: 'Faults', w: 56, num: true, get: (f) => String(openFaults(f).length || ''), sort: (f) => openFaults(f).length },
  { key: 'notes', label: 'Notes', w: 200, edit: 'text', get: (f) => f.notes || '' },
];
const COL = Object.fromEntries(COLUMNS.map((c) => [c.key, c]));
export const DEFAULT_COLUMNS = ['position', 'unit', 'type', 'mode', 'chs', 'address', 'channel', 'purpose', 'colour', 'gobo', 'rigging', 'circuit', 'prep', 'faults', 'notes'];
export const WORKSHEET_COLUMNS = COLUMNS.map(({ key, label }) => ({ key, label }));

// ---------- state ----------
const ui = {
  gigId: null,
  sort: [{ key: 'position', dir: 1 }, { key: 'unit', dir: 1 }],
  filter: '',
  group: true,
  sel: new Set(),
  anchor: null, // row id for shift-select
  cell: null, // { id, key }
  editing: false,
  scrollLeft: 0,
  undo: null,
  bulkKey: 'position',
};

function visibleColumns() {
  const keys = store.getState().settings.worksheetColumns || DEFAULT_COLUMNS;
  return keys.map((k) => COL[k]).filter(Boolean);
}

function context(gig) {
  const settings = store.getState().settings;
  const idx = circuitIndex(gig.power || DEFAULT_POWER());
  return {
    settings,
    circuitName: (f) => { const at = f.circuit && idx.get(f.circuit); return at ? `${at.distro.name} / ${at.circuit.label}` : ''; },
  };
}

function rowsFor(gig, cols, ctx) {
  let rows = gig.fixtures.slice();
  const q = ui.filter.trim().toLowerCase();
  if (q) {
    const words = q.split(/\s+/);
    rows = rows.filter((f) => {
      const hay = cols.map((c) => c.get(f, ctx)).join(' ').toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }
  const keyed = ui.group && ui.sort[0]?.key !== 'position' ? [{ key: 'position', dir: 1 }, ...ui.sort] : ui.sort;
  const cmp = (a, b) => {
    for (const s of keyed) {
      const c = COL[s.key];
      const va = (c.sort || c.get)(a, ctx);
      const vb = (c.sort || c.get)(b, ctx);
      const ea = va === '' || va == null, eb = vb === '' || vb == null;
      if (ea !== eb) return ea ? 1 : -1; // blanks always last
      const r = typeof va === 'number' && typeof vb === 'number' ? va - vb : naturalCompare(va, vb);
      if (r) return r * s.dir;
    }
    return 0;
  };
  return rows.sort(cmp);
}

// ---------- editing ----------
function cellEditor(f, col) {
  const val = col.get(f, {});
  if (col.edit === 'type') return `<select class="ws-input" data-ed>${typeOptions(f.typeId)}</select>`;
  if (col.edit === 'mode') {
    const modes = getType(f.typeId)?.modes || [];
    return `<select class="ws-input" data-ed>${modes.map((m, i) => `<option value="${i}" ${i === f.modeIndex ? 'selected' : ''}>${esc(m.name)} (${m.channels}ch)</option>`).join('')}</select>`;
  }
  if (col.edit === 'rigging') return `<select class="ws-input" data-ed><option value="flown" ${f.rigging !== 'ground' ? 'selected' : ''}>Flown</option><option value="ground" ${f.rigging === 'ground' ? 'selected' : ''}>Ground</option></select>`;
  return `<input class="ws-input" data-ed value="${esc(val)}" ${col.key === 'position' ? 'list="ws-positions"' : ''} spellcheck="false" autocomplete="off">`;
}

// Apply a value from an editor (or bulk change) to one fixture. Returns an error message or ''.
function applyValue(f, col, raw) {
  const v = typeof raw === 'string' ? raw.trim() : raw;
  switch (col.edit) {
    case 'type': if (v && v !== f.typeId) { f.typeId = v; f.modeIndex = 0; } return '';
    case 'mode': { const t = getType(f.typeId); const i = +v; if (t?.modes?.[i]) f.modeIndex = i; return ''; }
    case 'rigging': f.rigging = v === 'ground' || /^g/i.test(v) ? 'ground' : 'flown'; return '';
    case 'address': {
      if (!v) { f.universe = null; f.address = null; return ''; }
      const a = parseAddress(v);
      if (!a || a.universe < 1 || a.address < 1 || a.address > 512) return 'Address should look like 1.001 or an absolute address like 513';
      f.universe = a.universe; f.address = a.address; return '';
    }
    case 'text': f[col.key] = v; return '';
    default: return '';
  }
}

// ---------- view ----------
export function worksheet(gig, { addFixturesSheet, importMVR }) {
  if (ui.gigId !== gig.id) { Object.assign(ui, { gigId: gig.id, sel: new Set(), anchor: null, cell: null, editing: false, filter: '', undo: null, scrollLeft: 0 }); }
  for (const id of [...ui.sel]) if (!gig.fixtures.some((f) => f.id === id)) ui.sel.delete(id);
  const cols = visibleColumns();
  const ctx = context(gig);
  const rows = rowsFor(gig, cols, ctx);
  if (ui.cell && !rows.some((f) => f.id === ui.cell.id)) { ui.cell = null; ui.editing = false; }
  const issueIds = new Set();
  for (const i of findIssues(gig.fixtures, getType)) if (i.level === 'error') i.ids.forEach((id) => issueIds.add(id));
  const sortMark = (key) => { const i = ui.sort.findIndex((s) => s.key === key); return i < 0 ? '' : `<span class="sort">${ui.sort[i].dir > 0 ? '▲' : '▼'}${ui.sort.length > 1 ? i + 1 : ''}</span>`; };
  const nSel = ui.sel.size;
  const editable = COLUMNS.filter((c) => c.edit);

  let lastPos = null;
  const body = rows.map((f, i) => {
    const groupRow = ui.group && (f.position || '') !== lastPos
      ? `<tr class="ws-group"><td colspan="${cols.length + 1}">${esc(f.position || 'No position')} <span>${rows.filter((x) => (x.position || '') === (f.position || '')).length}</span></td></tr>` : '';
    lastPos = f.position || '';
    const sel = ui.sel.has(f.id);
    return groupRow + `<tr data-id="${f.id}" class="${sel ? 'sel' : ''} ${issueIds.has(f.id) ? 'clash' : ''}">
      <th class="rn" data-rn="${f.id}">${i + 1}</th>
      ${cols.map((c) => {
        const active = ui.cell && ui.cell.id === f.id && ui.cell.key === c.key;
        const cls = [c.num ? 'num' : '', c.mono ? 'mono' : '', c.edit ? '' : 'ro', active ? 'active' : '', c.key === 'faults' && openFaults(f).length ? 'bad' : ''].join(' ');
        const inner = active && ui.editing && c.edit ? cellEditor(f, c) : esc(c.get(f, ctx));
        return `<td class="${cls}" data-key="${c.key}">${inner}</td>`;
      }).join('')}
    </tr>`;
  }).join('');

  const positions = [...new Set(gig.fixtures.map((f) => f.position).filter(Boolean))].sort(naturalCompare);

  return {
    wide: true,
    full: true,
    html: `
      <div class="ws-toolbar">
        <button class="btn primary small" data-action="wsAdd">+ Add fixtures</button>
        <button class="btn small" data-action="wsMvr">Import MVR</button>
        <input class="ws-filter" type="search" placeholder="Filter… (any column)" value="${esc(ui.filter)}" data-ws-filter aria-label="Filter worksheet">
        <label class="switch small"><input type="checkbox" data-change="wsGroup" ${ui.group ? 'checked' : ''}> Group by position</label>
        <span class="ws-count">${rows.length}${rows.length !== gig.fixtures.length ? ` of ${gig.fixtures.length}` : ''} fixtures</span>
        <button class="btn small" data-action="wsColumns">Columns</button>
        ${ui.undo?.gigId === gig.id ? `<button class="btn small" data-action="wsUndo">Undo delete (${ui.undo.removed.length})</button>` : ''}
      </div>
      ${nSel > 1 || (nSel === 1 && !ui.cell) ? `
      <div class="ws-bulk on">
        <strong>${nSel} selected</strong>
        <span>Change</span>
        <select data-change="wsBulkKey" aria-label="Field to change">${editable.map((c) => `<option value="${c.key}" ${ui.bulkKey === c.key ? 'selected' : ''}>${c.label}</option>`).join('')}</select>
        <span>to</span>
        ${bulkInput(gig)}
        <button class="btn small primary" data-action="wsBulkApply">Apply</button>
        <span class="sep"></span>
        <button class="btn small" data-action="wsRenumber">Renumber units…</button>
        <button class="btn small danger" data-action="wsDelete">Delete</button>
        <button class="btn small" data-action="wsClearSel">Clear selection</button>
      </div>` : `
      <div class="ws-bulk idle"><span class="muted">Select rows (click row numbers, shift for a range) to change, renumber or delete several at once.</span></div>`}
      <datalist id="ws-positions">${positions.map((p) => `<option value="${esc(p)}">`).join('')}</datalist>
      <div class="ws-wrap" data-ws-wrap tabindex="-1">
        <table class="ws">
          <colgroup><col style="width:44px">${cols.map((c) => `<col style="width:${c.w}px">`).join('')}</colgroup>
          <thead><tr><th class="rn" data-action="wsSelAll" title="Select all">#</th>${cols.map((c) => `<th data-sort="${c.key}" class="${c.num ? 'num' : ''}" title="Click to sort, shift-click to add a second sort">${c.label}${sortMark(c.key)}</th>`).join('')}</tr></thead>
          <tbody>${body || `<tr><td colspan="${cols.length + 1}" class="ws-empty">${gig.fixtures.length ? 'No fixtures match the filter.' : 'No fixtures yet. Add fixtures or import an MVR file.'}</td></tr>`}</tbody>
        </table>
      </div>
      <p class="ws-help muted small">Click a cell, then type to edit · Enter/Tab to save and move · Esc to cancel · arrows to move · Ctrl/⌘+D fills down the selected rows · click row numbers to select (shift for a range).</p>`,
    mount(root) {
      const wrap = root.querySelector('[data-ws-wrap]');
      wrap.scrollLeft = ui.scrollLeft;
      wrap.addEventListener('scroll', () => { ui.scrollLeft = wrap.scrollLeft; });

      const filter = root.querySelector('[data-ws-filter]');
      filter.addEventListener('input', () => {
        ui.filter = filter.value;
        const pos = filter.selectionStart;
        refresh();
        const again = document.querySelector('[data-ws-filter]');
        again?.focus(); again?.setSelectionRange(pos, pos);
      });

      const table = root.querySelector('table.ws');
      table.addEventListener('mousedown', (e) => {
        const th = e.target.closest('th[data-sort]');
        if (th) { sortBy(th.dataset.sort, e.shiftKey); return; }
        const rn = e.target.closest('th[data-rn]');
        if (rn) { e.preventDefault(); selectRow(rows, rn.dataset.rn, e, e.shiftKey || e.metaKey || e.ctrlKey); return; }
        const td = e.target.closest('td[data-key]');
        if (!td || e.target.closest('[data-ed]')) return;
        const id = td.parentElement.dataset.id;
        // Double-click: two presses on the same cell within 400ms (the table redraws between them).
        const now = Date.now();
        const again = ui.lastDown && ui.lastDown.id === id && ui.lastDown.key === td.dataset.key && now - ui.lastDown.t < 400
          && ui.cell && ui.cell.id === id && ui.cell.key === td.dataset.key;
        ui.lastDown = { id, key: td.dataset.key, t: now };
        if (again) {
          e.preventDefault();
          if (td.dataset.key === 'faults') openFaultsFor(gig, id);
          else if (td.dataset.key === 'prep') editFixtureSheet(gig, store.getFixture(gig, id)).then((c) => c && refresh());
          else startEdit();
          return;
        }
        if (ui.editing) commitEditor(gig, false);
        ui.cell = { id, key: td.dataset.key };
        ui.editing = false;
        if (e.shiftKey || e.metaKey || e.ctrlKey) selectRow(rows, id, e, true);
        else if (!ui.sel.has(id) || ui.sel.size > 1) { ui.sel = new Set([id]); ui.anchor = id; }
        e.preventDefault();
        refresh();
      });

      const ed = root.querySelector('[data-ed]');
      if (ed) {
        ed.focus();
        if (ed.tagName === 'INPUT') { if (ui.pendingKey != null) { ed.value = ui.pendingKey; ui.pendingKey = null; } else ed.select?.(); }
        ed.addEventListener('keydown', (e) => editorKey(e, gig, rows, cols));
        if (ed.tagName === 'SELECT') ed.addEventListener('change', () => { commitEditor(gig, true); refresh(); });
      } else if (ui.cell) {
        root.querySelector('td.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }

      document.onkeydown = (e) => gridKey(e, gig, rows, cols);
    },
    unmount() { document.onkeydown = null; },
    actions: {
      wsAdd: async () => { if (await addFixturesSheet(gig)) refresh(); },
      wsMvr: async () => { if (await importMVR(gig)) refresh(); },
      wsGroup: (el) => { ui.group = el.checked; refresh(); },
      wsSelAll: () => { ui.sel = ui.sel.size === rows.length ? new Set() : new Set(rows.map((f) => f.id)); ui.cell = null; refresh(); },
      wsClearSel: () => { ui.sel.clear(); refresh(); },
      wsBulkKey: (el) => { ui.bulkKey = el.value; refresh(); },
      wsBulkApply: (el) => {
        const col = COL[ui.bulkKey];
        const input = document.querySelector('[data-bulk-value]');
        const val = input.value;
        let err = '';
        for (const f of gig.fixtures) if (ui.sel.has(f.id)) err = applyValue(f, col, val) || err;
        if (err) { toast(err, 'bad'); return; }
        store.save();
        toast(`${col.label} changed on ${ui.sel.size} fixture${ui.sel.size > 1 ? 's' : ''}`);
        refresh();
      },
      wsRenumber: async () => renumber(gig, rows),
      wsDelete: async () => {
        const ids = rows.filter((f) => ui.sel.has(f.id)).map((f) => f.id);
        if (!ids.length) return;
        if (!(await confirmSheet(`Delete ${ids.length} fixture${ids.length > 1 ? 's' : ''}?`, 'Their patch, prep ticks and fault notes go too. You can undo this until you leave the gig.', `Delete ${ids.length}`, true))) return;
        const set = new Set(ids);
        ui.undo = { gigId: gig.id, removed: gig.fixtures.map((f, index) => ({ fixture: f, index })).filter((x) => set.has(x.fixture.id)) };
        store.deleteFixtures(gig.id, ids);
        ui.sel.clear(); ui.cell = null;
        refresh();
      },
      wsUndo: () => {
        for (const { fixture, index } of ui.undo.removed) gig.fixtures.splice(Math.min(index, gig.fixtures.length), 0, fixture);
        toast(`Restored ${ui.undo.removed.length} fixture${ui.undo.removed.length > 1 ? 's' : ''}`);
        ui.undo = null;
        store.save();
        refresh();
      },
      wsColumns: () => columnsSheet(),
    },
  };
}

function bulkInput(gig) {
  const col = COL[ui.bulkKey] || COL.position;
  if (col.edit === 'type') return `<select data-bulk-value>${typeOptions(null)}</select>`;
  if (col.edit === 'rigging') return '<select data-bulk-value><option value="flown">Flown</option><option value="ground">Ground</option></select>';
  if (col.edit === 'mode') {
    // modes common to the selected fixtures' type (first selected type)
    const f = gig.fixtures.find((x) => ui.sel.has(x.id));
    const modes = getType(f?.typeId)?.modes || [];
    return `<select data-bulk-value>${modes.map((m, i) => `<option value="${i}">${esc(m.name)} (${m.channels}ch)</option>`).join('')}</select>`;
  }
  return `<input data-bulk-value ${col.key === 'position' ? 'list="ws-positions"' : ''} placeholder="${col.edit === 'address' ? '1.001 (blank = unpatch)' : 'new value'}">`;
}

function sortBy(key, add) {
  const i = ui.sort.findIndex((s) => s.key === key);
  if (add) {
    if (i >= 0) ui.sort[i].dir *= -1; else ui.sort.push({ key, dir: 1 });
  } else if (i === 0) ui.sort[0].dir *= -1;
  else ui.sort = [{ key, dir: 1 }, ...(key === 'unit' ? [] : [{ key: 'unit', dir: 1 }])];
  if (key !== 'position' && !add) ui.group = false;
  refresh();
}

function selectRow(rows, id, e, keepCell = false) {
  if (e.shiftKey && ui.anchor) {
    const a = rows.findIndex((f) => f.id === ui.anchor);
    const b = rows.findIndex((f) => f.id === id);
    const [lo, hi] = a < b ? [a, b] : [b, a];
    if (!(e.metaKey || e.ctrlKey)) ui.sel.clear();
    for (let i = lo; i <= hi; i++) ui.sel.add(rows[i].id);
  } else if (e.metaKey || e.ctrlKey) {
    ui.sel.has(id) ? ui.sel.delete(id) : ui.sel.add(id);
    ui.anchor = id;
  } else {
    ui.sel = new Set([id]);
    ui.anchor = id;
  }
  if (!keepCell) ui.cell = null;
  refresh();
}

function startEdit(initial = null) {
  if (!ui.cell || !COL[ui.cell.key].edit) return;
  ui.editing = true;
  ui.pendingKey = initial;
  refresh();
}

function commitEditor(gig, keepEditing) {
  const ed = document.querySelector('[data-ed]');
  if (!ed || !ui.cell) { ui.editing = false; return true; }
  const f = store.getFixture(gig, ui.cell.id);
  const col = COL[ui.cell.key];
  const err = f ? applyValue(f, col, ed.value) : '';
  if (err) { toast(err, 'bad'); ed.focus(); return false; }
  store.save();
  ui.editing = false;
  return true;
}

function move(rows, cols, dr, dc) {
  if (!ui.cell) return;
  let r = rows.findIndex((f) => f.id === ui.cell.id);
  let c = cols.findIndex((x) => x.key === ui.cell.key);
  c += dc;
  if (c >= cols.length) { c = 0; r += 1; }
  if (c < 0) { c = cols.length - 1; r -= 1; }
  r = Math.max(0, Math.min(rows.length - 1, r + dr));
  ui.cell = { id: rows[r].id, key: cols[c].key };
  ui.sel = new Set([rows[r].id]);
  ui.anchor = rows[r].id;
}

function editorKey(e, gig, rows, cols) {
  if (e.key === 'Escape') { e.preventDefault(); ui.editing = false; refresh(); return; }
  if (e.key === 'Enter' || e.key === 'Tab') {
    e.preventDefault();
    if (!commitEditor(gig, false)) return;
    ui.editing = false;
    const fresh = rowsFor(gig, cols, context(gig)); // a commit may re-sort rows
    if (e.key === 'Enter') move(fresh, cols, e.shiftKey ? -1 : 1, 0);
    else move(fresh, cols, 0, e.shiftKey ? -1 : 1);
    refresh();
  }
}

function gridKey(e, gig, rows, cols) {
  if (!document.querySelector('table.ws')) { document.onkeydown = null; return; }
  if (ui.editing || document.querySelector('.sheet-wrap')) return;
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.key.toLowerCase() === 'a' && rows.length) { e.preventDefault(); ui.sel = new Set(rows.map((f) => f.id)); refresh(); return; }
  if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); fillDown(gig, rows); return; }
  if (!ui.cell) return;
  const arrows = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
  if (arrows[e.key]) {
    e.preventDefault();
    const before = ui.cell.id;
    move(rows, cols, ...arrows[e.key]);
    if (e.shiftKey && arrows[e.key][0]) { ui.sel.add(before); ui.sel.add(ui.cell.id); }
    refresh();
    return;
  }
  if (e.key === 'Tab') { e.preventDefault(); move(rows, cols, 0, e.shiftKey ? -1 : 1); refresh(); return; }
  if (e.key === 'Enter' || e.key === 'F2') { e.preventDefault(); startEdit(); return; }
  if (e.key === 'Escape') { ui.cell = null; ui.sel.clear(); refresh(); return; }
  const clearable = COL[ui.cell.key].edit === 'text' || COL[ui.cell.key].edit === 'address';
  if ((e.key === 'Delete' || e.key === 'Backspace') && clearable) {
    e.preventDefault();
    const targets = ui.sel.size > 1 ? gig.fixtures.filter((f) => ui.sel.has(f.id)) : [store.getFixture(gig, ui.cell.id)];
    targets.forEach((f) => applyValue(f, COL[ui.cell.key], ''));
    store.save(); refresh();
    return;
  }
  if (e.key.length === 1 && !mod && !e.altKey) {
    const col = COL[ui.cell.key];
    if (col.edit === 'text' || col.edit === 'address') { e.preventDefault(); startEdit(e.key); }
    else if (col.edit) { e.preventDefault(); startEdit(); }
  }
}

// Ctrl/Cmd+D: copy the active column's value from the top selected row to the other selected rows.
function fillDown(gig, rows) {
  if (!ui.cell) { toast('Click a cell in the column you want to fill'); return; }
  const col = COL[ui.cell.key];
  if (!col.edit) { toast(`${col.label} can't be edited here`); return; }
  const chosen = rows.filter((f) => ui.sel.has(f.id));
  if (chosen.length < 2) { toast('Select two or more rows first (shift-click row numbers)'); return; }
  const src = chosen[0];
  for (const f of chosen.slice(1)) {
    if (col.edit === 'type') { f.typeId = src.typeId; f.modeIndex = src.modeIndex; }
    else if (col.edit === 'mode') { if (f.typeId === src.typeId) f.modeIndex = src.modeIndex; }
    else if (col.edit === 'address') { f.universe = src.universe; f.address = src.address; }
    else if (col.edit === 'rigging') f.rigging = src.rigging;
    else f[col.key] = src[col.key];
  }
  store.save();
  toast(`Filled ${col.label} down ${chosen.length - 1} row${chosen.length > 2 ? 's' : ''}`);
  refresh();
}

async function renumber(gig, rows) {
  const { sheet, formData } = await import('../ui.js');
  const chosen = rows.filter((f) => ui.sel.has(f.id));
  if (!chosen.length) return;
  const r = await sheet(`Renumber ${chosen.length} unit${chosen.length > 1 ? 's' : ''}`, `
    <form class="form" data-form>
      <p class="muted small">Numbers go in the order shown in the worksheet.</p>
      <div class="grid2">
        <label>Start at<input name="start" type="number" min="0" value="${parseInt(chosen[0].unit, 10) || 1}" inputmode="numeric" required></label>
        <label>Step<input name="step" type="number" min="1" value="1" inputmode="numeric"></label>
      </div>
      <label>Also set Channel<select name="chan"><option value="">No</option><option value="same">Same as unit</option></select></label>
      <div class="row-end"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary">Renumber</button></div>
    </form>`, (root, close) => root.querySelector('[data-form]').addEventListener('submit', (e) => { e.preventDefault(); close(formData(e.target)); }));
  if (!r) return;
  let n = +r.start || 0;
  for (const f of chosen) { f.unit = String(n); if (r.chan === 'same') f.channel = String(n); n += +r.step || 1; }
  store.save();
  refresh();
}

function openFaultsFor(gig, id) {
  faultsSheet(gig, store.getFixture(gig, id)).then(() => refresh());
}

async function columnsSheet() {
  const { sheet } = await import('../ui.js');
  const current = store.getState().settings.worksheetColumns || DEFAULT_COLUMNS;
  const r = await sheet('Worksheet columns', `
    <form class="form" data-form>
      <p class="muted small">Tick the columns to show. Drag order follows the list.</p>
      <div class="col-list">${COLUMNS.map((c) => `<label class="switch"><input type="checkbox" name="${c.key}" ${current.includes(c.key) ? 'checked' : ''}> ${c.label}</label>`).join('')}</div>
      <div class="row-split">
        <button type="button" class="btn" data-reset>Reset</button>
        <span><button type="button" class="btn" data-close>Cancel</button> <button class="btn primary">Save</button></span>
      </div>
    </form>`, (root, close) => {
    root.querySelector('[data-reset]').addEventListener('click', () => close('reset'));
    root.querySelector('[data-form]').addEventListener('submit', (e) => {
      e.preventDefault();
      close(COLUMNS.filter((c) => e.target[c.key].checked).map((c) => c.key));
    });
  });
  if (!r) return;
  const s = store.getState().settings;
  if (r === 'reset') delete s.worksheetColumns;
  else s.worksheetColumns = r.length ? r : DEFAULT_COLUMNS;
  store.save();
  refresh();
}

