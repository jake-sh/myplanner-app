// FCM 백그라운드 메시지 수신 전담 서비스워커
// 앱이 꺼져있거나 백그라운드일 때 푸시를 받아 알림을 띄운다.
// SW_VERSION: v370 (갱신 강제용 — 바이트 변경)
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

// 백그라운드 메시지 수신
// 서버(sendpush)가 보내는 메시지에 notification 페이로드가 포함되어 있어,
// iOS/FCM이 자동으로 알림을 1개 표시한다("일정 알림 / 새 메시지가 있습니다").
// 여기서 showNotification을 추가로 호출하면 알림이 2개가 되므로(특히 iOS),
// onBackgroundMessage에서는 어떤 알림도 직접 띄우지 않는다.
// → 모든 백그라운드 알림 표시는 서버 notification 페이로드의 FCM 자동표시에 일임.
messaging.onBackgroundMessage(function(payload) {
  // 의도적으로 아무 알림도 띄우지 않음 (중복 방지)
  return;
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
