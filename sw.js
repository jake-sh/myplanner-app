const CACHE = 'myplanner-v498';
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
      // ??버전 ?�성 ?�림 ???�라?�언?��? ?�동 ?�로고침
      return self.clients.matchAll({ type: 'window' }).then(clients => {
        clients.forEach(c => c.postMessage({ type: 'SW_ACTIVATED', version: CACHE }));
      });
    })
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Firebase/Google API ?�청?� SW가 ?��? 가로채지 ?�고 ?�트?�크�?직행?�다.
  // (?�증 ?�큰 갱신, Firestore ?�기 ?�이 SW�?거치�?변???�패?�면
  //  미사????"URI Too Long", ?�증 ?�패, ?�기???�락??발생??
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
    return; // respondWith ?�출 ??????브라?��? 기본 ?�트?�크 처리
  }

  // ?�?� POST share_target ?�신 ?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�
  // manifest??share_target??POST ./share-receiver �??�어??
  // �??�스?�도 URL???�닌 body(formData)???�리므�?"URI Too Long"???�다.
  // formData�?꺼내 Cache???�시 ?�???? 짧�? URL�?redirect ???�라?�언?��? ?�어�?
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
        // formData ?�싱 ?�패?�도 ?��? ?��?
      }
      // 짧�? URL�?redirect (303: POST ??GET ?�환)
      return Response.redirect('./?share=1', 303);
    })());
    return;
  }

  // share_target?�로 ?�어???�청?� 캐시 ?�회 + 쿼리?�트�??��?
  // (구버??GET 방식 ?�환 ?��? ??manifest 갱신 ??기기 ?�??
  const isShareTarget = e.request.method === 'GET' &&
    (url.searchParams.has('title') || url.searchParams.has('text') || url.searchParams.has('url'));
  if (isShareTarget) {
    // 캐시??index.html???�답?�고, 쿼리?�트링�? ?�라?�언?�의 location.search�??�아?�음.
    // 캐시 miss(?�시�?미사?�으�?캐시 ?�리?? ?�에???��? ?�본 �?URL???�버�?보내지 ?�는??    // ??GitHub Pages가 �?쿼리?�트링을 414 "URI Too Long"?�로 거�??�기 ?�문.
    // 쿼리�??� ./index.html�??�트?�크�??�청?�다 (주소�?쿼리?�트링�? ?��???.
    e.respondWith(
      caches.match('./index.html')
        .then(c => c || caches.match('./'))
        .then(c => c || fetch('./index.html'))
        .catch(() => fetch('./index.html'))
    );
    return;
  }
  // navigation ?�청?� ?�트?�크 ?�선
  if (e.request.mode === 'navigate') {
    e.respondWith(fetch(e.request).catch(() => caches.match('/myplanner-app/index.html')));
    return;
  }
  // GET???�닌 ?�청(POST/PUT/PATCH/DELETE ???�기)?� 캐시 ?�?�이 ?�니므�??��?지 ?�음
  if (e.request.method !== 'GET') {
    return;
  }
  // ?�심 ?�산(html/css/js)?� network-first ????�� 최신 반영, ?�프?�인??캐시 ?�백
  // (cache-first�??�번 캐시????style.css/app.js가 계속 ?�빙?�어 변경이 ??보임)
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

  // ?�머지(?�트·?��?지 ????cache-first
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

// push 핸들러: iOS 등에서 FCM 전용 SW(firebase-messaging-sw.js) 등록이 실패해
// 푸시 구독이 이 메인 sw.js에 묶이는 경우를 대비한 폴백.
// 서버는 data-only 페이로드를 보내므로 FCM 자동표시가 없어 중복 알림이 생기지 않는다.
// (구독은 getToken에 넘긴 SW 하나에만 묶이므로 onBackgroundMessage와 동시 발화하지 않음)
self.addEventListener('push', e => {
  let d = {};
  try {
    const json = e.data ? e.data.json() : {};
    d = json.data || json || {};
  } catch(err) {
    try { d = { body: e.data ? e.data.text() : '' }; } catch(e2) {}
  }
  const title = d.title || '일정 알림';
  const body = d.body || '새 메시지가 있어요';
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
  if (e.data?.type === 'SHOW_NOTIFICATION') {
    // 기존 ?�림 ?�고 ???�림 ?�시 (중복 방�?)
    self.registration.getNotifications({ tag: 'planner-notification' }).then(ns => {
      ns.forEach(n => n.close());
      self.registration.showNotification(e.data.title || '?�림', {
        body: e.data.body || '',
        icon: '/myplanner-app/icons/icon-192.png',
        badge: '/myplanner-app/icons/icon-badge.png',
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
      // ?�린 �??�으�??�커??      for (const client of list) {
        if ('focus' in client) return client.focus();
      }
      return self.clients.openWindow('/myplanner-app/');
    })
  );
});

