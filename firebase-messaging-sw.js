// FCM 諛깃렇?쇱슫??硫붿떆吏 ?섏떊 ?꾨떞 ?쒕퉬?ㅼ썙而?// ?깆씠 爰쇱졇?덇굅??諛깃렇?쇱슫?쒖씪 ???몄떆瑜?諛쏆븘 ?뚮┝???꾩슫??
// SW_VERSION: v469 (data-only 諛⑹떇 ??onBackgroundMessage ?좎?)
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

// ??SW媛 利됱떆 ?쒖꽦?붾릺????踰꾩쟾??援먯껜?섎룄濡?媛뺤젣
self.addEventListener('install', function() { self.skipWaiting(); });
self.addEventListener('activate', function(e) { e.waitUntil(self.clients.claim()); });

firebase.initializeApp({
  apiKey: "AIzaSyDmyo0wXdWXXclODKQY9vFMoBXca3ObuvM",
  authDomain: "chat-f2661.firebaseapp.com",
  projectId: "chat-f2661",
  storageBucket: "chat-f2661.firebasestorage.app",
  messagingSenderId: "722874427978",
  appId: "1:722874427978:web:b14a33019815a66240d4b3"
});

const messaging = firebase.messaging();

// 諛깃렇?쇱슫??硫붿떆吏 ?섏떊 (data-only 諛⑹떇)
// ?쒕쾭??notification ?섏씠濡쒕뱶 ?놁씠 data留?蹂대궦?? ?곕씪??FCM ?먮룞?쒖떆媛
// 諛쒖깮?섏? ?딆쑝誘濡? ?뚮┝ ?쒖떆???ㅼ쭅 ??onBackgroundMessage ??怨녹뿉?쒕쭔 ?쒕떎.
// ???먮룞?쒖떆? 異⑸룎???먯쿇?곸쑝濡?遺덇?????iOS/Android 紐⑤몢 ?뺥솗??1媛?
messaging.onBackgroundMessage(function(payload) {
  var d = payload.data || {};
  var title = d.title || '?쇱젙 ?뚮┝';
  var body = d.body || '??硫붿떆吏媛 ?덉뒿?덈떎';
  return self.registration.showNotification(title, {
    body: body,
    icon: '/myplanner-app/icons/icon-192.png',
    badge: '/myplanner-app/icons/icon-badge.png',
    tag: 'planner-notification',
    renotify: true
  });
});

// ?깆씠 ?대━嫄곕굹 ?ъ빱?ㅻ맆 ??硫붿씤 ?섏씠吏?먯꽌 ?뚮┝ ?뺣━瑜??붿껌??
// ???뚮┝? ??SW(self.registration)?먯꽌 ?쒖떆?덉쑝誘濡??ш린???レ븘??// 硫붿씤 sw.js??registration.getNotifications()濡쒕뒗 蹂댁씠吏 ?딆븘 ??吏?뚯쭚.
self.addEventListener('message', function(e) {
  if (e.data && e.data.type === 'CLEAR_NOTIFICATIONS') {
    self.registration.getNotifications().then(function(notifications) {
      notifications.forEach(function(n) { n.close(); });
    });
  }
});

// ?뚮┝ ?대┃ ?????닿린/?ъ빱??self.addEventListener('notificationclick', function(e) {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(cls) {
      for (var i = 0; i < cls.length; i++) {
        if (cls[i].url.includes('/myplanner-app') && 'focus' in cls[i]) return cls[i].focus();
      }
      if (clients.openWindow) return clients.openWindow('/myplanner-app/');
    })
  );
});

