/// <reference lib="webworker" /> 

// Set to > 0 is the DSP is polyphonic
const FAUST_DSP_VOICES = 0;
// Set to true if the DSP has an effect
const FAUST_DSP_HAS_EFFECT = false;

const CACHE_NAME = "FAUST_DSP_NAME-static"; // Cache name without versioning

const MONO_RESOURCES = [
    "./index.html",
    "./faust-ui/index.js",
    "./faust-ui/index.css",
    "./faustwasm/index.js",
    "./index.js",
    "./dsp-module.wasm",
    "./dsp-meta.json"
];

const POLY_RESOURCES = [
    ...MONO_RESOURCES,
    "./mixer-module.wasm",
];

const POLY_EFFECT_RESOURCES = [
    ...POLY_RESOURCES,
    "./effect-module.wasm",
    "./effect-meta.json",
];

/**@type {ServiceWorkerGlobalScope} */
const serviceWorkerGlobalScope = self;

/**
 * Install the service worker and cache the resources
 */
serviceWorkerGlobalScope.addEventListener("install", (event) => {
    console.log("Service worker installed");
    event.waitUntil((async () => {
        const cache = await caches.open(CACHE_NAME);
        const resources = (FAUST_DSP_VOICES && FAUST_DSP_HAS_EFFECT) ? POLY_EFFECT_RESOURCES : FAUST_DSP_VOICES ? POLY_RESOURCES : MONO_RESOURCES;
        try {
            return cache.addAll(resources);
        } catch (error) {
            console.error("Failed to cache resources during install:", error);
        }
    })());
});

serviceWorkerGlobalScope.addEventListener("activate", () => console.log("Service worker activated"));

serviceWorkerGlobalScope.addEventListener("fetch", (event) => {
    event.respondWith((async () => {
        const cache = await caches.open(CACHE_NAME);
        const cachedResponse = await cache.match(event.request);
        if (cachedResponse) {
            return cachedResponse;
        } else {
            try {
                const fetchResponse = await fetch(event.request);
                // Ensure the response is valid before caching it
                if (event.request.method === "GET" && fetchResponse && fetchResponse.status === 200 && fetchResponse.type === "basic") {
                    cache.put(event.request, fetchResponse.clone());
                }
                return fetchResponse;
            } catch (e) {
                // Network access failure
                console.log("Network access error", e);
            }
        }
    })());
});
