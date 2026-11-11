import * as store from '../store.js';
import { esc, sheet, confirmSheet, formData, toast } from '../ui.js';
import { go, refresh } from '../app.js';
import { checklistFor } from './common.js';
import { importMVR } from './mvrImport.js';

export function gigForm(g = {}) {
  return `
    <form class="form" data-form>
      <label>Gig / show name<input name="name" required value="${esc(g.name)}" placeholder="e.g. Corporate awards dinner"></label>
      <label>Venue<input name="venue" value="${esc(g.venue)}" placeholder="e.g. Hall 3, ExCeL"></label>
      <label>Client / company<input name="client" value="${esc(g.client)}" placeholder="Who you're working for"></label>
      <label>Date<input name="date" type="date" value="${esc(g.date)}"></label>
      <label>Notes<textarea name="notes" rows="3" placeholder="Crew chief, call times, anything useful">${esc(g.notes)}</textarea></label>
      <div class="row-end"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary">Save</button></div>
    </form>`;
}

export function editGigSheet(gig) {
  return sheet(gig ? 'Edit gig' : 'New gig', gigForm(gig), (root, close) => {
    root.querySelector('[data-form]').addEventListener('submit', (e) => {
      e.preventDefault();
      const data = formData(e.target);
      if (gig) store.updateGig(gig.id, data);
      close(gig || store.addGig(data));
    });
  });
}

function progress(gig) {
  const s = store.getState().settings;
  let total = 0, done = 0, faults = 0;
  for (const f of gig.fixtures) {
    const items = checklistFor(f, s);
    total += items.length;
    done += items.filter((i) => f.checks[i]).length;
    faults += f.faults.filter((x) => !x.resolved).length;
  }
  return { pct: total ? Math.round((done / total) * 100) : 0, faults };
}

const fmtDate = (d) => (d ? new Date(d + 'T00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : '');

export const gigsView = {
  render() {
    const { gigs } = store.getState();
    const list = gigs.length
      ? gigs.map((g) => {
          const p = progress(g);
          return `
          <article class="card gig-card">
            <a class="gig-link" href="#gig-${g.id}-rig">
              <h3>${esc(g.name || 'Untitled gig')}</h3>
              <p class="muted">${esc([g.venue, g.client].filter(Boolean).join(' · ')) || '&nbsp;'}</p>
              <p class="meta">${esc(fmtDate(g.date))}${g.date ? ' · ' : ''}${g.fixtures.length} fixtures${p.faults ? ` · <span class="bad-text">${p.faults} open fault${p.faults > 1 ? 's' : ''}</span>` : ''}</p>
              <div class="bar" aria-label="Prep ${p.pct}% done"><span style="width:${p.pct}%"></span></div>
            </a>
            <button class="icon-btn" data-action="menu" data-id="${g.id}" aria-label="Gig options">⋯</button>
          </article>`;
        }).join('')
      : `<div class="empty">
          <img class="hero-logo" src="icons/icon.svg" alt="Flashout logo" width="96" height="96">
          <h2 class="hero-name">Flashout</h2>
          <p class="tagline">Prep it. Patch it. Flash it out.</p>
          <h3>No gigs yet</h3>
          <p class="muted">Make a gig for each job, then add the rig, prep each fixture and build the patch.</p>
        </div>`;

    return {
      title: 'Gigs',
      section: 'gigs',
      html: `<div class="toolbar"><button class="btn primary" data-action="new">+ New gig</button><button class="btn" data-action="mvr">New gig from MVR</button></div>${list}`,
      actions: {
        async new() {
          const gig = await editGigSheet();
          if (gig) go(`gig-${gig.id}-rig`);
        },
        async mvr() {
          const id = await importMVR();
          if (id) go(`gig-${id}-rig`);
        },
        async menu(el) {
          const gig = store.getGig(el.dataset.id);
          const choice = await sheet(gig.name || 'Gig', `
            <div class="menu">
              <button class="btn block" data-v="edit">Edit details</button>
              <button class="btn block" data-v="dup">Copy as new gig (keep rig &amp; patch)</button>
              <button class="btn block" data-v="dup-clean">Copy as new gig (rig only, clear patch)</button>
              <button class="btn block danger" data-v="del">Delete gig</button>
            </div>`, (root, close) => root.addEventListener('click', (e) => { const b = e.target.closest('[data-v]'); if (b) close(b.dataset.v); }));
          if (choice === 'edit') { await editGigSheet(gig); refresh(); }
          if (choice === 'dup' || choice === 'dup-clean') {
            store.duplicateGig(gig.id, { keepPatch: choice === 'dup' });
            toast('Gig copied. Prep checks and faults start fresh.');
            refresh();
          }
          if (choice === 'del' && (await confirmSheet('Delete gig?', `Delete "${gig.name}" and its rig, patch and prep notes? This can't be undone.`, 'Delete', true))) {
            store.deleteGig(gig.id);
            refresh();
          }
        },
      },
    };
  },
};
