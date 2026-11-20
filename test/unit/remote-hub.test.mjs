/**
 * FaustRemoteHub: a host target without a DSP, for a DSP that runs where the
 * host cannot reach it as a node (a Max patch). Checked on its own, then
 * behind a real FaustRemoteHost with remote controls over loopback
 * transports: what they write must reach `onwrite`, what the patch changes
 * must reach them, and neither may come back where it came from.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
    FaustRemoteDsp,
    FaustRemoteHost,
    FaustRemoteHub,
    createLoopbackTransports
} from '../../dist/remote/index.js';
import { FREQ, GATE, LEVEL, JSON_TEXT, describe } from './remote-fakes.mjs';

const TILT = '/t/tilt';
const TURN = '/t/turn';
const settle = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

const toClose = [];
afterEach(() => {
    for (const thing of toClose.splice(0)) thing.close();
});

/** A hub recording what it forwards, and what its handlers report. */
const recordingHub = (json = JSON_TEXT) => {
    /** @type {[string, number][]} */
    const writes = [];
    /** @type {number[][]} */
    const midi = [];
    const hub = new FaustRemoteHub(json, {
        onwrite: (path, value) => writes.push([path, value]),
        onmidi: (data) => midi.push(data)
    });
    toClose.push(hub);
    /** @type {[string, number][]} */
    const inputs = [];
    /** @type {[string, number][]} */
    const outputs = [];
    hub.setInputParamHandler((path, value) => inputs.push([path, value]));
    hub.setOutputParamHandler((path, value) => outputs.push([path, value]));
    return { hub, writes, midi, inputs, outputs };
};

test('a hub starts from the init values of the JSON', () => {
    const { hub } = recordingHub();
    assert.equal(hub.getJSON(), JSON_TEXT);
    assert.deepEqual(hub.getParams(), [FREQ, GATE, TILT, TURN]);
    assert.equal(hub.getParamValue(FREQ), 440);
    assert.equal(hub.getParamValue(GATE), 0);
    assert.equal(hub.hasAccInput, true);
    assert.equal(hub.hasGyrInput, true);
});

test('a write is stored, forwarded, then reported as a node reports its changes', () => {
    const { hub, writes, inputs } = recordingHub();
    hub.setParamValue(FREQ, 880);
    assert.equal(hub.getParamValue(FREQ), 880);
    assert.deepEqual(writes, [[FREQ, 880]]);
    assert.deepEqual(inputs, [[FREQ, 880]]);
});

test('a change made where the DSP runs is reported, not forwarded back', () => {
    const { hub, writes, inputs } = recordingHub();
    hub.update(FREQ, 660);
    assert.equal(hub.getParamValue(FREQ), 660);
    assert.deepEqual(writes, []);
    assert.deepEqual(inputs, [[FREQ, 660]]);
});

test('a bargraph value goes to the output handler', () => {
    const { hub, outputs, inputs } = recordingHub();
    hub.output(LEVEL, 0.25);
    assert.deepEqual(outputs, [[LEVEL, 0.25]]);
    assert.deepEqual(inputs, []);
});

test('unknown paths and values that are not finite numbers are ignored', () => {
    const { hub, writes, inputs, outputs } = recordingHub();
    hub.setParamValue('/t/nope', 1);
    hub.setParamValue(FREQ, NaN);
    hub.update(FREQ, Infinity);
    hub.output(LEVEL, NaN);
    assert.deepEqual([writes, inputs, outputs], [[], [], []]);
    assert.equal(hub.getParamValue(FREQ), 440);
});

test('sensor readings are mapped with the DSP curves', () => {
    const { hub, writes } = recordingHub();
    // -10, 0, 10 onto min, init, max
    hub.propagateAcc({ x: 5, y: 0, z: 0 });
    assert.equal(hub.getParamValue(TILT), 0.5);
    // Android's opposite sign
    hub.propagateAcc({ x: -5, y: 0, z: 0 }, true);
    assert.equal(hub.getParamValue(TILT), 0.5);
    hub.propagateGyr({ alpha: 45, beta: 0, gamma: 0 });
    assert.equal(hub.getParamValue(TURN), 0.5);
    assert.deepEqual(writes, [
        [TILT, 0.5],
        [TILT, 0.5],
        [TURN, 0.5]
    ]);
    // A missing axis drives nothing
    hub.propagateAcc({ x: null, y: 0, z: 0 });
    assert.equal(writes.length, 3);
});

test('sensors never drive a [remote:off] control', () => {
    const meta = /** @type {any} */ (describe());
    meta.ui[0].items[2].meta = [{ acc: '0 0 -10 0 10' }, { remote: 'off' }];
    const { hub, writes } = recordingHub(JSON.stringify(meta));
    assert.equal(hub.hasAccInput, false);
    hub.propagateAcc({ x: 5, y: 0, z: 0 });
    assert.deepEqual(writes, []);
});

test('a timestamped write waits for its time; close cancels the ones waiting', async () => {
    const { hub, writes } = recordingHub();
    hub.setParamValue(FREQ, 500, hub.context.currentTime + 0.05);
    assert.deepEqual(writes, []);
    await settle(80);
    assert.deepEqual(writes, [[FREQ, 500]]);
    hub.setParamValue(FREQ, 600, hub.context.currentTime + 0.05);
    hub.close();
    await settle(80);
    assert.equal(hub.getParamValue(FREQ), 500);
});

test('MIDI is handed to onmidi as an array', () => {
    const { hub, midi } = recordingHub();
    hub.midiMessage(new Uint8Array([0x90, 60, 100]));
    assert.deepEqual(midi, [[0x90, 60, 100]]);
});

// ------------------------------------------------------------ behind a host

/** A host on a recording hub, and remote controls connected to it. */
const session = async (count = 1, hostOptions = {}) => {
    const recorded = recordingHub();
    const host = new FaustRemoteHost(recorded.hub, { outputRate: 1e6, ...hostOptions });
    toClose.push(host);
    const remotes = [];
    for (let n = 0; n < count; n++) {
        const [hostEnd, remoteEnd] = createLoopbackTransports();
        host.accept(hostEnd);
        const dsp = await FaustRemoteDsp.connect(remoteEnd, {
            id: `phone${n}`,
            pingInterval: 0,
            gestureEnd: 0
        });
        toClose.push(dsp);
        remotes.push(dsp);
    }
    return { ...recorded, host, remotes };
};

test('behind a host, a remote control write is forwarded once', async () => {
    const { remotes, writes } = await session();
    remotes[0].setParamValue(FREQ, 880);
    await settle(10);
    assert.deepEqual(writes, [[FREQ, 880]]);
});

test('behind a host, a write by one remote control reaches the other', async () => {
    const { remotes } = await session(2);
    remotes[0].setParamValue(FREQ, 990);
    await settle(10);
    assert.equal(remotes[1].getParamValue(FREQ), 990);
});

test('behind a host, a change made in the patch reaches the remote controls', async () => {
    const { hub, remotes, writes } = await session();
    hub.update(FREQ, 330);
    await settle(10);
    assert.equal(remotes[0].getParamValue(FREQ), 330);
    assert.deepEqual(writes, [], 'not sent back to the patch');
});

test('behind a host, bargraphs computed in the patch reach the remote controls', async () => {
    const { hub, remotes } = await session();
    /** @type {[string, number][]} */
    const meters = [];
    remotes[0].setOutputParamHandler((path, value) => meters.push([path, value]));
    hub.output(LEVEL, 0.75);
    await settle(10);
    assert.deepEqual(meters.at(-1), [LEVEL, 0.75]);
});

test('behind a host, a remote control sensor reading drives the patch', async () => {
    const { remotes, writes } = await session();
    remotes[0].propagateAcc({ x: 5, y: 0, z: 0 }, false);
    await settle(10);
    assert.deepEqual(writes, [[TILT, 0.5]]);
});

test('behind a host, a button held by a remote control that drops is released in the patch', async () => {
    const { remotes, writes } = await session();
    remotes[0].setParamValue(GATE, 1);
    await settle(10);
    remotes[0].close();
    await settle(10);
    assert.deepEqual(writes, [
        [GATE, 1],
        [GATE, 0]
    ]);
});
