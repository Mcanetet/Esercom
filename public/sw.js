/* ESERCOM — Service Worker: assets en caché + notificaciones */
const CACHE = 'esercom-pwa-v5';
const PRECACHE = [
  '/css/app.css',
  '/css/login.css',
  '/js/auth.js',
  '/js/ui.js',
  '/js/notif-alert.js',
  '/manifest.webmanifest'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification?.data && event.notification.data.url) || '/home.html';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ('focus' in client) {
          client.focus();
          if (client.url && !String(client.url).includes(target) && 'navigate' in client) {
            try { client.navigate(target); } catch (_) { /* ignore */ }
          }
          return;
        }
      }
      if (clients.openWindow) return clients.openWindow(target);
    })
  );
});

self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type !== 'SHOW_NOTIFICATION') return;
  const title = data.title || 'ESERCOM';
  const opts = Object.assign({
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    renotify: true
  }, data.options || {});
  event.waitUntil(self.registration.showNotification(title, opts));
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // API / PHP: red directa
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/php/')) return;
  // Navegación HTML: NO interceptar (evita menú marcado sin cambiar de página)
  if (request.mode === 'navigate' || url.pathname.endsWith('.html') || url.pathname === '/') {
    return;
  }

  const isAsset = /\.(css|js|woff2?|png|jpg|jpeg|gif|svg|webp|ico|webmanifest)$/i.test(url.pathname);
  if (!isAsset) return;

  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((res) => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
