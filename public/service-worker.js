const cacheName = 'freshpet-offline-v020012'; //increment version to update cache
// cache these files needed for offline use
const appShellFiles = [
  './offline.html',
  './offline.json'
];

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    // Activate the new service worker immediately
    self.skipWaiting();
  }
});

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(cacheName);
    await cache.addAll(appShellFiles);
  })());
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    (async () => {
      // Enable navigation preload if it's supported.
      // See https://developers.google.com/web/updates/2017/02/navigation-preload
      if ("navigationPreload" in self.registration) {
        await self.registration.navigationPreload.enable();
      }

      // garbage disposal
      caches.keys().then((keyList) => {
        Promise.all(keyList.map((key) => {
          if (key === cacheName) { return; }
          caches.delete(key);
        }))
        }).then(() => {
          return self.clients.claim();
        });
    })()
  );

  // Tell the active service worker to take control of the page immediately.
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  // no caching in development environment
  if(location.hostname === 'localhost' || location.hostname === '127.0.0.1')
    return;

  e.respondWith(
    (async () => {
      try {
        // First, try to use the navigation preload response if it's supported.
        if (e.request.mode === 'navigate') {
          const preloadResponse = await e.preloadResponse;
          if (preloadResponse) {
            // console.log('returning preload response');
            return preloadResponse;
          }

          return await fetch(e.request);
        }

        // do not cache post, put, etc
        if (e.request.method !== 'GET')
          return await fetch(e.request);

        // try cached response
        const cachedResponse = await caches.match(e.request);
        if (cachedResponse) {
          // console.log(`[Service Worker] Fetching cached resource: ${e.request.url}`);
          return cachedResponse;
        }

        // last choice to make network request.
        const networkResponse = await fetch(e.request);
        // do not cache bad responses
        if (!networkResponse || !networkResponse.ok || networkResponse.redirected) {
          return networkResponse;
        }

        const shouldCache = [
          'script',
          'style',
          'image',
          'font'
        ].includes(e.request.destination);
        if (shouldCache) {
          const cache = await caches.open(cacheName);
          cache.put(
            e.request,
            networkResponse.clone()
          );
        }

        return networkResponse;

      } catch (error) {
        // catch is only triggered if an exception is thrown, which is likely
        // due to a network error.
        // If fetch() returns a valid HTTP response with a response code in
        // the 4xx or 5xx range, the catch() will NOT be called.

        // console.log("Fetch failed; returning offline page instead.", error);
        let cachedResponse = null;
        if (e.request.headers.get('X-SPA') === '1')
          cachedResponse = await caches.match('offline.json');
        else
          cachedResponse = await caches.match('offline.html');
        return cachedResponse;
      }
    })()
  );

  // If our if() condition is false, then this fetch handler won't intercept the
  // request. If there are any other fetch handlers registered, they will get a
  // chance to call e.respondWith(). If no fetch handlers call
  // e.respondWith(), the request will be handled by the browser as if there
  // were no service worker involvement.
});


//handle background push notifications
self.addEventListener('push', function(event) {
  const notif = event.data.json(),
  options = {
    body: notif.notification.body,
    icon: notif.notification.icon,
    tag: notif.notification.channel_id || 'default',
    data: notif.notification.click_action,
    badge: notif.notification.icon
  };
  event.waitUntil(self.registration.showNotification(notif.notification.title, options));
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  event.waitUntil(clients.openWindow(event.notification.data));
});