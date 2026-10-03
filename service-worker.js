// Future Secure Providers CRM Service Worker
const CACHE_NAME = 'fsp-crm-v13';
const RUNTIME_CACHE = 'fsp-crm-runtime-v13';
const APP_SHELL = ['./', './index.html', './manifest.json?v=13', './logo.jpg'];

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(names => Promise.all(
        names.filter(name => name !== CACHE_NAME && name !== RUNTIME_CACHE)
             .map(name => caches.delete(name))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Documents: serve the installed app shell immediately, then refresh it in the background.
  // Live CRM records still come directly from Supabase, so cached UI never makes business data stale.
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      const cached = (await caches.match('./index.html')) || (await caches.match('./'));
      const network = fetch(request).then(async response => {
        if (response && response.ok) {
          const cache = await caches.open(RUNTIME_CACHE);
          await cache.put(request, response.clone());
        }
        return response;
      });
      if (cached) {
        event.waitUntil(network.catch(() => undefined));
        return cached;
      }
      try { return await network; }
      catch (_) { return new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } }); }
    })());
    return;
  }

  // Manifest: network first so install metadata never gets stuck on an old cached version.
  if (url.pathname.endsWith('/manifest.json')) {
    event.respondWith(fetch(request).then(response => {
      if (response && response.ok) caches.open(RUNTIME_CACHE).then(cache => cache.put(request, response.clone()));
      return response;
    }).catch(() => caches.match(request)));
    return;
  }

  // Same-origin static assets: cache first, then network and refresh runtime cache.
  if (/\.(?:js|css|png|jpg|jpeg|svg|gif|json|woff2?|ttf|eot|ico)$/i.test(url.pathname)) {
    event.respondWith(
      caches.match(request).then(cached => {
        if (cached) return cached;
        return fetch(request).then(response => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(RUNTIME_CACHE).then(cache => cache.put(request, copy));
          }
          return response;
        });
      })
    );
  }
});

self.addEventListener('push', event => {
  if (!event.data) return;
  let data = {};
  try { data = event.data.json(); } catch (_) { data = { body: event.data.text() }; }
  event.waitUntil(self.registration.showNotification(data.title || 'Future Secure Providers CRM', {
    body: data.body || 'New notification',
    icon: './logo.jpg',
    badge: './logo.jpg',
    tag: data.tag || 'fsp-crm-notification',
    requireInteraction: !!data.requireInteraction
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const client of list) {
        if ('focus' in client) return client.focus();
      }
      return clients.openWindow ? clients.openWindow('./') : undefined;
    })
  );
});
