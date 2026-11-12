// Flashout: app shell and router.
import * as store from './store.js';
import { esc, $ } from './ui.js';
import { gigsView } from './views/gigs.js';
import { gigView } from './views/gig.js';
import { libraryView } from './views/library.js';
import { settingsView } from './views/settings.js';
import { getMode, onModeChange } from './mode.js';

store.load();

const main = $('#main');
const title = $('#title');
const back = $('#back');

let current = null;

// Hash routes: #gigs, #library, #settings, #gig-<id> (opens the gig's home tab), #gig-<id>-<tab>
function parseRoute() {
  const h = location.hash.replace(/^#/, '');
  const m = h.match(/^gig-([a-z0-9]+)(?:-(sheet|rig|lookup|prep|patch|power|print))?$/);
  if (m) return { view: gigView, params: { id: m[1], tab: m[2] || '' } };
  if (h === 'library') return { view: libraryView, params: {} };
  if (h === 'settings') return { view: settingsView, params: {} };
  return { view: gigsView, params: {} };
}

export function go(hash) {
  if (location.hash === '#' + hash) render();
  else location.hash = hash;
}

export function render({ keepScroll = false } = {}) {
  const y = window.scrollY;
  document.body.dataset.mode = getMode();
  const route = parseRoute();
  current?.out.unmount?.();
  const out = route.view.render(route.params);
  current = { ...route, out };
  title.textContent = out.title;
  back.hidden = !out.back;
  back.dataset.to = out.back || '';
  main.classList.toggle('wide', !!out.wide);
  main.classList.toggle('full', !!out.full);
  main.innerHTML = out.html;
  out.mount?.(main);
  for (const a of document.querySelectorAll('.nav a')) {
    a.classList.toggle('active', a.dataset.section === (out.section || 'gigs'));
  }
  window.scrollTo(0, keepScroll ? y : 0);
}

// Re-render after data changes, keeping the scroll position.
export const refresh = () => render({ keepScroll: true });

main.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el || !current?.out.actions) return;
  const fn = current.out.actions[el.dataset.action];
  if (fn) { e.preventDefault(); fn(el, e); }
});
main.addEventListener('change', (e) => {
  const el = e.target.closest('[data-change]');
  if (!el || !current?.out.actions) return;
  current.out.actions[el.dataset.change]?.(el, e);
});

back.addEventListener('click', () => go(back.dataset.to));
onModeChange(() => render({ keepScroll: true }));
// Changing screen (including the browser/phone Back gesture) closes any open dialog.
window.addEventListener('hashchange', () => { document.querySelectorAll('.sheet-wrap').forEach((w) => w.remove()); render(); });

if (!store.isPersistent()) {
  $('#banner').innerHTML = `<div class="banner">${esc('This browser is not letting the app save data. Use Settings → Backup to keep a copy of your work.')}</div>`;
}

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

render();

// Ask the host for the downloads capability early, so the first export is quick.
setTimeout(() => import('./ui.js').then((m) => m.getDownloads()), 0);

// Status bar clock.
const clock = $('#clock');
const tick = () => { if (clock) clock.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); };
tick();
setInterval(tick, 15000);
