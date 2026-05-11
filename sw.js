const CACHE = 'myplanner-v215';

self.addEventListener('install', e => { self.skipWaiting(); });

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k))))
    .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  e.respondWith(fetch(e.request).catch(() => new Response('offline')));
});

self.addEventListener('push', e => {
  const data = e.data?.json() || {};
  e.waitUntil(
    // 앱이 포그라운드면 알림 안 띄움
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      const isVisible = clients.some(c => c.visibilityState === 'visible');
      if (isVisible) return; // 앱 보고 있으면 푸시 무시
      return self.registration.showNotification(data.title || '새 메시지', {
        body: data.body || '새 알림이 있어요',
        icon: '/myplanner-app/icons/icon-192.png',
        tag: 'planner-notification',
        renotify: true,
      });
    })
  );
});

self.addEventListener('message', e => {
  if (e.data?.type === 'SHOW_NOTIFICATION') {
    // 기존 알림 닫고 새 알림 표시 (중복 방지)
    self.registration.getNotifications({ tag: 'planner-notification' }).then(ns => {
      ns.forEach(n => n.close());
      self.registration.showNotification(e.data.title || '알림', {
        body: e.data.body || '',
        icon: '/myplanner-app/icons/icon-192.png',
        tag: 'planner-notification'
      });
    });
  }
  if (e.data?.type === 'CLEAR_NOTIFICATIONS') {
    self.registration.getNotifications().then(notifications => {
      notifications.forEach(n => n.close());
    });
  }
  if (e.data?.type === 'SET_BADGE') { if (navigator.setAppBadge) navigator.setAppBadge(e.data.count); }
  if (e.data?.type === 'CLEAR_BADGE') { if (navigator.clearAppBadge) navigator.clearAppBadge(); }
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      // 열린 창 있으면 포커스
      for (const client of list) {
        if ('focus' in client) return client.focus();
      }
      return self.clients.openWindow('/myplanner-app/');
    })
  );
});
