/**
 * assets/max/faust-remote.js, the node.script of a Max patch hosting a
 * faustgen~ for phones, run as Max would run it -- but with a fake
 * `max-api` that plays the patch: what the script sends out (`outlet`,
 * `post`) comes back here as JSON lines, and what the patch would send in
 * goes to its handlers. A real remote control connects through the real
 * server's relay, as a phone would.
 *
 * What only Max can check (faustgen~ itself, faust-json.js, the patch) is
 * not here: see the README's section on Max.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as path from 'node:path';
import { ROOT, outDir, runCliOk } from './runner.mjs';
import { FaustRemoteDsp } from '../../dist/remote/index.js';

const SCRIPT = path.join(ROOT, 'assets', 'max', 'faust-remote.js');
const DSP = path.join(ROOT, 'assets', 'max', 'faust-remote-demo.dsp');

/** The fake `max-api`: a module whose outside is this process's stdio. */
const FAKE_MAX_API = `
const handlers = new Map();
const say = (...args) => process.stdout.write(JSON.stringify(args) + '\\n');
let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
    buffer += chunk;
    let cut;
    while ((cut = buffer.indexOf('\\n')) !== -1) {
        const [name, ...args] = JSON.parse(buffer.slice(0, cut));
        buffer = buffer.slice(cut + 1);
        handlers.get(name)?.(...args);
    }
});
module.exports = {
    POST_LEVELS: { ERROR: 'error', INFO: 'info', WARN: 'warn' },
    addHandler: (name, handler) => handlers.set(name, handler),
    outlet: async (...args) => say('outlet', ...args),
    post: async (message, level) => say('post', String(message), level ?? 'info')
};
`;

const freePort = () =>
    new Promise((resolve) => {
        const server = net.createServer();
        server.listen(0, '127.0.0.1', () => {
            const { port } = /** @type {net.AddressInfo} */ (server.address());
            server.close(() => resolve(port));
        });
    });

/** The script in a process of its own, with what it said so far. */
const startScript = async (
    /** @type {string} */ dir,
    /** @type {string} */ appDir,
    /** @type {string[]} */ extra = []
) => {
    const fake = path.join(dir, 'fake', 'node_modules', 'max-api');
    fs.mkdirSync(fake, { recursive: true });
    fs.writeFileSync(path.join(fake, 'index.js'), FAKE_MAX_API);
    const port = await freePort();
    const child = spawn(
        process.execPath,
        [SCRIPT, 'root', appDir, 'port', String(port), 'address', '127.0.0.1', 'host', '127.0.0.1', ...extra],
        {
            env: {
                ...process.env,
                NODE_PATH: path.join(dir, 'fake', 'node_modules'),
                // The session is kept under the home folder: this one
                HOME: dir
            }
        }
    );
    /** @type {any[][]} */
    const said = [];
    /** @type {((message: any[]) => void)[]} */
    const waiting = [];
    let buffer = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
        buffer += chunk;
        let cut;
        while ((cut = buffer.indexOf('\n')) !== -1) {
            const message = JSON.parse(buffer.slice(0, cut));
            buffer = buffer.slice(cut + 1);
            said.push(message);
            for (const wake of waiting.splice(0)) wake(message);
        }
    });
    let stderr = '';
    child.stderr.on('data', (chunk) => (stderr += chunk));
    const send = (/** @type {any[]} */ ...message) =>
        child.stdin.write(JSON.stringify(message) + '\n');
    /** Wait for an outlet message that `match` accepts. */
    const outlet = (/** @type {(args: any[]) => boolean} */ match, timeout = 10000) =>
        new Promise((resolve, reject) => {
            const found = said.find((m) => m[0] === 'outlet' && match(m.slice(1)));
            if (found) return resolve(found.slice(1));
            const timer = setTimeout(
                () => reject(new Error(`no such outlet message; said: ${JSON.stringify(said)}\n${stderr}`)),
                timeout
            );
            const check = (/** @type {any[]} */ message) => {
                if (message[0] === 'outlet' && match(message.slice(1))) {
                    clearTimeout(timer);
                    resolve(message.slice(1));
                } else waiting.push(check);
            };
            waiting.push(check);
        });
    return { child, said, send, outlet, port };
};

const settle = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

test('the Max host script takes a phone and drives faustgen~ both ways', { timeout: 60000 }, async () => {
    const dir = outDir('max-remote');
    const appDir = path.join(dir, 'app');
    runCliOk('faust2wasm', [DSP, appDir, '-remote']);
    const json = fs.readFileSync(path.join(appDir, 'dsp-meta.json'), 'utf8');
    const meta = JSON.parse(json);
    const name = meta.name;
    const FREQ = `/${name}/freq`;
    const LEVEL = `/${name}/level`;

    const script = await startScript(dir, appDir);
    try {
        // The script asks faust-json.js for the JSON it holds
        await script.outlet((args) => args[0] === 'getjson');
        script.send('json', json);
        const [, link] = await script.outlet((args) => args[0] === 'link');
        const url = new URL(link);
        const params = new URLSearchParams(url.hash.slice(1));
        assert.equal(url.origin, `http://127.0.0.1:${script.port}`);

        // A phone, through the relay
        const dsp = await FaustRemoteDsp.connectRelay(url.origin, params.get('room') ?? '', {
            token: params.get('token') ?? '',
            id: 'phone',
            pingInterval: 0,
            gestureEnd: 0
        });
        try {
            assert.equal(dsp.getParamValue(FREQ), 440);
            await script.outlet((args) => args[0] === 'clients' && args[1] === 1);

            // The phone writes: a message for faustgen~
            dsp.setParamValue(FREQ, 660);
            await script.outlet((args) => args[0] === 'param' && args[1] === FREQ && args[2] === 660);

            // faustgen~ is asked for its controls while a phone is there
            await script.outlet((args) => args[0] === 'dump');

            // faustgen~ reports a bargraph, and a change made in the patch
            /** @type {[string, number][]} */
            const meters = [];
            dsp.setOutputParamHandler((address, value) => meters.push([address, value]));
            script.send('values', LEVEL, 0.5, FREQ, 330);
            await settle(300);
            assert.deepEqual(meters.at(-1), [LEVEL, 0.5]);
            assert.equal(dsp.getParamValue(FREQ), 330);

            // The value the phone wrote, reported back by a dump, goes
            // nowhere: no message for faustgen~ beyond the one write
            script.send('values', FREQ, 330);
            await settle(200);
            const writes = script.said.filter((m) => m[0] === 'outlet' && m[1] === 'param');
            assert.deepEqual(writes, [['outlet', 'param', FREQ, 660]]);
        } finally {
            dsp.close();
        }
        await script.outlet((args) => args[0] === 'clients' && args[1] === 0);

        // The session is kept outside the folder served
        const kept = fs.readdirSync(path.join(dir, '.faust-remote'));
        assert.equal(kept.length, 1);
        assert.ok(!fs.readdirSync(appDir).some((file) => file.includes('faust-remote')));
    } finally {
        script.child.kill();
    }
});

test('without a root, or a root without a remote control, the script says so', async () => {
    const dir = outDir('max-remote-errors');
    const script = await startScript(dir, path.join(dir, 'nothing-here'));
    try {
        await settle(1500);
        const posts = script.said.filter((m) => m[0] === 'post' && m[2] === 'error');
        assert.match(posts[0]?.[1] ?? '', /no remote\/index\.html/);
    } finally {
        script.child.kill();
    }
});

/** A phone connected to the script by its pairing link. */
const phoneFor = async (/** @type {string} */ link) => {
    const url = new URL(link);
    const params = new URLSearchParams(url.hash.slice(1));
    return FaustRemoteDsp.connectRelay(url.origin, params.get('room') ?? '', {
        token: params.get('token') ?? '',
        id: 'phone',
        pingInterval: 0,
        gestureEnd: 0
    });
};

test('target params with a Faust interface: labels both ways, the patch values first', { timeout: 60000 }, async () => {
    const dir = outDir('max-remote-params-ui');
    const appDir = path.join(dir, 'app');
    runCliOk('faust2wasm', [path.join(ROOT, 'assets', 'max', 'faust-remote-params.dsp'), appDir, '-remote']);
    const name = JSON.parse(fs.readFileSync(path.join(appDir, 'dsp-meta.json'), 'utf8')).name;
    const script = await startScript(dir, appDir, [
        'target', 'params',
        'ui', path.join(appDir, 'dsp-meta.json')
    ]);
    try {
        // The interface is the file's; the patch is asked for its values
        const [, link] = await script.outlet((args) => args[0] === 'link');
        await script.outlet((args) => args[0] === 'getjson');
        // The values faust-params.js sends with its JSON, and its JSON,
        // which the file overrides
        script.send('json', '{"name":"other","ui":[]}');
        script.send('pvalues', 'freq', 550, 'play', 1);
        await settle(200);
        const dsp = await phoneFor(link);
        try {
            assert.equal(dsp.getParamValue(`/${name}/freq`), 550, 'the patch value, not the file init');
            assert.equal(dsp.getParamValue(`/${name}/play`), 1);
            // A phone writes: pset, by label
            dsp.setParamValue(`/${name}/gain`, 0.5);
            await script.outlet((args) => args[0] === 'pset' && args[1] === 'gain' && args[2] === 0.5);
            // A move in the patch, and a meter
            /** @type {[string, number][]} */
            const meters = [];
            dsp.setOutputParamHandler((address, value) => meters.push([address, value]));
            script.send('pvalues', 'freq', 330, 'level', 0.75, 'unknown', 1);
            await settle(300);
            assert.equal(dsp.getParamValue(`/${name}/freq`), 330);
            assert.deepEqual(meters.at(-1), [`/${name}/level`, 0.75]);
            // No dump: parameters report their own changes
            assert.ok(!script.said.some((m) => m[0] === 'outlet' && m[1] === 'dump'));
        } finally {
            dsp.close();
        }
    } finally {
        script.child.kill();
    }
});

test('target params with the JSON faust-params.js builds', { timeout: 60000 }, async () => {
    const dir = outDir('max-remote-params-auto');
    const appDir = path.join(dir, 'app');
    runCliOk('faust2wasm', [DSP, appDir, '-remote']);
    const script = await startScript(dir, appDir, ['target', 'params']);
    try {
        await script.outlet((args) => args[0] === 'getjson');
        script.send(
            'json',
            JSON.stringify({
                name: 'demo',
                ui: [
                    {
                        type: 'vgroup',
                        label: 'demo',
                        items: [
                            { type: 'hslider', label: 'cutoff', shortname: 'cutoff', address: '/demo/cutoff', index: 0, init: 440, min: 20, max: 2000, step: 1 }
                        ]
                    }
                ]
            })
        );
        const [, link] = await script.outlet((args) => args[0] === 'link');
        const dsp = await phoneFor(link);
        try {
            dsp.setParamValue('/demo/cutoff', 1000);
            await script.outlet((args) => args[0] === 'pset' && args[1] === 'cutoff' && args[2] === 1000);
            assert.ok(!script.said.some((m) => m[0] === 'outlet' && m[1] === 'param'), 'no faustgen~ message');
        } finally {
            dsp.close();
        }
    } finally {
        script.child.kill();
    }
});
