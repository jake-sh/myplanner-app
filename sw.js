const CACHE = 'myplanner-v65';

self.addEventListener('install', e => {
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k))))
    .then(() => self.clients.claim())
    .then(() => self.clients.matchAll().then(clients => {
      clients.forEach(client => client.postMessage({ type: 'RELOAD' }));
    }))
  );
});

self.addEventListener('fetch', e => {
  // 캐시 없이 항상 네트워크에서 가져오기
  e.respondWith(fetch(e.request).catch(() => new Response('offline')));
});

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

self.addEventListener('message', e => {
  if (e.data?.type === 'SHOW_NOTIFICATION') {
    self.registration.showNotification(e.data.title || '알림', {
      body: e.data.body || '',
      icon: '/myplanner-app/icons/icon-192.png',
      tag: 'planner-notification'
    });
  }
  if (e.data?.type === 'CLEAR_NOTIFICATIONS') {
    self.registration.getNotifications().then(function(notifications) {
      notifications.forEach(function(n) { n.close(); });
    });
  }
  if (e.data?.type === 'SET_BADGE') { if (navigator.setAppBadge) navigator.setAppBadge(e.data.count); }
  if (e.data?.type === 'CLEAR_BADGE') { if (navigator.clearAppBadge) navigator.clearAppBadge(); }
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(clients.matchAll({ type: 'window' }).then(list => {
    if (list.length) return list[0].focus();
    return clients.openWindow('/myplanner-app/');
  }));
});
