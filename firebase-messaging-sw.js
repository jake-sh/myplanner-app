// FCM background message service worker (separate from the main sw.js).
// SW_VERSION: v4910 (data-only via onBackgroundMessage only)
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

// Activate this SW immediately and take over on version change.
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

// Background message handling (data-only payloads).
// The server sends data only (no notification payload) so FCM does not
// auto-display; we show exactly one notification here.
messaging.onBackgroundMessage(function(payload) {
  var d = payload.data || {};
  var title = d.title || 'Planner';
  var body = d.body || 'New message';
  return self.registration.showNotification(title, {
    body: body,
    icon: '/myplanner-app/icons/icon-192.png',
    badge: '/myplanner-app/icons/icon-badge.png',
    tag: 'planner-notification',
    renotify: true
  });
});

// The page asks us to clear notifications when it opens/focuses, since these
// notifications were shown by this SW (registration.getNotifications on the
// main sw.js does not see them).
self.addEventListener('message', function(e) {
  if (e.data && e.data.type === 'CLEAR_NOTIFICATIONS') {
    self.registration.getNotifications().then(function(notifications) {
      notifications.forEach(function(n) { n.close(); });
    });
  }
});

// Focus/open the app on notification click.
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
