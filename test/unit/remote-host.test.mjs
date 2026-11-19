/**
 * The remote control session, host and remote control joined in memory.
 *
 * The host is put on a fake node that records what it is asked to do, so each
 * test can say exactly what reached the node: which writes, which notes, which
 * sensor readings. What the host owes a node it does not own is the subject --
 * nothing out of range, nothing from a remote control that may not write,
 * nothing left held when a remote control disappears -- and what it owes the
 * remote controls: one consistent view of the parameters, without its own
 * writes thrown back at it. `remote-render.test.mjs` puts the same session on
 * real nodes.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
    FaustRemoteDsp,
    FaustRemoteError,
    FaustRemoteHost,
    PROTOCOL_VERSION,
    createLoopbackTransports
} from '../../dist/remote/index.js';

/** A DSP description: two sliders, one per sensor, a button and a bargraph. */
const describe = (name = 't') => ({
    name,
    filename: `${name}.dsp`,
    compile_options: '',
    include_pathnames: [],
    inputs: 0,
    outputs: 1,
    size: 0,
    version: '2.94.0',
    library_list: [],
    meta: [],
    ui: [
        {
            type: 'vgroup',
            label: name,
            items: [
                {
                    type: 'hslider',
                    label: 'freq',
                    shortname: 'freq',
                    address: `/${name}/freq`,
                    url: '',
                    index: 0,
                    init: 440,
                    min: 20,
                    max: 2000,
                    step: 1
                },
                {
                    type: 'button',
                    label: 'gate',
                    shortname: 'gate',
                    address: `/${name}/gate`,
                    url: '',
                    index: 4
                },
                {
                    type: 'hslider',
                    label: 'tilt',
                    shortname: 'tilt',
                    address: `/${name}/tilt`,
                    url: '',
                    index: 8,
                    init: 0,
                    min: 0,
                    max: 1,
                    step: 0.01,
                    meta: [{ acc: '0 0 -10 0 10' }]
                },
                {
                    type: 'hslider',
                    label: 'turn',
                    shortname: 'turn',
                    address: `/${name}/turn`,
                    url: '',
                    index: 12,
                    init: 0,
                    min: 0,
                    max: 1,
                    step: 0.01,
                    meta: [{ gyr: '0 0 -90 0 90' }]
                },
                {
                    type: 'hbargraph',
                    label: 'level',
                    shortname: 'level',
                    address: `/${name}/level`,
                    index: 16,
                    min: 0,
                    max: 1
                }
            ]
        }
    ]
});
const JSON_TEXT = JSON.stringify(describe());
const FREQ = '/t/freq';
const GATE = '/t/gate';
const LEVEL = '/t/level';

/**
 * The node API the host uses, recording every call.
 *
 * `setParamValue` calls the input handler afterwards with the float32 value,
 * as the DSP does once it has applied a write: that echo is what the host's
 * parameter synchronisation feeds on.
 */
class FakeNode {
    constructor(json = JSON_TEXT) {
        this.json = json;
        this.meta = JSON.parse(json);
        /** @type {Map<string, number>} */
        this.values = new Map([[FREQ, 440]]);
        /** @type {[string, number][]} */
        this.writes = [];
        /** @type {number[][]} */
        this.midi = [];
        /** @type {[number, number, number, boolean][]} */
        this.acc = [];
        /** @type {[number, number, number][]} */
        this.gyr = [];
        this.hasAccInput = true;
        this.hasGyrInput = true;
        this.voices = 0;
        /** @type {((path: string, value: number) => void) | null} */
        this.outputHandler = null;
        /** @type {((path: string, value: number) => void) | null} */
        this.inputHandler = null;
    }
    getJSON() {
        return this.json;
    }
    getMeta() {
        return this.meta;
    }
    /** @param {string} path @param {number} value */
    setParamValue(path, value) {
        this.writes.push([path, value]);
        this.values.set(path, value);
        this.inputHandler?.(path, Math.fround(value));
    }
    /** @param {string} path */
    getParamValue(path) {
        return this.values.get(path) ?? 0;
    }
    setOutputParamHandler(handler) {
        this.outputHandler = handler;
    }
    getOutputParamHandler() {
        return this.outputHandler;
    }
    setInputParamHandler(handler) {
        this.inputHandler = handler;
    }
    getInputParamHandler() {
        return this.inputHandler;
    }
    /** @param {number[] | Uint8Array} data */
    midiMessage(data) {
        this.midi.push(Array.from(data));
    }
    propagateAcc({ x, y, z }, invert) {
        this.acc.push([x, y, z, invert]);
    }
    propagateGyr({ alpha, beta, gamma }) {
        this.gyr.push([alpha, beta, gamma]);
    }
    getNumActiveVoices() {
        return this.voices;
    }
    /** A bargraph tick, as the DSP produces one every few blocks. */
    emit(path, value) {
        this.outputHandler?.(path, value);
    }
    /** The writes that reached a path, in order. */
    writesTo(path) {
        return this.writes.filter(([p]) => p === path).map(([, v]) => v);
    }
}

/** Let queued deliveries happen, and anything they queue in turn. */
const settle = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

/** Hosts and remote controls to close after each test, timers and all. */
const toClose = [];
afterEach(() => {
    for (const thing of toClose.splice(0)) thing.close();
});

/**
 * A host on a fake node.
 *
 * `outputRate` is lifted out of the way: rate limiting is real-time, and only
 * the tests about it want it.
 *
 * @param {import('../../dist/remote/index.js').FaustRemoteHostOptions} [options]
 */
const makeHost = (options = {}, node = new FakeNode()) => {
    const host = new FaustRemoteHost(node, { outputRate: 1e6, ...options });
    toClose.push(host);
    return { host, node };
};

/**
 * A remote control connected to a host.
 *
 * @param {FaustRemoteHost} host
 * @param {import('../../dist/remote/index.js').FaustRemoteDspOptions} [options]
 * @param {import('../../dist/remote/index.js').FaustLoopbackOptions} [loopback]
 */
const connect = async (host, options = {}, loopback = {}) => {
    const [hostEnd, remoteEnd] = createLoopbackTransports(loopback);
    host.accept(hostEnd);
    const dsp = await FaustRemoteDsp.connect(remoteEnd, {
        pingInterval: 0,
        gestureEnd: 0,
        ...options
    });
    toClose.push(dsp);
    return { dsp, hostEnd, remoteEnd };
};

/**
 * A remote control speaking raw protocol, to send what `FaustRemoteDsp`
 * never would.
 *
 * @param {FaustRemoteHost} host
 */
const rawClient = (host, loopback = {}) => {
    const [hostEnd, remoteEnd] = createLoopbackTransports(loopback);
    host.accept(hostEnd);
    /** @type {any[]} */
    const received = [];
    let closed = false;
    remoteEnd.onmessage = (channel, text) => received.push(JSON.parse(text));
    remoteEnd.onclose = () => (closed = true);
    return {
        received,
        get closed() {
            return closed;
        },
        /** @param {object} message @param {'ctl' | 'stream'} [channel] */
        send: (message, channel = 'ctl') =>
            remoteEnd.send(channel, JSON.stringify(message)),
        sendText: (text) => remoteEnd.send('ctl', text),
        close: () => remoteEnd.close(),
        /** Say hello and wait for the answer. */
        async hello(fields = {}) {
            remoteEnd.send(
                'ctl',
                JSON.stringify({
                    type: 'hello',
                    v: PROTOCOL_VERSION,
                    id: 'raw',
                    mode: 'bi',
                    ...fields
                })
            );
            await settle();
            return received.find(
                (m) => m.type === 'welcome' || m.type === 'reject'
            );
        }
    };
};

/** Record what a remote control's handlers are called with. */
const watch = (dsp) => {
    /** @type {[string, number][]} */
    const outputs = [];
    /** @type {[string, number][]} */
    const inputs = [];
    dsp.setOutputParamHandler((path, value) => outputs.push([path, value]));
    dsp.setInputParamHandler((path, value) => inputs.push([path, value]));
    return { outputs, inputs };
};

// ---------------------------------------------------------------- handshake

test('the welcome gives the DSP, its controls and their current values', async () => {
    const { host, node } = makeHost();
    node.values.set(FREQ, 660);
    const { dsp } = await connect(host);

    assert.equal(dsp.state, 'open');
    assert.equal(dsp.mode, 'bi');
    assert.equal(dsp.getJSON(), JSON_TEXT);
    assert.deepEqual(dsp.getParams(), [FREQ, GATE, '/t/tilt', '/t/turn']);
    assert.equal(dsp.getParamValue(FREQ), 660);
    // A short name stands for its address, as on a node
    assert.equal(dsp.getParamValue('freq'), 660);
    assert.equal(dsp.hasAccInput, true);
    assert.equal(dsp.hasGyrInput, true);
    assert.deepEqual(
        host.clients.map((client) => client.mode),
        ['bi']
    );
});

test('a wrong token is refused, and the connection closed', async () => {
    const { host } = makeHost({ token: 'secret' });
    const [hostEnd, remoteEnd] = createLoopbackTransports();
    host.accept(hostEnd);
    await assert.rejects(
        FaustRemoteDsp.connect(remoteEnd, { token: 'guess', pingInterval: 0 }),
        (error) => error instanceof FaustRemoteError && error.code === 'token'
    );
    assert.deepEqual(host.clients, []);

    const { dsp } = await connect(host, { token: 'secret' });
    assert.equal(dsp.state, 'open');
});

test('another protocol version is refused', async () => {
    const { host } = makeHost();
    const raw = rawClient(host);
    const answer = await raw.hello({ v: PROTOCOL_VERSION + 1 });
    assert.equal(answer.type, 'reject');
    assert.equal(answer.code, 'version');
    await settle();
    assert.equal(raw.closed, true);
});

test('a host that is full refuses the next remote control', async () => {
    const { host } = makeHost({ maxClients: 1 });
    await connect(host, { id: 'a' });
    const [hostEnd, remoteEnd] = createLoopbackTransports();
    host.accept(hostEnd);
    await assert.rejects(
        FaustRemoteDsp.connect(remoteEnd, { id: 'b', pingInterval: 0 }),
        (error) => error instanceof FaustRemoteError && error.code === 'full'
    );
});

test('a remote control built for another DSP is refused', async () => {
    const { host } = makeHost();
    const [hostEnd, remoteEnd] = createLoopbackTransports();
    host.accept(hostEnd);
    await assert.rejects(
        FaustRemoteDsp.connect(remoteEnd, {
            json: JSON.stringify(describe('other')),
            pingInterval: 0
        }),
        (error) =>
            error instanceof FaustRemoteError && error.code === 'dsp-mismatch'
    );
    // The same DSP is accepted
    const { dsp } = await connect(host, { json: JSON_TEXT });
    assert.equal(dsp.state, 'open');
});

test('a welcome larger than one message arrives in chunks', async () => {
    const { host } = makeHost();
    const sizes = [];
    const { dsp } = await connect(
        host,
        {},
        {
            maxMessageSize: 512,
            deliver: (channel, message) => {
                sizes.push(new TextEncoder().encode(message).length);
                return true;
            }
        }
    );
    assert.ok(JSON_TEXT.length > 512, 'the test needs a JSON over the limit');
    assert.equal(dsp.getJSON(), JSON_TEXT);
    assert.ok(sizes.every((size) => size <= 512), `sizes ${sizes}`);
});

test('a remote control coming back replaces its previous session', async () => {
    const { host, node } = makeHost();
    const first = await connect(host, { id: 'phone' });
    first.dsp.setParamValue(GATE, 1);
    await settle();
    const second = await connect(host, { id: 'phone' });
    await settle();
    assert.equal(first.dsp.state, 'closed');
    assert.equal(second.dsp.state, 'open');
    assert.deepEqual(host.clients.map((client) => client.id), ['phone']);
    // What the old session held is released
    assert.deepEqual(node.writesTo(GATE), [1, 0]);
});

test('a host in unidirectional mode imposes it and stays silent', async () => {
    const { host, node } = makeHost({ mode: 'uni' });
    const [hostEnd, remoteEnd] = createLoopbackTransports();
    host.accept(hostEnd);
    // Without the JSON, a remote control has nothing to build its UI from
    await assert.rejects(
        FaustRemoteDsp.connect(remoteEnd, { pingInterval: 0 }),
        (error) => error instanceof FaustRemoteError && error.code === 'no-json'
    );

    const { dsp } = await connect(host, { json: JSON_TEXT });
    assert.equal(dsp.mode, 'uni');
    const { outputs, inputs } = watch(dsp);
    node.emit(LEVEL, 0.5);
    node.setParamValue(FREQ, 1000);
    await settle();
    assert.deepEqual(outputs, []);
    assert.deepEqual(inputs, []);
    // Writes still go through
    dsp.setParamValue(FREQ, 880);
    await settle();
    assert.deepEqual(node.writesTo(FREQ), [1000, 880]);
});

// ------------------------------------------------------------ writes, held

test('a write reaches the node, held to the control range', async () => {
    const { host, node } = makeHost();
    const { dsp } = await connect(host);
    dsp.setParamValue(FREQ, 880);
    dsp.setParamValue(FREQ, 99999);
    dsp.setParamValue('freq', 1);
    dsp.setParamValue(GATE, 5);
    await settle();
    assert.deepEqual(node.writesTo(FREQ), [880, 2000, 20]);
    assert.deepEqual(node.writesTo(GATE), [1]);
});

test('what the host may not accept does not reach the node', async () => {
    const { host, node } = makeHost();
    const raw = rawClient(host);
    await raw.hello();
    raw.sendText('not json');
    raw.send({ type: 'param', i: 99, value: 1 });
    raw.send({ type: 'param', i: -1, value: 1 });
    raw.send({ type: 'param', i: 0, value: null });
    raw.send({ type: 'param', i: 0, value: '440' });
    raw.send({ type: 'midi', data: [0xf0, 0x7e, 0xf7] });
    raw.send({ type: 'midi', data: [0x90, 200, 1] });
    raw.send({ type: 'unknown' });
    await settle();
    assert.deepEqual(node.writes, []);
    assert.deepEqual(node.midi, []);
    // None of it closed the session
    raw.send({ type: 'param', i: 0, value: 500 });
    await settle();
    assert.deepEqual(node.writesTo(FREQ), [500]);
});

test('nothing is accepted before the handshake', async () => {
    const { host, node } = makeHost();
    const raw = rawClient(host);
    raw.send({ type: 'param', i: 0, value: 500 });
    await settle();
    assert.deepEqual(node.writes, []);
});

test('an older write that arrives late is dropped; an equal one is not', async () => {
    const { host, node } = makeHost();
    const raw = rawClient(host);
    await raw.hello();
    raw.send({ type: 'param', i: 0, value: 500, seq: 5 }, 'stream');
    raw.send({ type: 'param', i: 0, value: 300, seq: 4 }, 'stream');
    // The last value of a gesture, again, on the reliable channel
    raw.send({ type: 'param', i: 0, value: 500, seq: 5 });
    // Sequence numbers are per control
    raw.send({ type: 'param', i: 2, value: 0.5, seq: 3 }, 'stream');
    await settle();
    assert.deepEqual(node.writesTo(FREQ), [500, 500]);
    assert.deepEqual(node.writesTo('/t/tilt'), [0.5]);
});

test('the last value of a gesture arrives even if the stream drops it', async () => {
    const { host, node } = makeHost();
    const { dsp } = await connect(
        host,
        { gestureEnd: 20 },
        // The unreliable channel loses the last value of the gesture
        {
            deliver: (channel, message) =>
                !(channel === 'stream' && JSON.parse(message).value === 800)
        }
    );
    dsp.setParamValue(FREQ, 600);
    dsp.setParamValue(FREQ, 700);
    dsp.setParamValue(FREQ, 800);
    await settle();
    assert.deepEqual(node.writesTo(FREQ), [600, 700]);
    // Sent again reliably, under a sequence number the host still accepts
    // after the ones it has applied
    await settle(60);
    assert.deepEqual(node.writesTo(FREQ), [600, 700, 800]);
});

test('a button is never sent on the unreliable channel', async () => {
    const { host, node } = makeHost();
    const { dsp } = await connect(
        host,
        { gestureEnd: 20 },
        { deliver: (channel, message, from) => !(channel === 'stream' && from === 1) }
    );
    dsp.setParamValue(GATE, 1);
    dsp.setParamValue(GATE, 0);
    await settle();
    assert.deepEqual(node.writesTo(GATE), [1, 0]);
});

test('a remote control may write only what is exposed and assigned to it', async () => {
    const { host, node } = makeHost({
        expose: (path) => path !== '/t/turn',
        assign: (client) => (path) =>
            client.id === 'a' ? path === FREQ : path !== FREQ
    });
    const a = await connect(host, { id: 'a' });
    const b = await connect(host, { id: 'b' });
    a.dsp.setParamValue(FREQ, 500);
    a.dsp.setParamValue(GATE, 1);
    b.dsp.setParamValue(FREQ, 600);
    b.dsp.setParamValue(GATE, 1);
    b.dsp.setParamValue('/t/turn', 0.5);
    await settle();
    assert.deepEqual(node.writesTo(FREQ), [500]);
    assert.deepEqual(node.writesTo(GATE), [1]);
    assert.deepEqual(node.writesTo('/t/turn'), []);
});

test('in exclusive mode only the first remote control writes, until it leaves', async () => {
    const { host, node } = makeHost({ policy: 'exclusive' });
    const a = await connect(host, { id: 'a' });
    const b = await connect(host, { id: 'b' });
    b.dsp.setParamValue(FREQ, 600);
    b.dsp.keyOn(0, 60, 100);
    await settle();
    assert.deepEqual(node.writes, []);
    assert.deepEqual(node.midi, []);
    a.dsp.close();
    await settle();
    b.dsp.setParamValue(FREQ, 700);
    await settle();
    assert.deepEqual(node.writesTo(FREQ), [700]);
});

test('messages past the rate limit are dropped', async () => {
    const { host, node } = makeHost({ maxMessageRate: 5 });
    const raw = rawClient(host);
    await raw.hello();
    for (let n = 0; n < 10; n += 1)
        raw.send({ type: 'param', i: 0, value: 100 + n });
    await settle();
    // The hello was the first of the five
    assert.deepEqual(node.writesTo(FREQ), [100, 101, 102, 103]);
});

// ----------------------------------------------------- releasing on leave

/** @type {[string, (session: any) => void][]} */
const LEAVINGS = [
    ['says goodbye', ({ dsp }) => dsp.close()],
    ['loses its connection', ({ remoteEnd }) => remoteEnd.close()]
];
for (const [how, leave] of LEAVINGS) {
    test(`a remote control that ${how} releases its buttons and notes`, async () => {
        const { host, node } = makeHost();
        const session = await connect(host);
        session.dsp.setParamValue(GATE, 1);
        session.dsp.keyOn(0, 60, 100);
        session.dsp.keyOn(1, 64, 100);
        session.dsp.keyOff(0, 60, 0);
        await settle();
        leave(session);
        await settle();
        assert.deepEqual(node.writesTo(GATE), [1, 0]);
        assert.deepEqual(node.midi.slice(3), [[0x81, 64, 0]]);
        assert.deepEqual(host.clients, []);
    });
}

test('a silent remote control is dropped and releases what it held', async () => {
    const { host, node } = makeHost({ livenessTimeout: 100 });
    const left = [];
    host.addEventListener('leave', (event) =>
        left.push(/** @type {CustomEvent} */ (event).detail.id)
    );
    const { dsp } = await connect(host, { id: 'quiet' });
    dsp.setParamValue(GATE, 1);
    await settle(300);
    assert.deepEqual(left, ['quiet']);
    assert.deepEqual(node.writesTo(GATE), [1, 0]);
    assert.equal(dsp.state, 'closed');
});

test('pings keep a remote control alive, and measure the round trip', async () => {
    const { host } = makeHost({ livenessTimeout: 100 });
    const { dsp } = await connect(host, { pingInterval: 20 });
    await settle(300);
    assert.equal(dsp.state, 'open');
    assert.ok(Number.isFinite(dsp.rtt) && dsp.rtt >= 0, `rtt ${dsp.rtt}`);
});

test('a button another remote control still holds is not released', async () => {
    const { host, node } = makeHost();
    const a = await connect(host, { id: 'a' });
    const b = await connect(host, { id: 'b' });
    a.dsp.setParamValue(GATE, 1);
    b.dsp.setParamValue(GATE, 1);
    await settle();
    a.dsp.close();
    await settle();
    assert.deepEqual(node.writesTo(GATE), [1, 1]);
    b.dsp.close();
    await settle();
    assert.deepEqual(node.writesTo(GATE), [1, 1, 0]);
});

test('MIDI All Notes Off forgets the notes of its channel', async () => {
    const { host, node } = makeHost();
    const { dsp } = await connect(host);
    dsp.keyOn(0, 60, 100);
    dsp.keyOn(1, 62, 100);
    dsp.ctrlChange(0, 123, 0);
    await settle();
    dsp.close();
    await settle();
    assert.deepEqual(node.midi.slice(3), [[0x81, 62, 0]]);
});

// ---------------------------------------------------------------- sensors

test('sensor readings reach the node raw, with the remote device platform', async () => {
    const { host, node } = makeHost();
    const { dsp } = await connect(host);
    dsp.propagateAcc({ x: 1, y: 2, z: 3 }, true);
    // Below the threshold: not worth sending
    dsp.propagateAcc({ x: 1.001, y: 2, z: 3 }, true);
    dsp.propagateAcc({ x: 4, y: 5, z: 6 }, false);
    dsp.propagateGyr({ alpha: 10, beta: 20, gamma: 30 });
    await settle();
    assert.deepEqual(node.acc, [
        [1, 2, 3, true],
        [4, 5, 6, false]
    ]);
    assert.deepEqual(node.gyr, [[10, 20, 30]]);
});

test('sensor readings are ignored by a node without sensor controls', async () => {
    const { host, node } = makeHost();
    node.hasAccInput = false;
    node.hasGyrInput = false;
    const raw = rawClient(host);
    await raw.hello();
    raw.send({ type: 'acc', x: 1, y: 2, z: 3, invert: false }, 'stream');
    raw.send({ type: 'gyr', alpha: 1, beta: 2, gamma: 3 }, 'stream');
    await settle();
    assert.deepEqual(node.acc, []);
    assert.deepEqual(node.gyr, []);
});

// ---------------------------------------------------------- what comes back

test('bargraphs reach the remote control, small changes left out', async () => {
    const { host, node } = makeHost();
    const { dsp } = await connect(host);
    const { outputs } = watch(dsp);
    node.emit(LEVEL, 0.5);
    await settle();
    // Under 0.1 % of the bargraph's range
    node.emit(LEVEL, 0.5004);
    await settle();
    node.emit(LEVEL, 0.6);
    await settle();
    assert.deepEqual(outputs, [
        [LEVEL, 0.5],
        [LEVEL, 0.6]
    ]);
    assert.equal(dsp.getOutputValue(LEVEL), 0.6);
});

test('bargraphs are sent no faster than the output rate', async () => {
    const { host, node } = makeHost({ outputRate: 20 });
    const { dsp } = await connect(host);
    const { outputs } = watch(dsp);
    node.emit(LEVEL, 0.1);
    node.emit(LEVEL, 0.2);
    await settle();
    assert.deepEqual(outputs, [[LEVEL, 0.1]]);
    await settle(70);
    node.emit(LEVEL, 0.3);
    await settle();
    assert.deepEqual(outputs, [
        [LEVEL, 0.1],
        [LEVEL, 0.3]
    ]);
});

test('a remote control joining later gets the last bargraph values', async () => {
    const { host, node } = makeHost();
    node.emit(LEVEL, 0.7);
    const { dsp } = await connect(host);
    assert.equal(dsp.getOutputValue(LEVEL), 0.7);
});

test('a write is shown to the other remote controls, not echoed to its writer', async () => {
    const { host, node } = makeHost();
    const a = await connect(host, { id: 'a' });
    const b = await connect(host, { id: 'b' });
    const seenByA = watch(a.dsp);
    const seenByB = watch(b.dsp);
    a.dsp.setParamValue(FREQ, 880);
    await settle();
    assert.deepEqual(seenByA.inputs, []);
    assert.deepEqual(seenByB.inputs, [[FREQ, 880]]);
    assert.equal(b.dsp.getParamValue(FREQ), 880);

    // A change made on the host itself reaches everyone
    node.setParamValue(FREQ, 1000);
    await settle();
    assert.deepEqual(seenByA.inputs, [[FREQ, 1000]]);
    assert.deepEqual(seenByB.inputs, [
        [FREQ, 880],
        [FREQ, 1000]
    ]);
});

test('a value the host clamped comes back to correct its writer', async () => {
    const { host } = makeHost();
    const { dsp } = await connect(host);
    const { inputs } = watch(dsp);
    dsp.setParamValue(FREQ, 5000);
    await settle();
    assert.deepEqual(inputs, [[FREQ, 2000]]);
    assert.equal(dsp.getParamValue(FREQ), 2000);
});

// ------------------------------------------------------------ the host's end

test('the host chains the handlers the page had, and gives them back', async () => {
    const node = new FakeNode();
    const pageOutputs = [];
    const pageInputs = [];
    const pageOutput = (path, value) => pageOutputs.push([path, value]);
    const pageInput = (path, value) => pageInputs.push([path, value]);
    node.setOutputParamHandler(pageOutput);
    node.setInputParamHandler(pageInput);
    const { host } = makeHost({}, node);
    const { dsp } = await connect(host);
    const { outputs } = watch(dsp);

    node.emit(LEVEL, 0.25);
    dsp.setParamValue(FREQ, 500);
    await settle();
    assert.deepEqual(pageOutputs, [[LEVEL, 0.25]]);
    assert.deepEqual(pageInputs, [[FREQ, 500]]);
    assert.deepEqual(outputs, [[LEVEL, 0.25]]);

    host.close();
    await settle();
    assert.equal(node.getOutputParamHandler(), pageOutput);
    assert.equal(node.getInputParamHandler(), pageInput);
    assert.equal(dsp.state, 'closed');
});

test('closing the host releases what every remote control held', async () => {
    const { host, node } = makeHost();
    const { dsp } = await connect(host);
    dsp.setParamValue(GATE, 1);
    dsp.keyOn(0, 60, 100);
    await settle();
    host.close();
    await settle();
    assert.deepEqual(node.writesTo(GATE), [1, 0]);
    assert.deepEqual(node.midi, [
        [0x90, 60, 100],
        [0x80, 60, 0]
    ]);
    // And takes no one else
    const [hostEnd, remoteEnd] = createLoopbackTransports();
    host.accept(hostEnd);
    await assert.rejects(
        FaustRemoteDsp.connect(remoteEnd, { pingInterval: 0 }),
        (error) => error instanceof FaustRemoteError && error.code === 'closed'
    );
});
