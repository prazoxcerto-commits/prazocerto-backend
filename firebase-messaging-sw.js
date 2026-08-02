// Script base para o Service Worker do Firebase Cloud Messaging
importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-messaging-compat.js');

const firebaseConfig = {
  projectId: "controlvald-app-2026",
  appId: "1:310978956391:web:0f1007706e378ebf5498c2",
  storageBucket: "controlvald-app-2026.firebasestorage.app",
  apiKey: "AIzaSyDZ23dSvO1QlivRwNl9OIbceQL9uOvqaUY",
  authDomain: "controlvald-app-2026.firebaseapp.com",
  messagingSenderId: "310978956391"
};

firebase.initializeApp(firebaseConfig);

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  console.log('[firebase-messaging-sw.js] Recebido background message ', payload);
  const notificationTitle = payload.notification?.title || payload.data?.title || 'PrazoCerto';
  const notificationOptions = {
    body: payload.notification?.body || payload.data?.body,
    icon: 'https://cdn-icons-png.flaticon.com/512/6863/6863985.png',
    data: { productId: payload.data?.productId },
    actions: [
      { action: 'consume', title: '✅ Já consumi' },
      { action: 'discard', title: '🗑 Descartar' }
    ]
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  
  if (event.action === 'discard' || event.action === 'consume') {
    event.waitUntil(
      self.clients.matchAll({ type: 'window' }).then(function(clientList) {
        for (var i = 0; i < clientList.length; i++) {
          var client = clientList[i];
          if (client.url.includes(self.registration.scope) && 'focus' in client) {
            client.postMessage({
              action: 'deleteProduct',
              productId: event.notification.data.productId
            });
            return client.focus();
          }
        }
        if (self.clients.openWindow) {
          return self.clients.openWindow('/?action=delete&id=' + event.notification.data.productId);
        }
      })
    );
  } else {
    event.waitUntil(
      self.clients.matchAll({ type: 'window' }).then(function(clientList) {
        for (var i = 0; i < clientList.length; i++) {
          var client = clientList[i];
          if (client.url.includes(self.registration.scope) && 'focus' in client) {
            return client.focus();
          }
        }
        if (self.clients.openWindow) {
          return self.clients.openWindow('/');
        }
      })
    );
  }
});
