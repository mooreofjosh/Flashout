// Fixture library: Open Fixture Library search, GDTF / OFL file import, manual entry.
import * as store from '../store.js';
import { esc, sheet, confirmSheet, formData, toast, pickFile } from '../ui.js';
import { refresh } from '../app.js';
import { searchOFL, fetchOFL, fixtureFromFile, oflPageUrl } from '../fixtures.js';
import { loadBuiltin, searchBuiltin, fixtureFromBuiltin } from '../builtin.js';

const ui = { query: '', results: null, error: '', busy: false, filter: '', builtin: null };

const sourceTag = { ofl: 'OFL', gdtf: 'GDTF', manual: 'Manual', mvr: 'MVR', library: 'Library' };

const chText = (m) => (m.channels ? `${m.channels}ch` : '?ch');

function modeSummary(modes) {
  if (modes.length === 1) return `${esc(modes[0][0])} · ${modes[0][1] || '?'}ch`;
  const known = modes.map((m) => m[1]).filter(Boolean);
  const range = known.length ? (Math.min(...known) === Math.max(...known) ? `${known[0]}ch` : `${Math.min(...known)}–${Math.max(...known)}ch`) : '?ch';
  const unknown = modes.length - known.length;
  return `${modes.length} modes · ${range}${unknown ? ` (${unknown} unknown)` : ''}`;
}

function builtinResultsHtml() {
  if (!ui.builtin) return '<p class="muted small">Loading fixture library…</p>';
  if (!ui.query) return `<p class="muted small">${ui.builtin.length.toLocaleString()} fixtures built in. Start typing a name or manufacturer.</p>`;
  const { results, total } = searchBuiltin(ui.builtin, ui.query);
  if (!results.length) return '<p class="muted">No built-in match. Try fewer words, or search Open Fixture Library below.</p>';
  return `<ul class="rows">${results.map((f) => `
    <li><button class="row" data-action="addBuiltin" data-i="${f.i}">
      <span class="row-main"><strong>${esc(f.name)}</strong><small>${esc(f.manufacturer)} · ${modeSummary(f.modes)}</small></span>
      <span class="row-side">+ Add</span>
    </button></li>`).join('')}</ul>
    ${total > results.length ? `<p class="muted small">Showing ${results.length} of ${total}. Add more words to narrow it down.</p>` : ''}`;
}

export function editTypeSheet(type) {
  const t = type || { name: '', manufacturer: '', powerW: null, weightKg: null, notes: '', modes: [{ name: 'Standard', channels: 1 }], source: 'manual' };
  const modeRow = (m = { name: '', channels: '' }) => `
    <div class="mode-row">
      <input name="mname" value="${esc(m.name)}" placeholder="Mode name" aria-label="Mode name">
      <input name="mch" class="${m.check || m.channels === 0 ? 'needs-check' : ''}" type="number" min="0" max="512" value="${m.channels ? esc(m.channels) : ''}" placeholder="?" inputmode="numeric" aria-label="Channels" data-orig="${esc(m.channels ?? '')}">
      <button type="button" class="icon-btn" data-rm aria-label="Remove mode">✕</button>
    </div>`;
  return sheet(type ? 'Edit fixture' : 'New fixture', `
    <form class="form" data-form>
      <label>Manufacturer<input name="manufacturer" value="${esc(t.manufacturer)}" placeholder="e.g. Robe"></label>
      <label>Fixture name<input name="name" required value="${esc(t.name)}" placeholder="e.g. Spiider"></label>
      <div class="grid2">
        <label>Power (W)<input name="powerW" type="number" min="0" value="${esc(t.powerW ?? '')}" inputmode="numeric"></label>
        <label>Weight (kg)<input name="weightKg" type="number" min="0" step="0.1" value="${esc(t.weightKg ?? '')}" inputmode="decimal"></label>
      </div>
      <fieldset><legend>DMX modes</legend>
        <div data-modes>${t.modes.map(modeRow).join('')}</div>
        <button type="button" class="btn small" data-addmode>+ Add mode</button>
        ${t.modes.some((m) => m.check || !m.channels) ? '<p class="warn-text small">Highlighted channel counts are missing or uncertain. Check them against the fixture\'s manual.</p>' : ''}
      </fieldset>
      <label>Notes<textarea name="notes" rows="2" placeholder="Rigging quirks, fuse rating, power connector…">${esc(t.notes)}</textarea></label>
      ${t.source !== 'manual' && t.source ? `<p class="muted small">Imported from ${sourceTag[t.source] || t.source}${t.sourceKey ? ` (${esc(t.sourceKey)})` : ''}. Check channel counts against the fixture's manual.</p>` : ''}
      <div class="row-split">
        ${type ? '<button type="button" class="btn danger" data-del>Delete</button>' : '<span></span>'}
        <span><button type="button" class="btn" data-close>Cancel</button> <button class="btn primary">Save</button></span>
      </div>
    </form>`, (root, close) => {
    const modes = root.querySelector('[data-modes]');
    root.querySelector('[data-addmode]').addEventListener('click', () => modes.insertAdjacentHTML('beforeend', modeRow()));
    modes.addEventListener('click', (e) => { if (e.target.closest('[data-rm]') && modes.children.length > 1) e.target.closest('.mode-row').remove(); });
    root.querySelector('[data-del]')?.addEventListener('click', async () => {
      if (store.typeInUse(type.id)) { toast('This fixture is used in a gig. Remove it from those rigs first.', 'bad'); return; }
      if (await confirmSheet('Delete fixture?', `Delete ${type.name} from your library?`, 'Delete', true)) { store.deleteType(type.id); close(true); }
    });
    root.querySelector('[data-form]').addEventListener('submit', (e) => {
      e.preventDefault();
      const d = formData(e.target);
      const names = [...root.querySelectorAll('[name=mname]')].map((i) => i.value.trim());
      const chInputs = [...root.querySelectorAll('[name=mch]')];
      const chs = chInputs.map((i) => parseInt(i.value, 10) || 0);
      const modeList = names.map((name, i) => {
        const m = { ...(t.modes[i] || {}), name: name || `Mode ${i + 1}`, channels: chs[i] };
        if (String(chs[i]) !== chInputs[i].dataset.orig && chs[i]) delete m.check; // user confirmed a count
        return m;
      });
      const data = {
        name: d.name.trim(), manufacturer: d.manufacturer.trim(), notes: d.notes,
        powerW: d.powerW === '' ? null : +d.powerW, weightKg: d.weightKg === '' ? null : +d.weightKg, modes: modeList,
      };
      if (type) store.updateType(type.id, data);
      else store.addType({ ...data, source: 'manual' });
      close(true);
    });
  });
}

function addImported(t) {
  const before = store.getState().fixtureTypes.length;
  const added = store.addType(t);
  const isNew = store.getState().fixtureTypes.length > before;
  toast(isNew ? `Added ${added.name} (${added.modes.length} mode${added.modes.length === 1 ? '' : 's'})` : `${added.name} is already in your library`);
}

export const libraryView = {
  render() {
    const types = [...store.getState().fixtureTypes]
      .filter((t) => !ui.filter || `${t.manufacturer} ${t.name}`.toLowerCase().includes(ui.filter.toLowerCase()))
      .sort((a, b) => (a.manufacturer + a.name).localeCompare(b.manufacturer + b.name));

    let results = '';
    if (ui.busy) results = '<p class="muted">Searching…</p>';
    else if (ui.error) results = `
      <div class="notice">
        <p><strong>Couldn't reach Open Fixture Library.</strong> ${esc(ui.error)}</p>
        <p class="muted">You can still add fixtures: open <a href="https://open-fixture-library.org" target="_blank" rel="noopener">open-fixture-library.org</a>, find the fixture, download it as <em>OFL JSON</em> or <em>GDTF</em>, then use <strong>Import file</strong>. GDTF files from <a href="https://gdtf-share.com" target="_blank" rel="noopener">GDTF Share</a> or the manufacturer work too.</p>
      </div>`;
    else if (ui.results) results = ui.results.length
      ? `<ul class="rows">${ui.results.slice(0, 40).map((key) => {
          const [man, fx] = key.split('/');
          return `<li><button class="row" data-action="addOfl" data-key="${esc(key)}">
            <span class="row-main"><strong>${esc(fx.replace(/-/g, ' '))}</strong><small>${esc(man.replace(/-/g, ' '))}</small></span>
            <span class="row-side">+ Add</span></button></li>`;
        }).join('')}</ul>${ui.results.length > 40 ? `<p class="muted small">Showing 40 of ${ui.results.length}. Refine your search.</p>` : ''}`
      : '<p class="muted">No matches. Try the manufacturer name or a shorter search.</p>';

    return {
      title: 'Fixture library',
      section: 'library',
      html: `
        <section class="card">
          <h3>Find a fixture</h3>
          <form class="search" data-search>
            <input name="q" type="search" value="${esc(ui.query)}" placeholder="e.g. Spiider, Aura XB, Sharpy" aria-label="Search fixtures" autocomplete="off">
          </form>
          <div data-builtin>${builtinResultsHtml()}</div>
          <div class="toolbar"><button class="btn small" data-action="ofl">Not listed? Search Open Fixture Library</button></div>
          ${results}
          <div class="toolbar">
            <button class="btn" data-action="import">Import file (.gdtf / .json)</button>
            <button class="btn" data-action="manual">+ Type one in</button>
          </div>
        </section>
        <h3 class="section-title">My fixtures (${store.getState().fixtureTypes.length})</h3>
        ${store.getState().fixtureTypes.length > 6 ? `<input class="filter" type="search" placeholder="Filter my fixtures" value="${esc(ui.filter)}" data-change="filter" aria-label="Filter my fixtures">` : ''}
        ${types.length ? `<ul class="rows">${types.map((t) => `
          <li><button class="row" data-action="edit" data-id="${t.id}">
            <span class="row-main"><strong>${esc(t.name)}</strong><small>${esc(t.manufacturer)} · ${t.modes.map(chText).join(' / ')}${t.modes.some((m) => m.check || !m.channels) ? ' · <span class="warn-text">check channels</span>' : ''}</small></span>
            <span class="row-side"><span class="tag">${sourceTag[t.source] || 'Manual'}</span><small>${t.powerW ? `${t.powerW} W` : ''}</small></span>
          </button></li>`).join('')}</ul>`
          : '<div class="empty"><p class="muted">No fixtures yet. Add the ones you use most, and they\'ll be ready for every gig.</p></div>'}`,
      mount(root) {
        const form = root.querySelector('[data-search]');
        const box = root.querySelector('[data-builtin]');
        form.addEventListener('submit', (e) => e.preventDefault());
        form.q.addEventListener('input', () => {
          ui.query = form.q.value.trim();
          ui.results = null; ui.error = '';
          box.innerHTML = builtinResultsHtml();
        });
        if (!ui.builtin) {
          loadBuiltin().then((list) => { ui.builtin = list; box.innerHTML = builtinResultsHtml(); })
            .catch(() => { box.innerHTML = '<p class="muted">The built-in library could not be loaded.</p>'; });
        }
      },
      actions: {
        filter(el) { ui.filter = el.value; refresh(); },
        addBuiltin(el) {
          addImported(fixtureFromBuiltin(ui.builtin[+el.dataset.i]));
          refresh();
        },
        async ofl() {
          if (!ui.query) { toast('Type a fixture name first'); return; }
          ui.busy = true; ui.error = ''; refresh();
          try { ui.results = await searchOFL(ui.query); }
          catch (err) { ui.results = null; ui.error = navigator.onLine === false ? 'You appear to be offline.' : 'The search service didn\'t respond, or this browser blocked the request.'; }
          ui.busy = false; refresh();
        },
        async addOfl(el) {
          el.disabled = true;
          try { addImported(await fetchOFL(el.dataset.key)); }
          catch (err) { toast(`Couldn't load fixture. Download it from ${oflPageUrl(el.dataset.key)} and import the file.`, 'bad'); }
          refresh();
        },
        async import() {
          const files = await pickFile('.gdtf,.json,.zip', true);
          for (const file of files || []) {
            try { addImported(await fixtureFromFile(file)); }
            catch (err) { toast(`${file.name}: ${err.message}`, 'bad'); }
          }
          refresh();
        },
        async manual() { if (await editTypeSheet()) refresh(); },
        async edit(el) { if (await editTypeSheet(store.getType(el.dataset.id))) refresh(); },
      },
    };
  },
};
