// FCM 백그?�운??메시지 ?�신 ?�담 ?�비?�워�?// ?�이 꺼져?�거??백그?�운?�일 ???�시�?받아 ?�림???�운??
// SW_VERSION: v491 (data-only 방식 ??onBackgroundMessage ?��?)
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

// ??SW가 즉시 ?�성?�되????버전??교체?�도�?강제
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

// 백그?�운??메시지 ?�신 (data-only 방식)
// ?�버??notification ?�이로드 ?�이 data�?보낸?? ?�라??FCM ?�동?�시가
// 발생?��? ?�으므�? ?�림 ?�시???�직 ??onBackgroundMessage ??곳에?�만 ?�다.
// ???�동?�시?� 충돌???�천?�으�?불�?????iOS/Android 모두 ?�확??1�?
messaging.onBackgroundMessage(function(payload) {
  var d = payload.data || {};
  var title = d.title || '?�정 ?�림';
  var body = d.body || '??메시지가 ?�습?�다';
  return self.registration.showNotification(title, {
    body: body,
    icon: '/myplanner-app/icons/icon-192.png',
    badge: '/myplanner-app/icons/icon-badge.png',
    tag: 'planner-notification',
    renotify: true
  });
});

// ?�이 ?�리거나 ?�커?�될 ??메인 ?�이지?�서 ?�림 ?�리�??�청??
// ???�림?� ??SW(self.registration)?�서 ?�시?�으므�??�기???�아??// 메인 sw.js??registration.getNotifications()로는 보이지 ?�아 ??지?�짐.
self.addEventListener('message', function(e) {
  if (e.data && e.data.type === 'CLEAR_NOTIFICATIONS') {
    self.registration.getNotifications().then(function(notifications) {
      notifications.forEach(function(n) { n.close(); });
    });
  }
});

// ?�림 ?�릭 ?????�기/?�커??self.addEventListener('notificationclick', function(e) {
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

