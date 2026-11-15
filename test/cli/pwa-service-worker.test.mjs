/**
 * The generated PWA registers its service worker.
 *
 * `faust2wasm -pwa` writes an `index.js` that imports `faust-pwa.js`
 * dynamically, and the `FaustPWA` constructor is what registers
 * `service-worker.js`. A dynamic import resolves after the window's `load`
 * event, so a constructor that only listens for `load` never registers
 * anything: the app works online, is not installable and does not reload
 * offline, with nothing in the console to say so.
 *
 * Checked on the `faust-pwa.js` the CLI wrote, imported as the page imports
 * it, with the three globals the constructor reads replaced by fakes. As in
 * `test/unit/script-processor.test.mjs`, `navigator` is redefined rather than
 * assigned: Node 22 owns it as a getter-only accessor.
 */
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { outDir, runCliOk } from './runner.mjs';

/** The class under test, from the generated module. */
let FaustPWA;

/** URLs passed to `navigator.serviceWorker.register`, in call order. */
let registered = [];

/** Listeners the constructor added for the window's `load` event. */
let loadListeners = [];

/** What `document.readyState` answers; set by each case. */
let readyState = 'loading';

/** The constructor only suspends the context and sets up its destination. */
const makeOptions = () => ({
    dspName: 'mono',
    audioContext: { destination: {}, suspend: () => {} }
});

before(async () => {
    const dir = outDir('pwa-service-worker');
    runCliOk('faust2wasm', ['test/mono.dsp', dir, '-pwa']);

    Object.defineProperty(globalThis, 'navigator', {
        configurable: true,
        value: {
            serviceWorker: {
                // Left pending: the module only logs the outcome.
                register: (url) => {
                    registered.push(url);
                    return new Promise(() => {});
                }
            }
        }
    });
    globalThis.window = /** @type {any} */ ({
        addEventListener: (type, listener) => {
            if (type === 'load') loadListeners.push(listener);
        }
    });
    globalThis.document = /** @type {any} */ ({
        get readyState() {
            return readyState;
        }
    });

    ({ FaustPWA } = await import(
        pathToFileURL(path.join(dir, 'faust-pwa.js')).href
    ));
});

beforeEach(() => {
    registered = [];
    loadListeners = [];
});

test('registers at once when the page has already loaded', () => {
    // The real case: index.js awaits the import, load has fired by then.
    readyState = 'complete';
    new FaustPWA(makeOptions());
    assert.deepEqual(registered, ['./service-worker.js']);
});

test('waits for load when the page is still loading', () => {
    readyState = 'interactive';
    new FaustPWA(makeOptions());
    assert.deepEqual(registered, [], 'nothing before the load event');
    assert.equal(loadListeners.length, 1);

    loadListeners[0]();
    assert.deepEqual(registered, ['./service-worker.js']);
});
