/**
 * The C++ host of the remote control protocol (`RemoteUI`, in the
 * architecture files of grame-cncm/faust) against this package's own
 * `FaustRemoteHost`: the same sessions played against both must give the
 * remote controls the same messages.
 *
 * The C++ host is a port of `src/remote/FaustRemoteHost.ts`. Two
 * implementations of one protocol drift apart unless something compares
 * them: this test is that something. Each scenario runs twice, through the
 * same `faust-remote-server`: once with a `FaustRemoteHost` driving a
 * `FaustRemoteHub` in this process, once with a native program compiled
 * from `test/remote-native.dsp` with `tests/remoteui-tests/remote_host.cpp`
 * (a test architecture of the faust repository), which reaches the relay
 * through the server's host listener. What the remote controls receive, step
 * by step, must be the same; the DSP's JSON is compared through the
 * interface it describes, since `JSONUI` and libfaust do not write it alike.
 *
 * Needs a checkout of grame-cncm/faust with a built compiler, named by
 * `FAUST_SOURCE_DIR` (`build/bin/faust` and `architecture/` are used), and
 * a C++ compiler (`CXX`, `c++` by default). Skipped without them.
 *
 * The hub computes nothing: what the DSP does with its controls, a
 * bargraph that sums them, is done by the test on the TypeScript side, the
 * way a node reports its bargraphs (at every block).
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ROOT, outDir, runCliOk, readMeta } from './runner.mjs';

const SOURCE = process.env.FAUST_SOURCE_DIR ?? '';
const CXX = process.env.CXX ?? 'c++';
const FAUST = path.join(SOURCE, 'build', 'bin', 'faust');
const ARCH = path.join(SOURCE, 'tests', 'remoteui-tests', 'remote_host.cpp');
const DSP = path.join(ROOT, 'test', 'remote-native', 'remote_test.dsp');

const missing = !SOURCE
    ? 'FAUST_SOURCE_DIR is not set'
    : !fs.existsSync(FAUST)
      ? `no compiler at ${FAUST}`
      : !fs.existsSync(ARCH)
        ? `no ${ARCH}`
        : spawnSync(CXX, ['--version']).status !== 0
          ? `no C++ compiler (${CXX})`
          : '';
const skip = missing ? `${missing}: the native host is not tested` : false;

const TOKEN = 'conformance-token';
const settle = (ms = 250) => new Promise((resolve) => setTimeout(resolve, ms));

/** @type {any} */ let server;
/** @type {any} */ let hosts;
let base = '';
let hostBase = '';
let program = '';
let json = '';
/** @type {any} */ let remote;
let rooms = 0;

before(async () => {
    if (skip) return;
    remote = await import('../../dist/remote/index.js');
    const { default: createFaustRemoteServer } = await import('../../src/faustRemoteServer.js');
    const out = outDir('remote-native');
    fs.mkdirSync(out, { recursive: true });

    // The JSON libfaust gives, which a Web Audio host would use
    runCliOk('faust2wasm', [DSP, out]);
    json = JSON.stringify(readMeta(out, 'dsp-meta.json'));

    // The native host
    const source = path.join(out, 'remote_test.cpp');
    const arch = path.join(SOURCE, 'architecture');
    const faust = spawnSync(FAUST, ['-a', ARCH, '-I', arch, DSP, '-o', source], { encoding: 'utf8' });
    assert.equal(faust.status, 0, faust.stderr);
    program = path.join(out, 'remote_test');
    const cxx = spawnSync(CXX, ['-std=c++17', '-O1', '-w', '-I', arch, source, '-o', program, '-lpthread'], { encoding: 'utf8' });
    assert.equal(cxx.status, 0, cxx.stderr);

    server = createFaustRemoteServer({ root: ROOT });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(null)));
    base = `http://127.0.0.1:${server.address().port}`;
    hosts = server.hostListener();
    await new Promise((resolve) => hosts.listen(0, '127.0.0.1', () => resolve(null)));
    hostBase = `ws://127.0.0.1:${hosts.address().port}`;
});

after(() => {
    server?.close();
});

// ------------------------------------------------------------------ hosts

/**
 * A `FaustRemoteHost` on a hub, the DSP's bargraph reported every 10 ms as
 * a node would: level = freq / 2000 + gate + tilt + locked.
 */
const startTypeScriptHost = async (room) => {
    /** @type {any} */
    const hub = new remote.FaustRemoteHub(json);
    const address = (name) => hub.getParams().find((p) => p.endsWith(`/${name}`));
    const level = hub.getMeta().ui[0].items.find((item) => item.label === 'level').address;
    const report = () =>
        hub.output(
            level,
            hub.getParamValue(address('freq')) / 2000 +
                hub.getParamValue(address('gate')) +
                hub.getParamValue(address('tilt')) +
                hub.getParamValue(address('locked'))
        );
    const host = new remote.FaustRemoteHost(hub, { token: TOKEN });
    report();
    const timer = setInterval(report, 10);
    host.acceptRelay(server.hostRoom(room, TOKEN));
    return {
        stop() {
            clearInterval(timer);
            host.close();
        }
    };
};

/** The native host, connected to the relay before this resolves. */
const startNativeHost = async (room) => {
    const child = spawn(program, ['-remote', hostBase, '-remote-room', room, '-remote-token', TOKEN], {
        stdio: ['pipe', 'pipe', 'pipe']
    });
    let log = '';
    await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`the native host did not connect: ${log}`)), 10000);
        child.stderr.on('data', (chunk) => {
            log += chunk;
            if (/connected to/.test(log)) {
                clearTimeout(timer);
                resolve(null);
            }
        });
        child.on('exit', (code) => reject(new Error(`the native host exited with ${code}: ${log}`)));
    });
    child.stdout.resume();
    return {
        child,
        stop: () =>
            new Promise((resolve) => {
                child.removeAllListeners('exit');
                child.on('exit', resolve);
                child.stdin.end();
            })
    };
};

// --------------------------------------------------------- remote controls

/**
 * What a remote control receives, normalized for comparison: the session
 * and the clock readings dropped, numbers to 6 significant digits (the
 * native DSP computes in float), the DSP's JSON replaced by the controls it
 * describes.
 */
const normalize = (message) => {
    const m = JSON.parse(message);
    const round = (x) => (typeof x === 'number' ? Number(x.toPrecision(6)) : x);
    if (m.type === 'welcome') {
        delete m.session;
        if (m.json !== undefined) m.json = controls(JSON.parse(m.json).ui);
        m.values = m.values.map(round);
        m.outputValues = m.outputValues.map(round);
    }
    if (m.type === 'pong') {
        delete m.t1;
        delete m.t2;
    }
    if (m.type === 'sync') m.value = round(m.value);
    if (m.type === 'out') m.values = m.values.map(round);
    return JSON.stringify(m);
};

/** The controls of a Faust UI, with what remote controls read of them. */
const controls = (ui) => {
    const res = [];
    const walk = (items) => {
        for (const item of items) {
            if (item.items) walk(item.items);
            else
                res.push({
                    type: item.type,
                    address: item.address,
                    init: item.init,
                    min: item.min,
                    max: item.max,
                    step: item.step,
                    meta: item.meta ?? []
                });
        }
    };
    walk(ui);
    return res;
};

/** A remote control on the relay, keeping what it receives. */
const connect = async (room) => {
    const transport = await remote.connectRelay(base, room, TOKEN);
    const received = [];
    let closed = false;
    transport.onmessage = (channel, text) => received.push(normalize(text));
    transport.onclose = () => (closed = true);
    return {
        send: (message, channel = 'ctl') => transport.send(channel, JSON.stringify(message)),
        hello: (id, extra = {}) => transport.send('ctl', JSON.stringify({ type: 'hello', v: 1, id, token: TOKEN, mode: 'bi', ...extra })),
        close: () => transport.close(),
        /** What came since the last call, sorted (the order within a step is the hosts' own business). */
        take() {
            const res = received.splice(0).sort();
            if (closed) res.push('<closed>');
            return res;
        }
    };
};

/**
 * Play a scenario against a host: `play(step)` where `step(label, ...remotes)`
 * waits for the hosts to answer and records what each remote control got.
 */
const run = async (startHost, scenario) => {
    const room = `conformance${(rooms += 1)}`;
    const host = await startHost(room);
    const transcript = [];
    const step = async (label, ...remotes) => {
        await settle();
        transcript.push([label, ...remotes.map((r) => r.take())]);
    };
    try {
        await scenario(room, step);
    } finally {
        await host.stop();
    }
    return transcript;
};

/** The same scenario against both hosts: the transcripts must agree. */
const conform = async (scenario) => {
    const expected = await run(startTypeScriptHost, scenario);
    const actual = await run(startNativeHost, scenario);
    assert.deepEqual(actual, expected);
    return expected;
};

// ---------------------------------------------------------------- scenarios

test('the handshake: tokens, versions, modes, and the DSP described alike', { skip, timeout: 30000 }, async () => {
    const transcript = await conform(async (room, step) => {
        const wrong = await connect(room);
        wrong.send({ type: 'hello', v: 1, id: 'w', token: 'guess', mode: 'bi' });
        await step('wrong token', wrong);
        const old = await connect(room);
        old.hello('o', { v: 2 });
        await step('wrong version', old);
        const a = await connect(room);
        a.send({ type: 'param', i: 0, value: 5 });
        a.hello('a');
        await step('welcome', a);
        const u = await connect(room);
        u.hello('u', { mode: 'uni' });
        await step('unidirectional', u);
        a.hello('a');
        a.send({ type: 'ping', s: 3, t0: 12.5 });
        await step('a second hello, a ping', a);
    });
    // Not vacuous: there was something to compare
    const welcome = JSON.parse(transcript[2][1].find((m) => m.includes('"welcome"')));
    assert.ok(welcome.json.length >= 6, 'the welcome describes the controls');
    assert.ok(welcome.outputValues[0] > 0, 'the bargraph was reported');
});

test('writes: held to the range, refused where [remote:off], echoed to the others', { skip, timeout: 30000 }, async () => {
    const transcript = await conform(async (room, step) => {
        const a = await connect(room);
        const b = await connect(room);
        a.hello('a');
        b.hello('b');
        await step('joined', a, b);
        const inputs = inputAddresses();
        const index = (name) => inputs.findIndex((p) => p.endsWith(`/${name}`));
        a.send({ type: 'param', i: index('freq'), value: 1000 });
        await step('a write', a, b);
        a.send({ type: 'param', i: index('count'), value: 50 });
        await step('a write out of range', a, b);
        a.send({ type: 'param', i: index('locked'), value: 1 });
        await step('a write to a [remote:off] control', a, b);
        a.send({ type: 'param', i: 99, value: 1 });
        a.send({ type: 'param', i: index('freq'), value: 300, seq: 5 }, 'stream');
        a.send({ type: 'param', i: index('freq'), value: 200, seq: 4 }, 'stream');
        await step('an index out of range, an older sequence number', a, b);
        a.send({ type: 'acc', x: 5, y: 0, z: 0, invert: false, seq: 1 }, 'stream');
        await step('the accelerometer, through the [acc:] curve', a, b);
        a.send({ type: 'acc', x: 5, y: 0, z: 0, invert: true, seq: 2 }, 'stream');
        await step('the accelerometer of an Android phone', a, b);
    });
    const at = (label) => transcript.find(([name]) => name === label);
    assert.ok(at('a write')[2].some((m) => m.includes('"sync"') && m.includes('1000')));
    assert.ok(at('a write out of range')[1].some((m) => m.includes('"sync"') && m.includes('"value":10')));
    assert.ok(at('a write to a [remote:off] control')[1].some((m) => m.includes('"value":0.5')));
    assert.ok(at('the accelerometer, through the [acc:] curve')[2].some((m) => m.includes('"value":0.75')));
});

test('a remote control that goes releases what it held', { skip, timeout: 30000 }, async () => {
    const transcript = await conform(async (room, step) => {
        const a = await connect(room);
        const b = await connect(room);
        a.hello('a');
        b.hello('b');
        await step('joined', a, b);
        const inputs = inputAddresses();
        const gate = inputs.findIndex((p) => p.endsWith('/gate'));
        a.send({ type: 'param', i: gate, value: 1 });
        await step('gate pressed', a, b);
        a.close();
        await step('the presser gone', b);
        const c = await connect(room);
        c.hello('c');
        await step('a newcomer', c);
        c.send({ type: 'bye' });
        await step('a goodbye', c, b);
    });
    const gone = transcript.find(([name]) => name === 'the presser gone');
    assert.ok(gone[1].some((m) => m.includes('"sync"') && m.includes('"value":0')), 'the gate was released');
});

test('a remote control that comes back replaces its previous session', { skip, timeout: 30000 }, async () => {
    const transcript = await conform(async (room, step) => {
        const first = await connect(room);
        first.hello('same');
        await step('first', first);
        const second = await connect(room);
        second.hello('same');
        await step('second', first, second);
    });
    const [, first, second] = transcript[1];
    assert.ok(first.some((m) => m.includes('"replaced"')) && first.includes('<closed>'));
    assert.ok(second.some((m) => m.includes('"welcome"')));
});

/**
 * The input addresses, in the order of the welcome's `inputs`: those of the
 * libfaust JSON, which the handshake test has checked both hosts agree on.
 */
function inputAddresses() {
    return controls(JSON.parse(json).ui)
        .filter((c) => !c.type.endsWith('bargraph'))
        .map((c) => c.address);
}
