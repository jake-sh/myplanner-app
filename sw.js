const CACHE = 'myplanner-v500';
const PRECACHE = ['./', './index.html', './app.js', './style.css', './manifest.json'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(PRECACHE).catch(() => {})));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim())
    .then(() => {
      // Notify clients a new version is active so they can auto-reload.
      return self.clients.matchAll({ type: 'window' }).then(clients => {
        clients.forEach(c => c.postMessage({ type: 'SW_ACTIVATED', version: CACHE }));
      });
    })
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Firebase/Google API requests must bypass the SW and go straight to network.
  // (Auth token refresh and Firestore streams break if the SW rewrites them:
  //  "URI Too Long", auth failures, dropped listeners.)
  const host = url.hostname;
  if (host.includes('googleapis.com') ||
      host.includes('firebaseio.com') ||
      host.includes('firebaseinstallations') ||
      host.includes('firebase') ||
      host.includes('google.com') ||
      host.includes('gstatic.com') ||
      host.includes('firestore') ||
      host.includes('identitytoolkit') ||
      host.includes('securetoken')) {
    return; // no respondWith -> browser default network handling
  }

  // POST share_target receiver.
  // The manifest share_target POSTs to ./share-receiver. GitHub Pages would
  // reject the large formData body, so we stash it in Cache and redirect the
  // client to a short URL it can pick up.
  if (e.request.method === 'POST' && url.pathname.endsWith('/share-receiver')) {
    e.respondWith((async () => {
      try {
        const formData = await e.request.formData();
        const payload = {
          title: formData.get('title') || '',
          text: formData.get('text') || '',
          url: formData.get('url') || '',
          ts: Date.now()
        };
        const cache = await caches.open('share-incoming');
        await cache.put('shared-payload', new Response(JSON.stringify(payload), {
          headers: { 'Content-Type': 'application/json' }
        }));
      } catch(err) {
        // ignore formData parse failures
      }
      // Redirect to a short URL (303: POST -> GET)
      return Response.redirect('./?share=1', 303);
    })());
    return;
  }

  // Legacy GET share_target: serve cached index.html, keep querystring on client.
  const isShareTarget = e.request.method === 'GET' &&
    (url.searchParams.has('title') || url.searchParams.has('text') || url.searchParams.has('url'));
  if (isShareTarget) {
    e.respondWith(
      caches.match('./index.html')
        .then(c => c || caches.match('./'))
        .then(c => c || fetch('./index.html'))
        .catch(() => fetch('./index.html'))
    );
    return;
  }

  // Navigation requests: network-first.
  if (e.request.mode === 'navigate') {
    e.respondWith(fetch(e.request).catch(() => caches.match('/myplanner-app/index.html')));
    return;
  }

  // Non-GET (POST/PUT/PATCH/DELETE incl. writes) are not cacheable -> pass through.
  if (e.request.method !== 'GET') {
    return;
  }

  // Core assets (html/css/js): network-first so changes deploy immediately,
  // fall back to cache when offline.
  const isCore = url.pathname.endsWith('.css') ||
                 url.pathname.endsWith('.js') ||
                 url.pathname.endsWith('.html') ||
                 url.pathname === '/' || url.pathname.endsWith('/');
  if (isCore && e.request.url.startsWith(self.location.origin)) {
    e.respondWith(
      fetch(e.request).then(resp => {
        if (resp && resp.status === 200) {
          const clone = resp.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return resp;
      }).catch(() => caches.match(e.request).then(cached => cached || new Response('offline')))
    );
    return;
  }

  // Everything else (fonts, images): cache-first.
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request).then(resp => {
      if (resp && resp.status === 200 && e.request.url.startsWith(self.location.origin)) {
        const clone = resp.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
      }
      return resp;
    })).catch(() => new Response('offline'))
  );
});

// Push handler: fallback for iOS etc. where registering the dedicated FCM SW
// (firebase-messaging-sw.js) fails and the push subscription binds to this
// main sw.js instead. The server sends data-only payloads, so there is no FCM
// auto-display and no duplicate notification. (A subscription binds to exactly
// one SW, so this never fires alongside onBackgroundMessage.)
self.addEventListener('push', e => {
  let d = {};
  try {
    const json = e.data ? e.data.json() : {};
    d = json.data || json || {};
  } catch(err) {
    try { d = { body: e.data ? e.data.text() : '' }; } catch(e2) {}
  }
  const title = d.title || 'Planner';
  const body = d.body || 'New message';
  e.waitUntil(
    self.registration.showNotification(title, {
      body: body,
      icon: '/myplanner-app/icons/icon-192.png',
      badge: '/myplanner-app/icons/icon-badge.png',
      tag: 'planner-notification',
      renotify: true
    })
  );
});

self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SHOW_NOTIFICATION') {
    // Close existing notification then show the new one (avoid duplicates).
    self.registration.getNotifications({ tag: 'planner-notification' }).then(ns => {
      ns.forEach(n => n.close());
      self.registration.showNotification(e.data.title || 'Planner', {
        body: e.data.body || '',
        icon: '/myplanner-app/icons/icon-192.png',
        badge: '/myplanner-app/icons/icon-badge.png',
        tag: 'planner-notification'
      });
    });
  }
  if (e.data && e.data.type === 'CLEAR_NOTIFICATIONS') {
    self.registration.getNotifications().then(notifications => {
      notifications.forEach(n => n.close());
    });
  }
  if (e.data && e.data.type === 'SET_BADGE') { if (navigator.setAppBadge) navigator.setAppBadge(e.data.count); }
  if (e.data && e.data.type === 'CLEAR_BADGE') { if (navigator.clearAppBadge) navigator.clearAppBadge(); }
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      // Focus an open tab if there is one.
      for (const client of list) {
        if ('focus' in client) return client.focus();
      }
      return self.clients.openWindow('/myplanner-app/');
    })
  );
});
