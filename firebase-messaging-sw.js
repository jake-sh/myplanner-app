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

// 백그라운드 메시지 수신
// 주의: 서버가 'notification' 페이로드를 포함해 보내면 FCM/OS가 자동으로 알림을
// 1개 표시한다. 이때 여기서 showNotification을 또 호출하면 iOS에서 알림이 2개가 된다
// (iOS는 tag 병합이 불안정). 따라서 notification 페이로드가 있으면 표시하지 않고,
// data-only 메시지일 때만 직접 표시한다.
messaging.onBackgroundMessage(function(payload) {
  // notification 페이로드가 있으면 FCM 자동표시에 맡기고 중복 표시하지 않음
  if (payload.notification) return;

  var title = (payload.data && payload.data.title) || '새 메시지';
  var body = (payload.data && payload.data.body) || '새 알림이 있어요';
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
