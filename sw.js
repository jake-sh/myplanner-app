const CACHE = 'myplanner-v40';

self.addEventListener('install', e => { self.skipWaiting(); });
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k))))
    .then(() => self.clients.claim())
  );
});
self.addEventListener('fetch', e => {
  e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
});

// FCM 푸시 (Android)
self.addEventListener('push', e => {
  const data = e.data?.json() || {};
  e.waitUntil(
    self.registration.showNotification(data.title || '새 메시지', {
      body: data.body || '새 알림이 있어요',
      icon: '/myplanner-app/icons/icon-192.png',
      tag: 'planner-notification'
    })
  );
});

// postMessage 알림 (iOS 및 백그라운드 공통)
self.addEventListener('message', e => {
  if (e.data?.type === 'SHOW_NOTIFICATION') {
    self.registration.showNotification(e.data.title || '알림', {
      body: e.data.body || '',
      icon: '/myplanner-app/icons/icon-192.png',
      tag: 'planner-notification'
    });
  }
  if (e.data?.type === 'SET_BADGE') {
    if (navigator.setAppBadge) navigator.setAppBadge(e.data.count);
  }
  if (e.data?.type === 'CLEAR_BADGE') {
    if (navigator.clearAppBadge) navigator.clearAppBadge();
  }
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(clients.matchAll({ type: 'window' }).then(list => {
    if (list.length) return list[0].focus();
    return clients.openWindow('/myplanner-app/');
  }));
});
