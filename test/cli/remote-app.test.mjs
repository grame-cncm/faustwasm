/**
 * The remote-controlled application `faust2wasm -remote` writes.
 *
 * `faust2wasm-modes.test.mjs` checks its top level like every mode's. This
 * checks what is particular to it: the remote control PWA in `remote/`, which
 * must carry no DSP (its interface comes from the host), whose placeholders
 * must all be replaced, and whose service worker must cache files that exist
 * and leave signaling alone -- an event stream put in a cache never resolves,
 * so a worker that intercepted it would leave the remote control waiting for
 * an answer that never comes, online.
 *
 * The worker is run here as the browser runs it, in a scope of its own, with
 * `caches`, `fetch` and the scope's events replaced by fakes.
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vm from 'node:vm';
import { listDir, outDir, readOut, runCli, runCliOk } from './runner.mjs';
import { REMOTE_PWA_FILES } from './expected.mjs';

let dir = '';
const PLACEHOLDERS = ['FAUST_DSP_NAME', 'VERSION_DATE'];

before(() => {
    dir = outDir('remote-app');
    runCliOk('faust2wasm', ['test/mono.dsp', dir, '-remote']);
});

test('the remote control is a PWA without any DSP', () => {
    assert.deepEqual(listDir(path.join(dir, 'remote')), REMOTE_PWA_FILES);
    for (const file of ['index.html', 'index.js']) {
        assert.doesNotMatch(
            readOut(dir, `remote/${file}`),
            /\.wasm|dsp-meta\.json/,
            `remote/${file} refers to a DSP file`
        );
    }
    // One bundle per role, and not the complete one
    assert.deepEqual(listDir(path.join(dir, 'faustwasm-remote')), [
        'client.js',
        'client.js.map',
        'host.js',
        'host.js.map'
    ]);
});

test('each page loads the bundle of its role', () => {
    assert.match(readOut(dir, 'remote/index.js'), /import\("\.\.\/faustwasm-remote\/client\.js"\)/);
    assert.doesNotMatch(readOut(dir, 'remote/index.js'), /faustwasm-remote\/(host|index)\.js/);
    assert.match(readOut(dir, 'index.js'), /import\("\.\/faustwasm-remote\/host\.js"\)/);
    assert.doesNotMatch(readOut(dir, 'index.js'), /faustwasm-remote\/(client|index)\.js/);
});

test('every placeholder of the remote control is replaced', () => {
    for (const file of REMOTE_PWA_FILES.filter((f) => /\.(js|html|json)$/.test(f))) {
        const content = readOut(dir, `remote/${file}`);
        for (const placeholder of PLACEHOLDERS)
            assert.ok(!content.includes(placeholder), `remote/${file} still has ${placeholder}`);
        assert.match(content, /mono/, `remote/${file} does not name the DSP`);
    }
    assert.equal(
        JSON.parse(readOut(dir, 'remote/manifest.json')).start_url,
        './index.html'
    );
});

test('a polyphonic build makes a polyphonic host', () => {
    const polyDir = outDir('remote-app-poly');
    runCliOk('faust2wasm', ['test/mono.dsp', polyDir, '-remote', '-poly']);
    assert.match(readOut(polyDir, 'index.js'), /FAUST_DSP_VOICES = 16/);
    assert.ok(fs.existsSync(path.join(polyDir, 'mixer-module.wasm')));
});

/**
 * Run the generated service worker in a scope of its own.
 *
 * @returns the worker's listeners, and what it put in its cache
 */
const runWorker = () => {
    const ORIGIN = 'https://host.local:8443';
    /** @type {Record<string, (event: any) => void>} */
    const listeners = {};
    /** @type {string[]} */
    const added = [];
    const cache = {
        addAll: async (urls) => added.push(...urls),
        put: async () => {},
        match: async () => undefined
    };
    const context = vm.createContext({
        self: {
            location: { href: `${ORIGIN}/remote/service-worker.js` },
            addEventListener: (type, listener) => (listeners[type] = listener),
            clients: { claim: async () => {} }
        },
        caches: { open: async () => cache, keys: async () => [], delete: async () => true },
        fetch: async () => ({ ok: true, clone() { return this; } }),
        Response,
        URL,
        Set,
        console
    });
    vm.runInContext(readOut(dir, 'remote/service-worker.js'), context);
    /** Dispatch a fetch; return whether the worker answered it. */
    const fetchEvent = (url, method = 'GET') => {
        let answered = false;
        listeners.fetch({
            request: { url: new URL(url, `${ORIGIN}/remote/`).href, method },
            respondWith: () => (answered = true)
        });
        return answered;
    };
    return { listeners, added, fetchEvent };
};

test('the service worker caches files the build actually wrote', async () => {
    const { listeners, added } = runWorker();
    let installed = Promise.resolve();
    listeners.install({ waitUntil: (promise) => (installed = promise) });
    await installed;
    assert.ok(added.length > 0, 'nothing cached');
    for (const resource of added) {
        assert.ok(
            fs.existsSync(path.join(dir, 'remote', resource)),
            `cached ${resource} does not exist`
        );
    }
});

test('the service worker answers for its files and leaves signaling alone', () => {
    const { fetchEvent } = runWorker();
    assert.equal(fetchEvent('./index.js'), true);
    assert.equal(fetchEvent('../faustwasm-remote/client.js'), true);
    // The host's bundle is not the remote control's to cache
    assert.equal(fetchEvent('../faustwasm-remote/host.js'), false);
    assert.equal(fetchEvent('/signal/room/events/peer'), false);
    assert.equal(fetchEvent('/signal/room/send', 'POST'), false);
    // The host page is not the remote control's to cache
    assert.equal(fetchEvent('../index.js'), false);
});

test('without -signal or -stun, the pages use their own server and no STUN', () => {
    for (const file of ['index.js', 'remote/index.js']) {
        assert.match(readOut(dir, file), /const FAUST_SIGNAL_URL = "";/);
        assert.match(readOut(dir, file), /const FAUST_ICE_SERVERS = \[\];/);
    }
});

test('-signal and -stun reach both pages', () => {
    const signalDir = outDir('remote-app-signal');
    runCliOk('faust2wasm', [
        'test/mono.dsp',
        signalDir,
        '-remote',
        '-signal',
        'https://signal.example.org',
        '-stun',
        'stun:stun.example.org:3478',
        '-stun',
        'stun:other.example.org'
    ]);
    for (const file of ['index.js', 'remote/index.js']) {
        const content = readOut(signalDir, file);
        assert.match(content, /const FAUST_SIGNAL_URL = "https:\/\/signal\.example\.org";/, file);
        const ice = content.match(/const FAUST_ICE_SERVERS = (.*);/);
        assert.ok(ice, file);
        assert.deepEqual(JSON.parse(ice[1]), [
            { urls: 'stun:stun.example.org:3478' },
            { urls: 'stun:other.example.org' }
        ]);
    }
});

test('-signal and -stun refuse what they cannot use', () => {
    /** @type {[string[], RegExp][]} */
    const cases = [
        [['-remote', '-signal', 'signal.example.org'], /-signal wants/],
        [['-remote', '-signal', 'https://signal.example.org/?x=1'], /-signal wants/],
        [['-remote', '-stun', 'https://stun.example.org'], /-stun wants/],
        [['-pwa', '-signal', 'https://signal.example.org'], /go with -remote/],
        [['-remote', '-signal'], /-signal needs a value/]
    ];
    for (const [args, message] of cases) {
        const result = runCli('faust2wasm', ['test/mono.dsp', outDir('remote-app-refused'), ...args]);
        assert.equal(result.status, 1, args.join(' '));
        assert.match(result.stdout + result.stderr, message, args.join(' '));
    }
});
