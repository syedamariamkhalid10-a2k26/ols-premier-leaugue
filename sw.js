/* Service worker: caches the application shell so pages open quickly on slow connections.
   Network first, cache as fallback. Live auction data (/api, /socket.io, /media) is never cached. */
const CACHE = 'olspl-shell-v1';
const SHELL = ['/css/app.css', '/css/projector.css', '/js/core.js', '/img/ols-logo.png',
  '/fonts/barlow-condensed-latin-600-normal.woff2', '/fonts/barlow-condensed-latin-700-normal.woff2', '/fonts/barlow-condensed-latin-800-normal.woff2'];

self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (/^\/(api|socket\.io|media)\//.test(url.pathname)) return;
  e.respondWith(fetch(e.request).then((res) => {
    if (res.ok && (/\.(css|js|woff2|png|svg)$/.test(url.pathname))) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
    return res;
  }).catch(() => caches.match(e.request)));
});
