// Offline shell for the installed app. Versioned files (?v=…) and assets never change, so
// they come from the cache; the page itself comes from the network, or the cache when
// offline. Anything from other sites (the relay, models, fonts) is left to the browser.
const CACHE = 'vf-shell-v5-dashboard';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())
));
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  // video seeks ask for byte ranges, which a cache cannot answer
  if (req.method !== 'GET' || url.origin !== location.origin || req.headers.has('range')) return;
  if (url.search.includes('v=') || url.pathname.startsWith('/assets/')) {
    e.respondWith(caches.open(CACHE).then(async c => (await c.match(req)) || fetch(req).then(r => {
      if (r.ok && r.status === 200) c.put(req, r.clone());
      return r;
    })));
  } else {
    e.respondWith(fetch(req).then(r => {
      if (r.ok && r.status === 200) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return r;
    }).catch(() => caches.match(req)));
  }
});
