// Guarda la app para que abra al instante y sin conexión.
// Sube VERSION cada vez que publiques cambios.
const VERSION = 'v33';
const CACHE = 'mis-tareas-' + VERSION;
const SHELL = ['./', 'index.html', 'app.js', 'logic.js', 'parse.js', 'cal.js', 'io.js', 'config.js', 'manifest.webmanifest', 'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png'];

// Al instalar una versión nueva se guardan TODOS sus archivos juntos (pidiéndolos frescos),
// así nunca se mezcla una página nueva con código viejo.
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'no-cache' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('mis-tareas-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const ours = url.origin === location.origin;
  const lib = url.host === 'www.gstatic.com' || url.host === 'fonts.googleapis.com' || url.host === 'fonts.gstatic.com';
  if (!ours && !lib) return; // Firebase (datos y acceso) va directo a la red
  // Primero lo guardado (abre al instante); si no está, la red. Las versiones nuevas llegan instalando este archivo de nuevo.
  e.respondWith(
    caches.open(CACHE).then(async c => {
      const hit = await c.match(req, { ignoreSearch: true }) || (req.mode === 'navigate' ? await c.match('index.html') : null);
      if (hit) return hit;
      try {
        const res = await (ours && req.mode !== 'navigate' ? fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' }) : fetch(req));
        if (res.ok && (ours || lib)) c.put(req, res.clone());
        return res;
      } catch (err) {
        const any = await caches.match(req, { ignoreSearch: true });
        if (any) return any;
        throw err;
      }
    })
  );
});

// ---------- Avisos ----------
self.addEventListener('push', e => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Mis Tareas', {
    body: d.body || '', tag: d.tag || undefined, data: { url: d.url || './' },
    icon: 'icons/icon-192.png', badge: 'icons/icon-192.png',
  }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const target = new URL(e.notification.data?.url || './', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    const w = list.find(c => c.url.startsWith(self.registration.scope));
    if (w) { w.focus(); return w.navigate ? w.navigate(target).catch(() => {}) : null; }
    return self.clients.openWindow(target);
  }));
});
