// Power tab: distros, circuits, fixture assignment (drag & drop on desktop, select + tap on touch).
import * as store from '../store.js';
import { esc, sheet, confirmSheet, formData, toast } from '../ui.js';
import { refresh } from '../app.js';
import { naturalCompare } from '../patch.js';
import {
  PHASES, VIA, MULTICORE, cableCount, runColour, unitRanges, WARN_PCT, DEFAULT_POWER, TEMPLATES, makeDistro, makeCircuit, runFor, analyse, powerIssues, autoAssign, amps, fixtureWatts,
} from '../power.js';
import { typeLabel, sortFixtures } from './common.js';

const getType = (id) => store.getType(id);
const ui = { selected: new Set(), filter: '__unassigned', gigId: null, autoDistro: '' };

export const ensurePower = (gig) => (gig.power ||= DEFAULT_POWER());

const fmtA = (a) => (a >= 10 ? a.toFixed(0) : a.toFixed(1));
const level = (pct) => (pct > 1 ? 'over' : pct > WARN_PCT ? 'high' : 'ok');
const bar = (pct) => `<div class="load"><span class="${level(pct)}" style="width:${Math.min(100, pct * 100).toFixed(1)}%"></span></div>`;

function distroSheet(gig, d = null) {
  const custom = { supply: d?.supply || '3ph', ratingA: d?.ratingA || 63 };
  return sheet(d ? `Edit ${d.name}` : 'Add distro', `
    <form class="form" data-form>
      <label>Name<input name="name" required value="${esc(d?.name || `Distro ${ensurePower(gig).distros.length + 1}`)}" placeholder="e.g. DS distro, Dimmer city"></label>
      ${d ? '' : `<label>Type
        <select name="template">${TEMPLATES.map((t) => `<option value="${t.key}">${esc(t.label)}</option>`).join('')}<option value="custom">Custom…</option></select>
      </label>`}
      <div class="grid3" data-custom ${d ? '' : 'hidden'}>
        <label>Supply<select name="supply"><option value="3ph" ${custom.supply === '3ph' ? 'selected' : ''}>3-phase 400V</option><option value="1ph" ${custom.supply === '1ph' ? 'selected' : ''}>Single 230V</option></select></label>
        <label>Supply A<input name="ratingA" type="number" min="1" value="${custom.ratingA}" inputmode="numeric"></label>
        ${d ? '' : `<label>Outputs<input name="outputs" type="number" min="1" max="96" value="12" inputmode="numeric"></label><label>Output A<input name="outA" type="number" min="1" value="10" inputmode="numeric"></label>
        <label>Via<select name="via">${VIA.map((v) => `<option>${v}</option>`).join('')}</select></label>`}
      </div>
      ${d ? `
      <fieldset><legend>Circuits</legend>
        <div class="bulk-row">
          <span class="muted small">Set all:</span>
          <select data-bulk-via aria-label="Via for all circuits">${VIA.map((v) => `<option>${v}</option>`).join('')}</select>
          <label class="small">runs of <input data-bulk-size type="number" min="0" max="24" value="${MULTICORE[d.circuits[0]?.via]?.circuits || 6}" inputmode="numeric"></label>
          <button type="button" class="btn small" data-bulk>Apply</button>
        </div>
        <div class="circuit-head muted small"><span>Label</span><span>Phase</span><span>Amps</span><span>Via</span><span>Run</span><span></span></div>
        <div class="circuit-edit" data-circuits>${d.circuits.map((c) => circuitRow(c, d.supply)).join('')}</div>
        <button type="button" class="btn small" data-addc>+ Add circuit</button>
      </fieldset>` : ''}
      <div class="row-split">
        ${d ? '<button type="button" class="btn danger" data-del>Delete distro</button>' : '<span></span>'}
        <span><button type="button" class="btn" data-close>Cancel</button> <button class="btn primary">Save</button></span>
      </div>
    </form>`, (root, close) => {
    const tpl = root.querySelector('[name=template]');
    tpl?.addEventListener('change', () => { root.querySelector('[data-custom]').hidden = tpl.value !== 'custom'; });
    const list = root.querySelector('[data-circuits]');
    root.querySelector('[data-addc]')?.addEventListener('click', () => {
      const last = list.lastElementChild;
      list.insertAdjacentHTML('beforeend', circuitRow(makeCircuit(String(list.children.length + 1), PHASES[list.children.length % 3],
        +(last?.querySelector('[data-f=rating]').value) || 10, last?.querySelector('[data-f=via]').value || '10A', last?.querySelector('[data-f=run]').value || ''), root.querySelector('[name=supply]').value));
    });
    list?.addEventListener('click', (e) => { if (e.target.closest('[data-rmc]')) e.target.closest('.circuit-row').remove(); });
    root.querySelector('[data-bulk-via]')?.addEventListener('change', (e) => {
      const m = MULTICORE[e.target.value];
      if (m) root.querySelector('[data-bulk-size]').value = m.circuits;
    });
    root.querySelector('[data-bulk]')?.addEventListener('click', () => {
      const via = root.querySelector('[data-bulk-via]').value;
      const size = +root.querySelector('[data-bulk-size]').value || 0;
      const name = MULTICORE[via]?.short || 'Run';
      [...list.querySelectorAll('.circuit-row')].forEach((row, i) => {
        row.querySelector('[data-f=via]').value = via;
        row.querySelector('[data-f=run]').value = via === '10A' || via === '16A' || via === '32A' ? '' : runFor(i, size, name);
      });
    });
    root.querySelector('[data-del]')?.addEventListener('click', async () => {
      if (!(await confirmSheet('Delete distro?', `Delete ${d.name}? Fixtures on its circuits become unassigned.`, 'Delete', true))) return;
      const ids = new Set(d.circuits.map((c) => c.id));
      gig.fixtures.forEach((f) => { if (ids.has(f.circuit)) f.circuit = null; });
      gig.power.distros = gig.power.distros.filter((x) => x !== d);
      store.save();
      close(true);
    });
    root.querySelector('[data-form]').addEventListener('submit', (e) => {
      e.preventDefault();
      const v = formData(e.target);
      const power = ensurePower(gig);
      if (!d) {
        const t = TEMPLATES.find((x) => x.key === v.template);
        power.distros.push(makeDistro(t ? { ...t, name: v.name } : {
          name: v.name, supply: v.supply, ratingA: +v.ratingA || 32, outputs: Math.max(1, +v.outputs || 1), outA: +v.outA || 10, via: v.via,
          runSize: MULTICORE[v.via]?.circuits || 0, runName: MULTICORE[v.via]?.short || '',
        }));
      } else {
        d.name = v.name; d.supply = v.supply; d.ratingA = +v.ratingA || d.ratingA;
        const old = new Set(d.circuits.map((c) => c.id));
        const keep = new Set();
        d.circuits = [...list.querySelectorAll('.circuit-row')].map((row) => {
          const c = {
            id: row.dataset.id, label: row.querySelector('[data-f=label]').value.trim() || '?',
            phase: d.supply === '3ph' ? row.querySelector('[data-f=phase]').value : 'L1',
            ratingA: +row.querySelector('[data-f=rating]').value || 10,
            via: row.querySelector('[data-f=via]').value, run: row.querySelector('[data-f=run]').value.trim(),
          };
          keep.add(c.id);
          return c;
        });
        gig.fixtures.forEach((f) => { if (old.has(f.circuit) && !keep.has(f.circuit)) f.circuit = null; });
      }
      store.save();
      close(true);
    });
  });
}

function circuitRow(c, supply) {
  return `<div class="circuit-row" data-id="${c.id}">
    <input data-f="label" value="${esc(c.label)}" aria-label="Circuit label">
    <select data-f="phase" ${supply === '3ph' ? '' : 'disabled'} aria-label="Phase">${PHASES.map((p) => `<option ${p === c.phase ? 'selected' : ''}>${p}</option>`).join('')}</select>
    <input data-f="rating" type="number" min="1" value="${c.ratingA}" inputmode="numeric" aria-label="Rating (A)">
    <select data-f="via" aria-label="Via">${VIA.map((v) => `<option ${v === (c.via || '10A') ? 'selected' : ''}>${v}</option>`).join('')}</select>
    <input data-f="run" value="${esc(c.run || '')}" placeholder="e.g. Soca 1" aria-label="Multicore run">
    <button type="button" class="icon-btn" data-rmc aria-label="Remove circuit">✕</button>
  </div>`;
}

export function power(gig) {
  const p = ensurePower(gig);
  if (ui.gigId !== gig.id) { ui.selected.clear(); ui.gigId = gig.id; }
  const a = analyse(gig.fixtures, p, getType);
  const issues = powerIssues(a, p, getType);
  const problems = issues.filter((i) => i.level !== 'info');
  const circuitOf = new Map();
  for (const d of p.distros) for (const c of d.circuits) circuitOf.set(c.id, { d, c });

  // Fixture list (left panel)
  const positions = [...new Set(gig.fixtures.map((f) => f.position || ''))].sort(naturalCompare);
  let list = sortFixtures(gig.fixtures);
  if (ui.filter === '__unassigned') list = list.filter((f) => !circuitOf.has(f.circuit));
  else if (ui.filter !== '__all') list = list.filter((f) => (f.position || '') === ui.filter);
  for (const fid of [...ui.selected]) if (!gig.fixtures.some((f) => f.id === fid)) ui.selected.delete(fid);
  const sel = ui.selected.size;

  const missingTypes = [...new Map(a.noWatts.map((f) => [f.typeId, getType(f.typeId)])).values()].filter(Boolean);

  const fixturesPanel = `
    <aside class="panel fixtures-panel">
      <header class="panel-head">
        <h3>Fixtures</h3>
        <select data-change="pfilter" aria-label="Show fixtures">
          <option value="__unassigned" ${ui.filter === '__unassigned' ? 'selected' : ''}>Not on a circuit (${a.unassigned.length})</option>
          <option value="__all" ${ui.filter === '__all' ? 'selected' : ''}>All (${gig.fixtures.length})</option>
          ${positions.map((pos) => `<option value="${esc(pos)}" ${ui.filter === pos ? 'selected' : ''}>${esc(pos || 'No position')}</option>`).join('')}
        </select>
      </header>
      <div class="sel-bar">
        <label class="switch"><input type="checkbox" data-change="selAll" ${list.length && list.every((f) => ui.selected.has(f.id)) ? 'checked' : ''}> Select all shown</label>
        ${sel ? `<span><strong>${sel}</strong> selected · ${fmtA(gig.fixtures.filter((f) => ui.selected.has(f.id)).reduce((s, f) => s + amps(fixtureWatts(f, getType), p), 0))}A <button class="btn small" data-action="unassignSel">Unplug</button></span>` : '<span class="muted small hide-touch">Drag onto a circuit, or select then click a circuit</span>'}
      </div>
      <ul class="fx-list">${list.map((f) => {
        const t = getType(f.typeId);
        const w = fixtureWatts(f, getType);
        const at = circuitOf.get(f.circuit);
        return `<li draggable="true" data-fid="${f.id}" class="${ui.selected.has(f.id) ? 'sel' : ''}">
          <label><input type="checkbox" data-change="sel" data-id="${f.id}" ${ui.selected.has(f.id) ? 'checked' : ''}>
          <span class="unit sm">${esc(f.unit || '–')}</span>
          <span class="row-main"><strong>${esc(typeLabel(t))}</strong><small>${esc(f.position || 'No position')}${at ? ` · ${esc(at.d.name)} / ${esc(at.c.label)}` : ''}</small></span>
          <span class="watts ${w ? '' : 'warn-text'}">${w ? `${w} W` : '? W'}</span></label>
        </li>`;
      }).join('') || '<li class="muted empty-li">Nothing here.</li>'}</ul>
    </aside>`;

  const distroCards = p.distros.map((d) => {
    const info = a.distros.find((x) => x.distro === d);
    return `<section class="panel distro">
      <header class="panel-head">
        <div><h3>${esc(d.name)}</h3><small class="muted">${d.supply === '3ph' ? '3-phase 400V' : 'Single-phase 230V'} · ${d.ratingA}A${d.supply === '3ph' ? ' per phase' : ''} · ${(info.watts / 1000).toFixed(1)} kW</small></div>
        <button class="btn small" data-action="editDistro" data-id="${d.id}">Edit</button>
      </header>
      <div class="phases">${Object.entries(info.phases).map(([ph, A]) => `
        <div class="phase"><span class="ph ${ph}">${d.supply === '3ph' ? ph : 'Supply'}</span>${bar(A / d.ratingA)}<span class="amps">${fmtA(A)} / ${d.ratingA}A</span></div>`).join('')}
        ${info.unbalanced ? `<p class="warn-text small">Phases ${Math.round(info.imbalance * 100)}% unbalanced</p>` : ''}
      </div>
      <div class="circuits">${d.circuits.map((c) => {
        const s = a.circuits.get(c.id);
        const pct = s.amps / c.ratingA;
        return `<div class="circuit ${level(pct)} ${sel ? 'target' : ''}" data-cid="${c.id}" data-action="${sel ? 'assignHere' : ''}" ${sel ? 'role="button" tabindex="0"' : ''}>
          <div class="c-head"><strong>${esc(c.label)}</strong>${d.supply === '3ph' ? `<span class="ph ${c.phase}">${c.phase}</span>` : ''}<span class="amps">${fmtA(s.amps)}/${c.ratingA}A</span></div>
          <div class="via">${(() => { const col = runColour(d, c); return col ? `<span class="swatch" style="background:${col.bg}"></span>${esc(c.run || c.via)} · ${col.name}` : esc(c.run || c.via || ''); })()}</div>
          ${bar(pct)}
          <div class="chips-in">${s.fixtures.sort((x, y) => naturalCompare(x.unit, y.unit)).map((f) => `<button class="fx-chip" data-action="unplug" data-id="${f.id}" title="${esc(typeLabel(getType(f.typeId)))} · click to unplug">${esc(f.unit || '–')}</button>`).join('')}</div>
        </div>`;
      }).join('')}</div>
    </section>`;
  }).join('');

  return {
    wide: true,
    html: `
      <p class="desktop-hint">Power planning works best on a laptop or desktop. On a phone: select fixtures, then tap a circuit.</p>
      <div class="toolbar">
        <button class="btn primary" data-action="addDistro">+ Add distro</button>
        <span class="auto-group">
          <button class="btn" data-action="auto" ${p.distros.length ? '' : 'disabled'}>Auto-assign ${sel ? `${sel} selected` : 'unassigned'}</button>
          ${p.distros.length > 1 ? `<select data-change="autoDistro" aria-label="Auto-assign into">
            <option value="">into any distro</option>
            ${p.distros.map((d) => `<option value="${d.id}" ${ui.autoDistro === d.id ? 'selected' : ''}>into ${esc(d.name)}</option>`).join('')}
          </select>` : ''}
        </span>
        <button class="btn" data-action="clearAll" ${gig.fixtures.some((f) => f.circuit) ? '' : 'disabled'}>Unplug all</button>
        <span class="settings-inline">
          <label>Voltage <input type="number" data-change="voltage" value="${p.voltage}" min="100" max="260" inputmode="numeric"></label>
          <label>Power factor <input type="number" data-change="pf" value="${p.pf}" min="0.5" max="1" step="0.05" inputmode="decimal"></label>
        </span>
      </div>
      <section class="card ${problems.some((i) => i.level === 'error') ? 'issues-bad' : problems.length ? '' : 'issues-ok'}">
        <p><strong>${(a.totalWatts / 1000).toFixed(1)} kW</strong> total · ${fmtA(amps(a.totalWatts, p))}A at ${p.voltage}V single-phase equivalent${p.distros.length ? '' : ' · add a distro to start'}</p>
        ${problems.length ? `<ul class="issues">${problems.map((i) => `<li class="${i.level}">${esc(i.text)}</li>`).join('')}</ul>` : (p.distros.length && !a.unassigned.length ? '<p><strong>✓ All fixtures on circuits within limits</strong></p>' : '')}
        ${missingTypes.length ? `<div class="watt-fix"><p class="small">Set wattage (saved to your library):</p>${missingTypes.map((t) => `
          <label class="inline-field">${esc(t.name)} <input type="number" min="0" placeholder="W" data-change="setWatts" data-type="${t.id}" inputmode="numeric"> W</label>`).join('')}</div>` : ''}
        <p class="muted small">Amps = watts ÷ (${p.voltage}V × ${p.pf} power factor). Warnings at ${WARN_PCT * 100}% of a circuit or phase rating. Check against manufacturer data and the venue's supply.</p>
      </section>
      ${gig.fixtures.length ? `<div class="power-layout">${fixturesPanel}<div class="distros">${distroCards || `
        <div class="empty panel"><h3>No distros yet</h3><p class="muted">Add the distro(s) you're working from, e.g. a 32A 3-phase with 12 × 10A circuits on Socapex.</p></div>`}</div></div>`
        : '<div class="empty"><h3>No fixtures</h3><p class="muted">Add fixtures in the Rig tab first.</p></div>'}
      ${p.distros.length ? cableHtml(gig) : ''}`,
    mount(root) {
      // Desktop drag & drop: drag a fixture (or the whole selection) onto a circuit.
      root.querySelectorAll('.fx-list li[draggable]').forEach((li) => li.addEventListener('dragstart', (e) => {
        const fid = li.dataset.fid;
        const ids = ui.selected.has(fid) ? [...ui.selected] : [fid];
        e.dataTransfer.setData('text/plain', ids.join(','));
        e.dataTransfer.effectAllowed = 'move';
      }));
      root.querySelectorAll('.circuit').forEach((el) => {
        el.addEventListener('dragover', (e) => { e.preventDefault(); el.classList.add('drop'); });
        el.addEventListener('dragleave', () => el.classList.remove('drop'));
        el.addEventListener('drop', (e) => {
          e.preventDefault();
          const ids = e.dataTransfer.getData('text/plain').split(',').filter(Boolean);
          assign(gig, ids, el.dataset.cid);
        });
        el.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && ui.selected.size) { e.preventDefault(); assign(gig, [...ui.selected], el.dataset.cid); } });
      });
    },
    actions: {
      pfilter(el) { ui.filter = el.value; refresh(); },
      autoDistro(el) { ui.autoDistro = el.value; },
      sel(el) { el.checked ? ui.selected.add(el.dataset.id) : ui.selected.delete(el.dataset.id); refresh(); },
      selAll(el) { for (const f of list) el.checked ? ui.selected.add(f.id) : ui.selected.delete(f.id); refresh(); },
      voltage(el) { p.voltage = Math.min(260, Math.max(100, +el.value || 230)); store.save(); refresh(); },
      pf(el) { p.pf = Math.min(1, Math.max(0.5, +el.value || 0.9)); store.save(); refresh(); },
      setWatts(el) {
        const w = parseInt(el.value, 10);
        if (!w) return;
        store.updateType(el.dataset.type, { powerW: w });
        toast(`${getType(el.dataset.type).name}: ${w} W saved to library`);
        refresh();
      },
      async addDistro() { if (await distroSheet(gig)) refresh(); },
      async editDistro(el) { if (await distroSheet(gig, p.distros.find((d) => d.id === el.dataset.id))) refresh(); },
      assignHere(el) { assign(gig, [...ui.selected], el.dataset.cid); },
      unplug(el, e) {
        e.stopPropagation();
        if (ui.selected.size) { assign(gig, [...ui.selected], el.closest('.circuit').dataset.cid); return; }
        store.updateFixture(gig.id, el.dataset.id, { circuit: null });
        refresh();
      },
      unassignSel() {
        gig.fixtures.forEach((f) => { if (ui.selected.has(f.id)) f.circuit = null; });
        store.save();
        refresh();
      },
      async clearAll() {
        if (!(await confirmSheet('Unplug everything?', 'Take every fixture off its circuit?', 'Unplug all', true))) return;
        gig.fixtures.forEach((f) => { f.circuit = null; });
        store.save();
        refresh();
      },
      auto() {
        const { assigned, skipped } = autoAssign(gig.fixtures, p, getType, {
          onlyIds: ui.selected.size ? new Set(ui.selected) : null,
          distroId: p.distros.some((d) => d.id === ui.autoDistro) ? ui.autoDistro : null,
        });
        for (const [fid, cid] of assigned) store.getFixture(gig, fid).circuit = cid;
        store.save();
        ui.selected.clear();
        const noW = skipped.filter((s) => s.why === 'no wattage').length;
        const full = skipped.length - noW;
        toast(`Assigned ${assigned.size}${noW ? ` · ${noW} need wattage` : ''}${full ? ` · ${full} didn't fit, add a distro` : ''}`, skipped.length ? 'bad' : '');
        refresh();
      },
    },
  };
}

function assign(gig, ids, cid) {
  if (!ids.length) return;
  const p = ensurePower(gig);
  const before = analyse(gig.fixtures, p, getType);
  for (const fid of ids) { const f = store.getFixture(gig, fid); if (f) f.circuit = cid; }
  store.save();
  ui.selected.clear();
  const after = analyse(gig.fixtures, p, getType);
  const c = p.distros.flatMap((d) => d.circuits).find((x) => x.id === cid);
  const s = after.circuits.get(cid);
  const pct = s.amps / c.ratingA;
  if (pct > 1) toast(`Circuit ${c.label} is overloaded: ${s.amps.toFixed(1)}A of ${c.ratingA}A`, 'bad');
  else if (pct > WARN_PCT && before.circuits.get(cid).amps / c.ratingA <= WARN_PCT) toast(`Circuit ${c.label} now at ${Math.round(pct * 100)}%`, 'bad');
  refresh();
}

function cableHtml(gig) {
  const { runs, totals, warnings } = cableCount(gig.fixtures, ensurePower(gig));
  const used = runs.filter((r) => r.used).sort((a, b) => naturalCompare(a.distro.name + a.name, b.distro.name + b.name));
  if (!runs.length) return `<section class="card cables"><h3>Multicore</h3><p class="muted small">No Socapex or Wieland circuits. Set "Via" on a distro's circuits to count runs and breakouts.</p></section>`;
  const totalLine = Object.entries(totals).map(([via, t]) => `<li><strong>${t.runs} × ${esc(via)}</strong> run${t.runs === 1 ? '' : 's'} · ${t.breakouts} breakout${t.breakouts === 1 ? '' : 's'}</li>`).join('');
  return `<section class="card cables">
    <h3>Multicore</h3>
    ${totalLine ? `<ul class="chips big">${totalLine}</ul>` : '<p class="muted">No fixtures on Socapex or Wieland circuits yet.</p>'}
    ${warnings.length ? `<ul class="issues">${warnings.map((w) => `<li class="warn">${esc(w)}</li>`).join('')}</ul>` : ''}
    ${used.length ? `<div class="table-wrap"><table class="patch-table">
      <thead><tr><th>Run</th><th>Distro</th><th>Circuits used</th><th>Feeds</th></tr></thead>
      <tbody>${used.map((r) => `<tr class="${r.positions.size > 1 ? 'warn' : ''}"><td><strong>${esc(r.name)}</strong> <small>${esc(r.via)}</small></td><td>${esc(r.distro.name)}</td>
        <td>${r.used}/${r.circuits.length} (${r.circuits.map((c) => esc(c.label)).join(', ')})</td><td>${esc([...r.positions].join(', '))}</td></tr>`).join('')}</tbody>
    </table></div>` : ''}
    <p class="muted small">Counts runs with at least one fixture on them, and one breakout per run. Unused runs aren't counted.</p>
  </section>`;
}

// Printable power plan for the Print tab.
export function powerPrintHtml(gig) {
  const p = ensurePower(gig);
  const a = analyse(gig.fixtures, p, getType);
  if (!p.distros.length) return '<p>No distros set up. Plan power in the Power tab.</p>';
  return a.distros.map(({ distro: d, phases, watts }) => `
    <h3>${esc(d.name)} <small>(${d.supply === '3ph' ? '3-phase' : 'single-phase'} ${d.ratingA}A · ${(watts / 1000).toFixed(1)} kW · ${Object.entries(phases).map(([ph, A]) => `${d.supply === '3ph' ? ph : 'Supply'} ${A.toFixed(1)}A`).join(', ')})</small></h3>
    <table class="print-table">
      <thead><tr><th>Circuit</th><th>Phase</th><th>Rating</th><th>Via</th><th>Fixtures</th><th>W</th><th>A</th><th>%</th></tr></thead>
      <tbody>${d.circuits.map((c) => {
        const s = a.circuits.get(c.id);
        const groups = new Map();
        for (const f of s.fixtures.sort((x, y) => naturalCompare(x.unit, y.unit))) {
          const k = typeLabel(getType(f.typeId));
          if (!groups.has(k)) groups.set(k, []);
          groups.get(k).push(f.unit || '–');
        }
        return `<tr><td><strong>${esc(c.label)}</strong></td><td>${d.supply === '3ph' ? c.phase : ''}</td><td>${c.ratingA}A</td><td>${esc(c.run || c.via || '')}</td>
          <td>${[...groups].map(([k, units]) => `${esc(k)}: ${esc(units.join(', '))}`).join('<br>') || '—'}</td>
          <td>${s.watts || ''}</td><td>${s.amps ? s.amps.toFixed(1) : ''}</td><td>${s.amps ? Math.round((s.amps / c.ratingA) * 100) : ''}</td></tr>`;
      }).join('')}</tbody>
    </table>`).join('') + cablePrintHtml(gig) + (a.unassigned.length ? `<p><strong>Not on a circuit:</strong> ${a.unassigned.map((f) => esc(f.unit || '–')).join(', ')}</p>` : '');
}

function cablePrintHtml(gig) {
  const { runs, totals } = cableCount(gig.fixtures, ensurePower(gig));
  const used = runs.filter((r) => r.used);
  if (!used.length) return '';
  return `<h3>Multicore pull list</h3>
    <p>${Object.entries(totals).map(([via, t]) => `<strong>${t.runs} × ${esc(via)}</strong> + ${t.breakouts} breakout${t.breakouts === 1 ? '' : 's'}`).join(' · ')}</p>
    <table class="print-table"><thead><tr><th>Run</th><th>Type</th><th>Distro</th><th>Feeds</th><th>Circuits used</th></tr></thead>
    <tbody>${used.map((r) => `<tr><td>${esc(r.name)}</td><td>${esc(r.via)}</td><td>${esc(r.distro.name)}</td><td>${esc([...r.positions].join(', '))}</td><td>${r.used}/${r.circuits.length}</td></tr>`).join('')}</tbody></table>`;
}

// Breaker labels data: one sheet per distro, one row per multicore run, coloured by resistor code.
export function breakerModel(gig, distroId = '__all') {
  const p = ensurePower(gig);
  const a = analyse(gig.fixtures, p, getType);
  const distros = p.distros.filter((d) => distroId === '__all' || d.id === distroId);
  return distros.map((d) => {
    const rows = [];
    for (const c of d.circuits) {
      const key = MULTICORE[c.via] ? `${c.via}:${c.run || c.id}` : null;
      const last = rows[rows.length - 1];
      if (last && key && last.key === key) last.circuits.push(c);
      else if (last && !key && !last.key && last.circuits.length < 6) last.circuits.push(c);
      else rows.push({ key, circuits: [c] });
    }
    return {
      title: d.name,
      subtitle: [gig.name, `${d.supply === '3ph' ? '3-phase' : 'single-phase'} ${d.ratingA}A`, gig.venue].filter(Boolean).join(' · '),
      rows: rows.map((r) => {
        const first = r.circuits[0];
        const col = runColour(d, first);
        return {
          tag: { label: col ? (first.run || first.via) : 'Outlets', colour: col?.name || '', via: first.via || '', bg: col?.bg || '', fg: col?.fg || '' },
          cells: r.circuits.map((c) => {
            const s = a.circuits.get(c.id);
            const byPos = new Map();
            for (const f of [...s.fixtures].sort((x, y) => naturalCompare(x.unit, y.unit))) {
              const pos = f.position || 'No position';
              if (!byPos.has(pos)) byPos.set(pos, new Map());
              const k = typeLabel(getType(f.typeId));
              if (!byPos.get(pos).has(k)) byPos.get(pos).set(k, []);
              byPos.get(pos).get(k).push(f.unit || '–');
            }
            return {
              ch: c.label,
              meta: `${d.supply === '3ph' ? `${c.phase} · ` : ''}${c.ratingA}A`,
              feeds: [...byPos].map(([pos, types]) => ({ pos, lines: [...types].map(([t, units]) => `${t}: ${unitRanges(units)}`) })),
              load: s.fixtures.length ? `${s.amps.toFixed(1)}A · ${Math.round((s.amps / c.ratingA) * 100)}%` : '',
              spare: !s.fixtures.length,
              bg: col?.bg || '', fg: col?.fg || '',
            };
          }),
        };
      }),
    };
  });
}

export function breakerPrintHtml(gig, distroId = '__all') {
  const sheets = breakerModel(gig, distroId);
  if (!sheets.length) return '<p>No distros set up. Plan power in the Power tab.</p>';
  const style = (x) => (x.bg ? `background:${x.bg};color:${x.fg}` : '');
  return sheets.map((sh) => {
    const cols = Math.max(...sh.rows.map((r) => r.cells.length));
    return `<section class="breaker-sheet">
      <header class="breaker-title"><h2>${esc(sh.title)}</h2><p>${esc(sh.subtitle)}</p></header>
      ${sh.rows.map((r) => `<div class="breaker-row" style="--cols:${cols}">
        <div class="run-tag" style="${style(r.tag)}"><strong>${esc(r.tag.label)}</strong>${r.tag.colour ? `<span>${esc(r.tag.colour)}</span>` : ''}<small>${esc(r.tag.via)}</small></div>
        ${r.cells.map((c) => `<div class="breaker ${c.spare ? 'spare' : ''}">
          <div class="breaker-band" style="${style(c)}"><span class="ch">${esc(c.ch)}</span><span class="brk-meta">${esc(c.meta)}</span></div>
          <div class="breaker-body">${c.spare ? '<div class="feed spare-text">SPARE</div>' : c.feeds.map((f) => `<div class="feed"><b>${esc(f.pos)}</b>${f.lines.map((l) => `<span>${esc(l)}</span>`).join('')}</div>`).join('')}</div>
          ${c.load ? `<div class="breaker-load">${esc(c.load)}</div>` : ''}
        </div>`).join('')}
      </div>`).join('')}
    </section>`;
  }).join('');
}

// Power plan as PDF table sections.
export function powerPdfSections(gig) {
  const p = ensurePower(gig);
  const a = analyse(gig.fixtures, p, getType);
  if (!p.distros.length) return [{ note: 'No distros set up. Plan power in the Power tab.' }];
  const sections = a.distros.map(({ distro: d, phases, watts }) => ({
    heading: d.name,
    note: `${d.supply === '3ph' ? '3-phase' : 'Single-phase'} ${d.ratingA}A · ${(watts / 1000).toFixed(1)} kW · ${Object.entries(phases).map(([ph, A]) => `${d.supply === '3ph' ? ph : 'Supply'} ${A.toFixed(1)}A`).join(', ')}`,
    head: ['Circuit', 'Phase', 'Rating', 'Via', 'Fixtures', 'W', 'A', '%'],
    body: d.circuits.map((c) => {
      const s = a.circuits.get(c.id);
      const groups = new Map();
      for (const f of [...s.fixtures].sort((x, y) => naturalCompare(x.unit, y.unit))) {
        const k = `${f.position || 'No position'} · ${typeLabel(getType(f.typeId))}`;
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(f.unit || '–');
      }
      const col = runColour(d, c);
      return [c.label, d.supply === '3ph' ? c.phase : '', `${c.ratingA}A`, `${c.run || c.via || ''}${col ? ` (${col.name})` : ''}`,
        [...groups].map(([k, u]) => `${k}: ${unitRanges(u)}`).join('\n') || '-',
        s.watts || '', s.amps ? s.amps.toFixed(1) : '', s.amps ? Math.round((s.amps / c.ratingA) * 100) : ''];
    }),
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 16 }, 1: { cellWidth: 13 }, 2: { cellWidth: 15 }, 3: { cellWidth: 30 }, 5: { cellWidth: 14 }, 6: { cellWidth: 12 }, 7: { cellWidth: 11 } },
  }));
  const { runs, totals } = cableCount(gig.fixtures, p);
  const used = runs.filter((r) => r.used);
  if (used.length) {
    sections.push({
      heading: 'Multicore pull list',
      note: Object.entries(totals).map(([via, t]) => `${t.runs} x ${via} + ${t.breakouts} breakout${t.breakouts === 1 ? '' : 's'}`).join(' · '),
      head: ['Run', 'Type', 'Distro', 'Feeds', 'Circuits used'],
      body: used.map((r) => [r.name, r.via, r.distro.name, [...r.positions].join(', '), `${r.used}/${r.circuits.length}`]),
    });
  }
  if (a.unassigned.length) sections.push({ note: `Not on a circuit: ${a.unassigned.map((f) => f.unit || '-').join(', ')}` });
  return sections;
}
