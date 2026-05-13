const CACHE = 'myplanner-v237';

self.addEventListener('install', e => { self.skipWaiting(); });

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k))))
    .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  // ── Share Target POST 처리 ──
  if (e.request.url.includes('/share-target') && e.request.method === 'POST') {
    e.respondWith((async () => {
      try {
        const fd = await e.request.formData();
        const title   = fd.get('title') || '';
        const text    = fd.get('text')  || '';
        const url     = fd.get('url')   || '';
        const combined = [title, text, url].filter(Boolean).join('\n').trim();

        // 열린 클라이언트에 메시지 전달 (앱이 열려있으면 바로 처리)
        const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        if (clients.length > 0) {
          clients[0].postMessage({ type: 'SHARE_TARGET', text: combined });
        }
        // 앱이 안 열려있으면 캐시에만 저장 (앱 열지 않음)
        // IndexedDB 대신 캐시 API로 임시 저장
        const cache = await caches.open('share-pending');
        await cache.put('pending', new Response(combined));

        // 알림 표시
        await self.registration.showNotification('메모 저장됨', {
          body: combined.length > 60 ? combined.substring(0, 60) + '…' : combined,
          icon: '/myplanner-app/icons/icon-192.png',
          tag: 'share-saved',
          silent: false
        });

        // 기존 앱으로 복귀 (앱 창 열지 않음)
        return Response.redirect('/myplanner-app/', 303);
      } catch(err) {
        return Response.redirect('/myplanner-app/', 303);
      }
    })());
    return;
  }

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
