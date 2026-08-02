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

const CACHE_NAME = 'cv-image-cache-v1';

self.addEventListener('install', function(event) {
  self.skipWaiting();
});

self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(cacheNames) {
      return Promise.all(
        cacheNames.map(function(cacheName) {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    }).then(function() {
      return self.clients.claim();
    })
  );
});

self.addEventListener('fetch', function(event) {
  // Ignorar chamadas que não são GET
  if (event.request.method !== 'GET') return;

  const requestUrl = new URL(event.request.url);
  
  // Interceptar apenas requisições de imagens
  const isImage = event.request.destination === 'image' || 
                  requestUrl.pathname.match(/\.(png|jpg|jpeg|gif|webp|svg)$/i) ||
                  requestUrl.pathname.includes('/imagens/') ||
                  requestUrl.hostname.includes('gtin.rscsistemas.com.br') ||
                  requestUrl.hostname.includes('openfoodfacts');
                  
  if (isImage) {
    event.respondWith(
      caches.match(event.request).then(function(cachedResponse) {
        if (cachedResponse) {
          // Retorna do cache instantaneamente (offline-first para imagens)
          return cachedResponse;
        }
        
        // Se não tem no cache, busca na rede e guarda uma cópia
        return fetch(event.request).then(function(networkResponse) {
          // Clona a resposta pois a stream só pode ser consumida uma vez
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then(function(cache) {
            cache.put(event.request, responseToCache);
          });
          
          return networkResponse;
        }).catch(function() {
          // Se falhar (offline total e sem cache), retorna uma resposta vazia silenciosa
          return new Response('', { status: 404, statusText: 'Offline' });
        });
      })
    );
  }
});
