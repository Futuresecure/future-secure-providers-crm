// Future Secure Providers CRM Service Worker
const CACHE_NAME = 'fsp-crm-v58';
const RUNTIME_CACHE = 'fsp-crm-runtime-v58';
const APP_SHELL = ['./', './index.html?v=55', './manifest.json?v=55', '../pwa-icon.svg'];

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
        names.filter(name => name.startsWith('fsp-crm-') && name !== CACHE_NAME && name !== RUNTIME_CACHE)
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

  // Documents: always use network first so CRM UI updates immediately; cache only as offline fallback.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request, { cache: 'no-store' }).then(async response => {
        if (response && response.ok) {
          const cache = await caches.open(RUNTIME_CACHE);
          await cache.put('./index.html?v=55', response.clone());
        }
        return response;
      }).catch(async () => (await caches.match('./index.html?v=55')) || new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } }))
    );
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


self.addEventListener('push',event=>{
 if(!event.data)return;let data={};try{data=event.data.json()}catch{data={body:event.data.text()}}
 event.waitUntil(self.registration.showNotification(data.title||'Future Secure Providers CRM',{body:data.body||'New notification',icon:'../pwa-icon.svg',badge:'../pwa-icon.svg',tag:data.tag||'fsp-crm-notification',requireInteraction:!!data.requireInteraction,data:{url:data.url||'./'}}));
});
self.addEventListener('notificationclick',event=>{
 event.notification.close();const base=self.registration.scope;let target=new URL('./',base);
 try{const requested=new URL(event.notification.data?.url||'./',base);if(requested.origin===self.location.origin&&requested.pathname.startsWith(new URL(base).pathname))target=requested}catch{}
 event.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(async list=>{
 for(const client of list){if(client.url&&new URL(client.url).pathname.startsWith(new URL(base).pathname)&&'focus' in client){if('navigate' in client)await client.navigate(target.href);return client.focus()}}
 return clients.openWindow?clients.openWindow(target.href):undefined;
 }));
});
