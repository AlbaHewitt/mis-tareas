// Guarda la app para que abra al instante y sin conexión.
// Sube VERSION cada vez que publiques cambios.
const VERSION = 'v8';
const CACHE = 'mis-tareas-' + VERSION;
const SHELL = ['./', 'index.html', 'app.js', 'parse.js', 'cal.js', 'config.js', 'manifest.webmanifest', 'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const ours = url.origin === location.origin;
  const lib = url.host === 'www.gstatic.com' || url.host === 'fonts.googleapis.com' || url.host === 'fonts.gstatic.com';
  if (!ours && !lib) return; // Firebase (datos y acceso) va directo a la red
  // Primero la red (para recibir actualizaciones); si no hay conexión, la copia guardada.
  e.respondWith(
    fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || caches.match('index.html')))
  );
});
