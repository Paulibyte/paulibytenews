// PaulibyteNews service worker — offline shell + network-first pages
const CACHE = 'pbn-v1';
const SHELL = ['/css/site.css?v=1', '/js/site.js?v=1', '/img/favicon.svg', '/img/icon-192.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL))); self.skipWaiting(); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))); self.clients.claim(); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin || u.pathname.startsWith('/admin') || u.pathname.startsWith('/ad/') || u.pathname.startsWith('/go/')) return;
  if (e.request.mode === 'navigate') {
    e.respondWith(fetch(e.request).then(r => { const c = r.clone(); caches.open(CACHE).then(ca => ca.put(e.request, c)); return r; })
      .catch(() => caches.match(e.request).then(r => r || new Response('<h1 style="font-family:sans-serif">You are offline</h1><p style="font-family:sans-serif">Reconnect to read the latest from PaulibyteNews.</p>', { headers: { 'Content-Type': 'text/html' } }))));
    return;
  }
  if (/\.(css|js|png|jpg|jpeg|webp|svg|woff2?)$/.test(u.pathname)) {
    e.respondWith(caches.match(e.request).then(r => r || fetch(e.request).then(res => { const c = res.clone(); caches.open(CACHE).then(ca => ca.put(e.request, c)); return res; })));
  }
});
