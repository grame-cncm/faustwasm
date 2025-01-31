/// <reference lib="webworker" /> 

// Set to > 0 if the DSP is polyphonic
const FAUST_DSP_VOICES = 0;
// Set to true if the DSP has an effect
const FAUST_DSP_HAS_EFFECT = false;

const CACHE_NAME = "FAUST_DSP_NAME_VERSION_DATE"; // Cache name with versioning

/**
 * List of essential resources required for the **Mono DSP** version of the application.
 * 
 * - These files are cached to enable offline functionality and improve loading speed.
 * - Includes the main HTML, JavaScript, and CSS files required for the app.
 * - Contains Faust-related files needed for DSP processing.
 */
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

/**
 * List of resources for the **Polyphonic DSP** version of the application.
 * 
 * - Extends the mono resource list by adding a **mixer module**.
 * - The mixer module is required to handle multiple simultaneous voices used in a polyphonic instrument.
 */
const POLY_RESOURCES = [
    ...MONO_RESOURCES,
    "./mixer-module.wasm",
];

/**
 * List of resources for the **Polyphonic DSP with Effects** version.
 * 
 * - Extends the polyphonic resource list by adding an **effect module**.
 * - The effect module allows applying audio effects to the polyphonic instrument.
 */
const POLY_EFFECT_RESOURCES = [
    ...POLY_RESOURCES,
    "./effect-module.wasm",
    "./effect-meta.json",
];

/** @type {ServiceWorkerGlobalScope} */
const serviceWorkerGlobalScope = self;

/**
 * Install the service worker, cache essential resources, and prepare for immediate activation.
 *
 * - Opens the cache and stores required assets based on the app's configuration.
 * - Ensures resources are preloaded for offline access.
 */
serviceWorkerGlobalScope.addEventListener("install", (event) => {
    console.log("Service worker installed");
    event.waitUntil((async () => {
        const cache = await caches.open(CACHE_NAME);
        const resources = (FAUST_DSP_VOICES && FAUST_DSP_HAS_EFFECT) ? POLY_EFFECT_RESOURCES : (FAUST_DSP_VOICES ? POLY_RESOURCES : MONO_RESOURCES);
        try {
            return cache.addAll(resources);
        } catch (error) {
            console.error("Failed to cache resources during install:", error);
        }
    })());
});

/**
 * Handles the activation of the Service Worker.
 * 
 * - Claims control over all clients immediately, bypassing the default behavior that 
 *   requires a page reload before the new service worker takes effect.
 * - Once claimed, it finds all active window clients and reloads them to ensure they are
 *   controlled by the latest version of the service worker.
 * - This approach ensures that updates to the service worker take effect immediately
 *   across all open pages, preventing potential inconsistencies.
 */
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

/**
 * Adjusts response headers to enforce Cross-Origin Opener Policy (COOP) and Cross-Origin Embedder Policy (COEP).
 *
 * - Ensures that the response is served with `Cross-Origin-Opener-Policy: same-origin`
 *   and `Cross-Origin-Embedder-Policy: require-corp`.
 * - Required for enabling **cross-origin isolated** environments in web applications.
 * - Necessary for features like **SharedArrayBuffer**, WebAssembly threads, and 
 *   high-performance APIs that require isolation.
 * - Creates a new `Response` object with the modified headers while preserving 
 *   the original response body and status.
 * 
 * @param {Response} response - The original HTTP response object.
 * @returns {Response} A new response with updated security headers.
 */
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
 * Intercepts fetch requests and enforces COOP and COEP headers for security.
 *
 * - Checks if the requested resource is available in the cache:
 *   - If found, returns a cached response with `Cross-Origin-Opener-Policy` and `Cross-Origin-Embedder-Policy` headers.
 *   - If not found, fetches the resource from the network, applies COOP/COEP headers, and caches the response (for GET requests).
 * - Ensures cross-origin isolation, required for APIs like `SharedArrayBuffer` and WebAssembly threading.
 * - Handles network errors gracefully by returning a 503 "Service Unavailable" response when needed.
 * 
 * @param {FetchEvent} event - The fetch event triggered by the browser.
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

