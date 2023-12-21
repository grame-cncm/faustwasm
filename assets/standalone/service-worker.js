self.addEventListener('install', event => {
    event.waitUntil(
        caches.open('FAUST_DSP-static-v1').then(cache => {
            return cache.addAll([
                '/faust-ui/index.js',
                '/faustwasm/index.js',
                '/faustwasm/styles.css',
                '/index.html',
                '/FAUST_DSP.js',
                '/FAUST_DSP.wasm',
                '/FAUST_DSP.json',
            ]).catch(error => {
                // Catch and log any errors during the caching process
                console.error('Failed to cache resources during install:', error);
            });
        })
    );
});

self.addEventListener('activate', event => {
    // This ensures that the new service worker takes control immediately
    event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', event => {
    event.respondWith(
        caches.match(event.request).then(response => {
            // Return the cached response if found, else fetch from network
            return response || fetch(event.request).catch(() => {
                // Fallback content or page for failed network requests
                return caches.match('/offline.html');
            });
        })
    );
});
