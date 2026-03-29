const CACHE_NAME = 'ofw-pesorate-v1';
const STATIC_ASSETS = [
    '/',
    '/index.html',
    '/app.js',
    '/style.css',
    '/assets/img1.webp',
    '/assets/img2.webp',
    '/assets/img3.webp',
    '/og-preview.png',
    '/manifest.json'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(STATIC_ASSETS);
        })
    );
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((name) => {
                    if (name !== CACHE_NAME) {
                        return caches.delete(name);
                    }
                })
            );
        })
    );
    self.clients.claim();
});

self.addEventListener('fetch', (event) => {
    // ALWAYS bypass cache for API routes to ensure real-time rates
    if (event.request.url.includes('/api/')) {
        event.respondWith(
            fetch(event.request).catch(() => {
                // If offline and accessing an API, return a clean 503 so the frontend fallback triggers
                return new Response(JSON.stringify({
                    status: 'OFFLINE_MODE',
                    message: 'Network disconnected.'
                }), { status: 503, headers: { 'Content-Type': 'application/json' } });
            })
        );
        return;
    }

    // For static assets, serve from cache first, fall back to network
    event.respondWith(
        caches.match(event.request).then((cachedResponse) => {
            if (cachedResponse) return cachedResponse;
            return fetch(event.request).then((networkResponse) => {
                // Cache newly fetched assets dynamically (if they are GET)
                if (event.request.method === 'GET' && networkResponse.ok) {
                    const responseClone = networkResponse.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(event.request, responseClone);
                    });
                }
                return networkResponse;
            }).catch(() => {
                // If offline and not in cache, and request is for navigation, return index.html
                if (event.request.mode === 'navigate') {
                    return caches.match('/index.html');
                }
            });
        })
    );
});
