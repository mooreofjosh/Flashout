// Offline support: cache the app shell, serve it when there's no signal.
const CACHE = 'flashout-v8';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png',
  'js/app.js', 'js/mode.js', 'js/sync.js', 'js/store.js', 'js/ui.js', 'js/patch.js', 'js/zip.js', 'js/fixtures.js', 'js/mvr.js', 'js/builtin.js', 'js/pdf.js', 'vendor/jspdf.umd.min.js', 'vendor/jspdf.plugin.autotable.min.js', 'data/ma2-library.json', 'js/views/mvrImport.js',
  'js/power.js', 'js/views/power.js', 'js/views/common.js', 'js/views/worksheet.js', 'js/views/gigs.js', 'js/views/gig.js', 'js/views/library.js', 'js/views/settings.js',
];
self.addEventListener('install', (e) => e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', (e) => e.waitUntil(
  caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // Network first so updates arrive, cache fallback for offline.
  e.respondWith(fetch(e.request).then((res) => {
    const copy = res.clone();
    caches.open(CACHE).then((c) => c.put(e.request, copy));
    return res;
  }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
