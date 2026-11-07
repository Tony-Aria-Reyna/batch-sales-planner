// Keeps the Rata & Smudge app itself working with no signal. Business data is cached by Firestore separately.
const VERSION = '__VERSION__';
const SHELL = ['./', 'index.html', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(VERSION).then(c => Promise.all(SHELL.map(u => c.add(u).catch(() => null)))).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== VERSION).map(x => caches.delete(x)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const req = e.request; if (req.method !== 'GET') return;
  const url = new URL(req.url); if (url.origin !== location.origin) return;
  if (url.pathname.startsWith('/__/')) return;                                   // Firebase sign-in pages: never cache
  if (/version\.json$/.test(url.pathname)) return;                               // update check must hit the network
  if (/manifest\.webmanifest$/.test(url.pathname)) { e.respondWith(fetch(req, { cache: 'no-cache' }).catch(() => caches.match(req))); return; } // lesson: never serve a stale manifest
  if (req.mode === 'navigate' || /\/(index\.html)?$/.test(url.pathname)) {
    e.respondWith(fetch(req, { cache: 'no-cache' }).then(r => { if (r.ok) { const cp = r.clone(); caches.open(VERSION).then(c => c.put('index.html', cp)); return r; } return caches.match('index.html').then(c => c || r); })
      .catch(() => caches.match('index.html').then(r => r || caches.match('./'))));
    return;
  }
  e.respondWith(caches.match(req).then(r => r || fetch(req).then(n => { if (n.ok) { const cp = n.clone(); caches.open(VERSION).then(c => c.put(req, cp)); } return n; })));
});
