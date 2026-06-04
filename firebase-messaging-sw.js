// FCM 백그라운드 메시지 수신 전담 서비스워커
// 앱이 꺼져있거나 백그라운드일 때 푸시를 받아 알림을 띄운다.
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyDmyo0wXdWXXclODKQY9vFMoBXca3ObuvM",
  authDomain: "chat-f2661.firebaseapp.com",
  projectId: "chat-f2661",
  storageBucket: "chat-f2661.firebasestorage.app",
  messagingSenderId: "722874427978",
  appId: "1:722874427978:web:b14a33019815a66240d4b3"
});

const messaging = firebase.messaging();

// data-only 메시지 백그라운드 수신 → 알림 표시
messaging.onBackgroundMessage(function(payload) {
  var title = (payload.data && payload.data.title) ||
              (payload.notification && payload.notification.title) ||
              '새 메시지';
  var body = (payload.data && payload.data.body) ||
             (payload.notification && payload.notification.body) ||
             '새 알림이 있어요';
  return self.registration.showNotification(title, {
    body: body,
    icon: '/myplanner-app/icons/icon-192.png',
    badge: '/myplanner-app/icons/icon-192.png',
    tag: 'planner-notification',
    renotify: true
  });
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
