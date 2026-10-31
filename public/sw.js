/*
 * Offline support for the installed web app (not used inside the native Android/iPhone app,
 * which ships every file in the package).
 *  - The game itself (index.html, one file) is network-first: online you always get the latest
 *    version, offline the last one you played.
 *  - Player photos, icons and the manifest are cache-first: they rarely change and there are hundreds.
 * Bump VERSION to drop old caches after a change to this file.
 */
const VERSION = 'v1';
const SHELL = `clutch-shell-${VERSION}`;
const ASSETS = `clutch-assets-${VERSION}`;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(['./', './manifest.webmanifest', './icons/icon-192.png'])).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL && k !== ASSETS).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // Supabase and other services are never cached.
  if (req.mode === 'navigate' || url.pathname.endsWith('/index.html')) {
    e.respondWith(
      fetch(req)
        .then((res) => { if (res.ok) { const copy = res.clone(); caches.open(SHELL).then((c) => c.put('./', copy)); } return res; })
        .catch(() => caches.match('./').then((r) => r || caches.match(req))),
    );
    return;
  }
  e.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(ASSETS).then((c) => c.put(req, copy)); }
      return res;
    })),
  );
});
