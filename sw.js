const CACHE = 'myplanner-v238';
const PRECACHE = ['./', './index.html', './app.js', './style.css', './manifest.json'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(PRECACHE).catch(() => {})));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // share_target으로 들어온 요청은 캐시 우회 + 쿼리스트링 유지
  // (manifest의 share_target action이 './' 이므로 origin/scope 루트로 들어옴)
  const isShareTarget = e.request.method === 'GET' &&
    (url.searchParams.has('title') || url.searchParams.has('text') || url.searchParams.has('url'));
  if (isShareTarget) {
    // 캐시된 index.html을 그대로 응답하고, 쿼리스트링은 클라이언트의 location.search로 살아있음
    e.respondWith(
      caches.match('./index.html').then(c => c || caches.match('./')).then(c => c || fetch(e.request))
    );
    return;
  }
  // navigation 요청은 네트워크 우선
  if (e.request.mode === 'navigate') {
    e.respondWith(fetch(e.request).catch(() => caches.match('/myplanner-app/index.html')));
    return;
  }
  // 나머지는 cache-first
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
