/// <reference lib="webworker" /> 

// Set to > 0 if the DSP is polyphonic
const FAUST_DSP_VOICES = 0;
// Set to true if the DSP has an effect
const FAUST_DSP_HAS_EFFECT = false;

const CACHE_NAME = "FAUST_DSP_NAME-static"; // Cache name without versioning

const MONO_RESOURCES = [
    "./index.html",
    "./index.js",
    "./create-node.js",
    "./faust-ui/index.js",
    "./faust-ui/index.css",
    "./faustwasm/index.js",
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

/** @type {ServiceWorkerGlobalScope} */
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

serviceWorkerGlobalScope.addEventListener("activate", (event) => {
    console.log("Service worker activated");
    event.waitUntil(
        clients.claim().then(() => {
            return clients.matchAll({ type: "window" }).then((clients) => {
                clients.forEach((client) => {
                    client.navigate(client.url);
                });
            });
        })
    );
});

/** @type {(response: Response) => Response} */
const getCrossOriginIsolatedResponse = (response) => {
    // Modify headers to include COOP & COEP
    const headers = new Headers(response.headers);
    headers.set("Cross-Origin-Opener-Policy", "same-origin");
    headers.set("Cross-Origin-Embedder-Policy", "require-corp");

    // Create a new response with the modified headers
    const modifiedResponse = new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers
    });

    return modifiedResponse;
};

/**
 * Intercept fetch requests to enforce COOP and COEP headers.
 */
serviceWorkerGlobalScope.addEventListener("fetch", (event) => {

    event.respondWith((async () => {
        const cache = await caches.open(CACHE_NAME);
        const cachedResponse = await cache.match(event.request);

        if (cachedResponse) {
            return getCrossOriginIsolatedResponse(cachedResponse);
        } else {
            try {
                const fetchResponse = await fetch(event.request);

                if (event.request.method === "GET" && fetchResponse && fetchResponse.status === 200 && fetchResponse.type === "basic") {
                    const modifiedResponse = getCrossOriginIsolatedResponse(fetchResponse);
                    // Store the modified response in the cache
                    await cache.put(event.request, modifiedResponse.clone());
                    // Return the modified response to the browser
                    return modifiedResponse;
                }

                return fetchResponse;
            } catch (error) {
                console.error("Network access error", error);
                return new Response("Network error", { status: 503, statusText: "Service Unavailable" });
            }
        }
    })());
});

