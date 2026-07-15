// FCM 백그라운드 메시지 수신 전담 서비스워커
// 앱이 꺼져있거나 백그라운드일 때 푸시를 받아 알림을 띄운다.
// SW_VERSION: v451 (data-only 방식 — onBackgroundMessage 유지)
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

// 새 SW가 즉시 활성화되어 옛 버전을 교체하도록 강제
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

// 백그라운드 메시지 수신 (data-only 방식)
// 서버는 notification 페이로드 없이 data만 보낸다. 따라서 FCM 자동표시가
// 발생하지 않으므로, 알림 표시는 오직 이 onBackgroundMessage 한 곳에서만 한다.
// → 자동표시와 충돌이 원천적으로 불가능 → iOS/Android 모두 정확히 1개.
messaging.onBackgroundMessage(function(payload) {
  var d = payload.data || {};
  var title = d.title || '일정 알림';
  var body = d.body || '새 메시지가 있습니다';
  return self.registration.showNotification(title, {
    body: body,
    icon: '/myplanner-app/icons/icon-192.png',
    badge: '/myplanner-app/icons/icon-badge.png',
    tag: 'planner-notification',
    renotify: true
  });
});

// 앱이 열리거나 포커스될 때 메인 페이지에서 알림 정리를 요청함.
// 이 알림은 이 SW(self.registration)에서 표시했으므로 여기서 닫아야
// 메인 sw.js의 registration.getNotifications()로는 보이지 않아 안 지워짐.
self.addEventListener('message', function(e) {
  if (e.data && e.data.type === 'CLEAR_NOTIFICATIONS') {
    self.registration.getNotifications().then(function(notifications) {
      notifications.forEach(function(n) { n.close(); });
    });
  }
});

// 알림 클릭 시 앱 열기/포커스
self.addEventListener('notificationclick', function(e) {
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
