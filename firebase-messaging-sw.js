// Script base para o Service Worker do Firebase Cloud Messaging & Cache Offline de Alta Performance
importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-messaging-compat.js');

const CACHE_NAME = 'prazocerto-v2';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js',
  '/catalogos_data.js',
  '/logo_prazox.png',
  '/images/prazocerto_logo_icon.png',
  '/images/prazocerto_basket_v2.png',
  '/images/onboarding_perfect.png'
];

self.addEventListener('install', function(event) {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(STATIC_ASSETS).catch(function(err) {
        console.warn('Falha parcial ao pré-carregar cache estático:', err);
      });
    })
  );
});

self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(cacheNames) {
      return Promise.all(
        cacheNames.map(function(cacheName) {
          if (cacheName !== CACHE_NAME && cacheName !== 'cv-image-cache-v1') {
            return caches.delete(cacheName);
          }
        })
      );
    }).then(function() {
      return self.clients.claim();
    })
  );
});

// Interceptação de requisições: Cache First para imagens e Network First para arquivos principais
self.addEventListener('fetch', function(event) {
  if (event.request.method !== 'GET') return;
  const requestUrl = new URL(event.request.url);

  // Ignora requisições de APIs externas do Firebase, Firestore, Google Analytics e Mercado Pago
  if (
    requestUrl.hostname.includes('firestore.googleapis.com') ||
    requestUrl.hostname.includes('identitytoolkit.googleapis.com') ||
    requestUrl.hostname.includes('securetoken.googleapis.com') ||
    requestUrl.hostname.includes('mercadopago.com')
  ) {
    return;
  }

  const isImage = event.request.destination === 'image' || 
                  requestUrl.pathname.match(/\.(png|jpg|jpeg|gif|webp|svg)$/i) ||
                  requestUrl.pathname.includes('/imagens/') ||
                  requestUrl.pathname.includes('/images/') ||
                  requestUrl.hostname.includes('gtin.rscsistemas.com.br') ||
                  requestUrl.hostname.includes('openfoodfacts') ||
                  requestUrl.hostname.includes('metafloor.com');

  if (isImage) {
    // Cache First para imagens
    event.respondWith(
      caches.match(event.request).then(function(cached) {
        if (cached) return cached;
        return fetch(event.request).then(function(response) {
          if (response && response.status === 200) {
            const respClone = response.clone();
            caches.open('cv-image-cache-v1').then(function(cache) {
              cache.put(event.request, respClone);
            });
          }
          return response;
        }).catch(function() {
          return new Response('', { status: 404, statusText: 'Offline Image' });
        });
      })
    );
    return;
  }

  // Network First com fallback para Cache para CSS, JS e HTML
  if (
    requestUrl.origin === location.origin &&
    (requestUrl.pathname.endsWith('.js') ||
     requestUrl.pathname.endsWith('.css') ||
     requestUrl.pathname.endsWith('.html') ||
     requestUrl.pathname === '/')
  ) {
    event.respondWith(
      fetch(event.request).then(function(networkResponse) {
        if (networkResponse && networkResponse.status === 200) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then(function(cache) {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      }).catch(function() {
        return caches.match(event.request);
      })
    );
  }
});

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
    icon: '/images/prazocerto_logo_icon.png',
    badge: '/images/prazocerto_logo_icon.png',
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

