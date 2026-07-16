const CACHE = 'myplanner-v469';
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
      // ??踰꾩쟾 ?쒖꽦 ?뚮┝ ???대씪?댁뼵?멸? ?먮룞 ?덈줈怨좎묠
      return self.clients.matchAll({ type: 'window' }).then(clients => {
        clients.forEach(c => c.postMessage({ type: 'SW_ACTIVATED', version: CACHE }));
      });
    })
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Firebase/Google API ?붿껌? SW媛 ?덈? 媛濡쒖콈吏 ?딄퀬 ?ㅽ듃?뚰겕濡?吏곹뻾?쒕떎.
  // (?몄쬆 ?좏겙 媛깆떊, Firestore ?곌린 ?깆씠 SW瑜?嫄곗튂硫?蹂???ㅽ뙣?섎㈃
  //  誘몄궗????"URI Too Long", ?몄쬆 ?ㅽ뙣, ?숆린???꾨씫??諛쒖깮??
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
    return; // respondWith ?몄텧 ??????釉뚮씪?곗? 湲곕낯 ?ㅽ듃?뚰겕 泥섎━
  }

  // ?? POST share_target ?섏떊 ??????????????????????????????????
  // manifest??share_target??POST ./share-receiver 濡??ㅼ뼱??
  // 湲??띿뒪?몃룄 URL???꾨땶 body(formData)???ㅻ━誘濡?"URI Too Long"???녿떎.
  // formData瑜?爰쇰궡 Cache???꾩떆 ????? 吏㏃? URL濡?redirect ???대씪?댁뼵?멸? ?쎌뼱媛?
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
        // formData ?뚯떛 ?ㅽ뙣?대룄 ?깆? ?꾩?
      }
      // 吏㏃? URL濡?redirect (303: POST ??GET ?꾪솚)
      return Response.redirect('./?share=1', 303);
    })());
    return;
  }

  // share_target?쇰줈 ?ㅼ뼱???붿껌? 罹먯떆 ?고쉶 + 荑쇰━?ㅽ듃留??좎?
  // (援щ쾭??GET 諛⑹떇 ?명솚 ?좎? ??manifest 媛깆떊 ??湲곌린 ???
  const isShareTarget = e.request.method === 'GET' &&
    (url.searchParams.has('title') || url.searchParams.has('text') || url.searchParams.has('url'));
  if (isShareTarget) {
    // 罹먯떆??index.html???묐떟?섍퀬, 荑쇰━?ㅽ듃留곸? ?대씪?댁뼵?몄쓽 location.search濡??댁븘?덉쓬.
    // 罹먯떆 miss(?μ떆媛?誘몄궗?⑹쑝濡?罹먯떆 ?뺣━?? ?쒖뿉???덈? ?먮낯 湲?URL???쒕쾭濡?蹂대궡吏 ?딅뒗??    // ??GitHub Pages媛 湲?荑쇰━?ㅽ듃留곸쓣 414 "URI Too Long"?쇰줈 嫄곕??섍린 ?뚮Ц.
    // 荑쇰━瑜?? ./index.html留??ㅽ듃?뚰겕濡??붿껌?쒕떎 (二쇱냼李?荑쇰━?ㅽ듃留곸? ?좎???.
    e.respondWith(
      caches.match('./index.html')
        .then(c => c || caches.match('./'))
        .then(c => c || fetch('./index.html'))
        .catch(() => fetch('./index.html'))
    );
    return;
  }
  // navigation ?붿껌? ?ㅽ듃?뚰겕 ?곗꽑
  if (e.request.mode === 'navigate') {
    e.respondWith(fetch(e.request).catch(() => caches.match('/myplanner-app/index.html')));
    return;
  }
  // GET???꾨땶 ?붿껌(POST/PUT/PATCH/DELETE ???곌린)? 罹먯떆 ??곸씠 ?꾨땲誘濡??먮?吏 ?딆쓬
  if (e.request.method !== 'GET') {
    return;
  }
  // ?듭떖 ?먯궛(html/css/js)? network-first ????긽 理쒖떊 諛섏쁺, ?ㅽ봽?쇱씤??罹먯떆 ?대갚
  // (cache-first硫??쒕쾲 罹먯떆????style.css/app.js媛 怨꾩냽 ?쒕튃?섏뼱 蹂寃쎌씠 ??蹂댁엫)
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

  // ?섎㉧吏(?고듃쨌?대?吏 ????cache-first
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

// push ?대깽???몃뱾???놁쓬 (sw.js??FCM ?뚮┝ ?쒖떆 ?대떦 ?꾨떂).
// FCM 諛깃렇?쇱슫???뚮┝? firebase-messaging-sw.js??onBackgroundMessage媛 ?꾨떞.
// ?쒕쾭??data-only ?섏씠濡쒕뱶濡??꾩넚 ??FCM ?먮룞?쒖떆 ?놁쓬 ??onBackgroundMessage ??怨녹뿉?쒕쭔 ?쒖떆.
// (?댁쟾??sw.js push ?몃뱾??+ onBackgroundMessage ?묒そ?먯꽌 ?쒖떆??2媛??ㅻ뜕 臾몄젣 ?섏젙??

self.addEventListener('message', e => {
  if (e.data?.type === 'SHOW_NOTIFICATION') {
    // 湲곗〈 ?뚮┝ ?リ퀬 ???뚮┝ ?쒖떆 (以묐났 諛⑹?)
    self.registration.getNotifications({ tag: 'planner-notification' }).then(ns => {
      ns.forEach(n => n.close());
      self.registration.showNotification(e.data.title || '?뚮┝', {
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
      // ?대┛ 李??덉쑝硫??ъ빱??      for (const client of list) {
        if ('focus' in client) return client.focus();
      }
      return self.clients.openWindow('/myplanner-app/');
    })
  );
});

