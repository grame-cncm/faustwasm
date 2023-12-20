self.addEventListener('install', event => {
    event.waitUntil(
        caches.open('FAUST_DSP-static').then(cache => {
            return cache.addAll([
                '/',
                '/faust-ui/index.js',
                '/faustwasm/index.js',
                '/faustwasm/styles.css',
                '/index.html',
                '/FAUST_DSP.js',
            ]);
        })
    );
});
