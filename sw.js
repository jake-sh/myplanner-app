const CACHE = 'myplanner-v384';
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
      // 새 버전 활성 알림 → 클라이언트가 자동 새로고침
      return self.clients.matchAll({ type: 'window' }).then(clients => {
        clients.forEach(c => c.postMessage({ type: 'SW_ACTIVATED', version: CACHE }));
      });
    })
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Firebase/Google API 요청은 SW가 절대 가로채지 않고 네트워크로 직행한다.
  // (인증 토큰 갱신, Firestore 쓰기 등이 SW를 거치며 변형/실패하면
  //  미사용 후 "URI Too Long", 인증 실패, 동기화 누락이 발생함)
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
    return; // respondWith 호출 안 함 → 브라우저 기본 네트워크 처리
  }

  // ── POST share_target 수신 ──────────────────────────────────
  // manifest의 share_target이 POST ./share-receiver 로 들어옴.
  // 긴 텍스트도 URL이 아닌 body(formData)에 실리므로 "URI Too Long"이 없다.
  // formData를 꺼내 Cache에 임시 저장 후, 짧은 URL로 redirect → 클라이언트가 읽어감.
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
        // formData 파싱 실패해도 앱은 띄움
      }
      // 짧은 URL로 redirect (303: POST → GET 전환)
      return Response.redirect('./?share=1', 303);
    })());
    return;
  }

  // share_target으로 들어온 요청은 캐시 우회 + 쿼리스트링 유지
  // (구버전 GET 방식 호환 유지 — manifest 갱신 전 기기 대응)
  const isShareTarget = e.request.method === 'GET' &&
    (url.searchParams.has('title') || url.searchParams.has('text') || url.searchParams.has('url'));
  if (isShareTarget) {
    // 캐시된 index.html을 응답하고, 쿼리스트링은 클라이언트의 location.search로 살아있음.
    // 캐시 miss(장시간 미사용으로 캐시 정리됨) 시에도 절대 원본 긴 URL을 서버로 보내지 않는다
    // — GitHub Pages가 긴 쿼리스트링을 414 "URI Too Long"으로 거부하기 때문.
    // 쿼리를 뗀 ./index.html만 네트워크로 요청한다 (주소창 쿼리스트링은 유지됨).
    e.respondWith(
      caches.match('./index.html')
        .then(c => c || caches.match('./'))
        .then(c => c || fetch('./index.html'))
        .catch(() => fetch('./index.html'))
    );
    return;
  }
  // navigation 요청은 네트워크 우선
  if (e.request.mode === 'navigate') {
    e.respondWith(fetch(e.request).catch(() => caches.match('/myplanner-app/index.html')));
    return;
  }
  // GET이 아닌 요청(POST/PUT/PATCH/DELETE 등 쓰기)은 캐시 대상이 아니므로 손대지 않음
  if (e.request.method !== 'GET') {
    return;
  }
  // 나머지(동일 출처 GET)는 cache-first
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

// push 이벤트 핸들러 없음 (sw.js는 FCM 알림 표시 담당 아님).
// FCM 백그라운드 알림은 firebase-messaging-sw.js의 onBackgroundMessage가 전담.
// 서버는 data-only 페이로드로 전송 → FCM 자동표시 없음 → onBackgroundMessage 한 곳에서만 표시.
// (이전에 sw.js push 핸들러 + onBackgroundMessage 양쪽에서 표시해 2개 오던 문제 수정됨)

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
