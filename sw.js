const CACHE = 'myplanner-v239';
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

// ── Share Target (POST) 처리 ─────────────────────────
function openShareDB() {
  return new Promise((res, rej) => {
    const req = indexedDB.open('share_db', 1);
    req.onupgradeneeded = e => e.target.result.createObjectStore('shares', { keyPath: 'id', autoIncrement: true });
    req.onsuccess = e => res(e.target.result);
    req.onerror = rej;
  });
}
function saveShareDB(data) {
  return openShareDB().then(db => new Promise((res, rej) => {
    const tx = db.transaction('shares', 'readwrite');
    tx.objectStore('shares').add({ ...data, ts: Date.now() });
    tx.oncomplete = res;
    tx.onerror = rej;
  }));
}

self.addEventListener('fetch', e => {
  // POST 공유 요청 가로채기 → IndexedDB 저장 후 앱으로 리다이렉트
  if (e.request.method === 'POST') {
    e.respondWith((async () => {
      try {
        const fd = await e.request.formData();
        const title = fd.get('title') || '';
        const text  = fd.get('text')  || '';
        const url   = fd.get('url')   || '';
        const body  = [text, url].filter(Boolean).join('\n');
        await saveShareDB({ title, body });
        // 열린 클라이언트에 메시지
        const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        clients.forEach(c => c.postMessage({ type: 'SHARED_SAVED' }));
      } catch(err) {}
      // 캐시된 index.html 반환 (서버 POST 안 보냄)
      return caches.match('./index.html')
        .then(r => r || caches.match('/myplanner-app/index.html'))
        .then(r => r || new Response('', { status: 200 }));
    })());
    return;
  }
  // 일반 navigation 요청은 네트워크 우선
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
