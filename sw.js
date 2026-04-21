const CACHE = 'myplanner-v32';

self.addEventListener('install', e => { self.skipWaiting(); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
});

// 앱에서 메시지 수신 → 알림 표시
self.addEventListener('message', e => {
  if (e.data?.type === 'SHOW_NOTIFICATION') {
    const { title, body } = e.data;
    self.registration.showNotification(title, {
      body,
      icon: '/myplanner-app/icons/icon-192.png',
      badge: '/myplanner-app/icons/icon-192.png',
      tag: 'schedule-notification',
      renotify: true,
      vibrate: [200, 100, 200]
    });
  }
  if (e.data?.type === 'SET_BADGE') {
    if (navigator.setAppBadge) navigator.setAppBadge(e.data.count);
  }
  if (e.data?.type === 'CLEAR_BADGE') {
    if (navigator.clearAppBadge) navigator.clearAppBadge();
  }
});

// 알림 클릭 시 앱 열기
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(clients.matchAll({ type: 'window' }).then(list => {
    if (list.length) return list[0].focus();
    return clients.openWindow('/myplanner-app/');
  }));
});
