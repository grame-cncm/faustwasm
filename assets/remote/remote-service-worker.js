/// <reference lib="webworker" />

/**
 * @file Service worker of the remote control PWA.
 *
 * Caches the remote control's own files, so the installed app opens without
 * the network, and leaves everything else to the network untouched:
 * signaling in particular (`/signal/…`), whose event stream never ends and
 * would never resolve if it were put in a cache.
 *
 * The remote control needs no cross-origin isolation (it holds no
 * SharedArrayBuffer), so unlike the standalone PWA's worker this one does
 * not rewrite headers.
 */

const CACHE_PREFIX = "FAUST_DSP_NAME-remote_";
const CACHE_NAME = `${CACHE_PREFIX}VERSION_DATE`;

/** The files of the remote control, relative to this worker. */
const RESOURCES = [
    "./index.html",
    "./index.js",
    "./manifest.json",
    "./icon.png",
    "../create-node.js",
    "../faust-ui/index.js",
    "../faust-ui/index.css",
    "../faustwasm-remote/client.js"
];

/** @type {ServiceWorkerGlobalScope} */
const scope = self;

/**
 * What "Play locally" loads: the DSP generated at the top, and faustwasm.
 * Cached when first used, not at install, so that a remote control that
 * never plays locally does not download them. Some only exist for a
 * polyphonic DSP or one with an effect.
 */
const LOCAL_RESOURCES = [
    "../dsp-meta.json",
    "../dsp-module.wasm",
    "../mixer-module.wasm",
    "../effect-meta.json",
    "../effect-module.wasm",
    "../faustwasm/index.js"
];

/** The absolute URLs of the files this worker answers for. */
const cached = new Set(
    [...RESOURCES, ...LOCAL_RESOURCES].map((resource) => new URL(resource, scope.location.href).href)
);

scope.addEventListener("install", (event) => {
    event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(RESOURCES)));
});

scope.addEventListener("activate", (event) => {
    // Drop the caches of earlier builds of this app
    event.waitUntil((async () => {
        for (const name of await caches.keys()) {
            if (name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME) await caches.delete(name);
        }
        await scope.clients.claim();
    })());
});

scope.addEventListener("fetch", (event) => {
    const url = new URL(event.request.url);
    url.hash = "";
    url.search = "";
    // Not ours: the browser fetches it as if there were no worker
    if (event.request.method !== "GET" || !cached.has(url.href)) return;
    event.respondWith((async () => {
        const cache = await caches.open(CACHE_NAME);
        // The network first, for an up-to-date app when the host is reachable;
        // the cache when it is not
        try {
            const response = await fetch(event.request);
            if (response.ok) await cache.put(url.href, response.clone());
            return response;
        } catch {
            return (await cache.match(url.href)) ?? new Response("Offline", { status: 503 });
        }
    })());
});
