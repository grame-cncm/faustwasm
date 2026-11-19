/**
 * A remote control that plays the DSP itself: FaustLocalSound.
 *
 * The bridge between a local node and a FaustRemoteDsp has one job: the
 * local node must sound what the user does at once, and follow what is done
 * elsewhere, without the two fighting. Checked on fake nodes, one for the
 * host and one for the phone, recording what reaches them;
 * `remote-render.test.mjs` hears it on real nodes.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
    FaustLocalSound,
    FaustRemoteDsp,
    FaustRemoteHost,
    createLoopbackTransports
} from '../../dist/remote/index.js';
import { FREQ, GATE, LEVEL, JSON_TEXT, FakeNode, describe } from './remote-fakes.mjs';

const TILT = '/t/tilt';
const settle = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

const toClose = [];
afterEach(() => {
    for (const thing of toClose.splice(0)) thing.close();
});

/**
 * A host on a fake node, a remote control, and a local fake node bridged to
 * it; the UI's handlers record what it would show.
 */
const session = async (hostOptions = {}, json = JSON_TEXT, id = 'phone') => {
    const hostNode = new FakeNode(json);
    const host = new FaustRemoteHost(hostNode, { outputRate: 1e6, ...hostOptions });
    toClose.push(host);
    const [hostEnd, remoteEnd] = createLoopbackTransports();
    host.accept(hostEnd);
    const dsp = await FaustRemoteDsp.connect(remoteEnd, { id, pingInterval: 0, gestureEnd: 0 });
    toClose.push(dsp);
    const localNode = new FakeNode(json);
    localNode.values.clear();
    const control = new FaustLocalSound(dsp, localNode);
    toClose.push(control);
    /** @type {[string, number][]} */
    const shown = [];
    /** @type {[string, number][]} */
    const meters = [];
    control.setInputParamHandler((path, value) => shown.push([path, value]));
    control.setOutputParamHandler((path, value) => meters.push([path, value]));
    await settle();
    return { host, hostNode, dsp, localNode, control, shown, meters };
};

test('the local node starts from the host state', async () => {
    const { localNode } = await session();
    assert.equal(localNode.getParamValue(FREQ), 440);
    assert.equal(localNode.getParamValue(GATE), 0);
});

test('a change made here is heard at once, and reaches the host', async () => {
    const { hostNode, localNode, control } = await session();
    control.setParamValue('freq', 880);
    // Before any message could have travelled
    assert.equal(localNode.getParamValue(FREQ), 880);
    assert.deepEqual(hostNode.writesTo(FREQ), []);
    await settle();
    assert.deepEqual(hostNode.writesTo(FREQ), [880]);
    assert.equal(control.getParamValue('freq'), 880);
});

test('a change made elsewhere reaches the local node, and the UI', async () => {
    const { hostNode, localNode, shown } = await session();
    hostNode.setParamValue(FREQ, 1000);
    await settle();
    assert.equal(localNode.getParamValue(FREQ), 1000);
    assert.deepEqual(shown.at(-1), [FREQ, 1000]);
});

test('bargraphs come from the local node, not the host', async () => {
    const { hostNode, localNode, meters } = await session();
    hostNode.emit(LEVEL, 0.9);
    await settle();
    assert.deepEqual(meters, []);
    localNode.emit(LEVEL, 0.3);
    assert.deepEqual(meters, [[LEVEL, 0.3]]);
});

test('a refused change is undone on the local node', async () => {
    const meta = /** @type {any} */ (describe());
    meta.ui[0].items[0].meta = [{ remote: 'off' }];
    const { hostNode, localNode, control } = await session({}, JSON.stringify(meta));
    control.setParamValue(FREQ, 880);
    await settle();
    assert.deepEqual(hostNode.writesTo(FREQ), []);
    assert.equal(localNode.getParamValue(FREQ), 440);
});

test('under the shared policy, this phone drives its sensor controls here', async () => {
    const { hostNode, localNode, control } = await session();
    // The DSP's curve: -10, 0, 10 onto min, init, max
    control.propagateAcc({ x: 5, y: 0, z: 0 }, false);
    assert.equal(localNode.getParamValue(TILT), 0.5, 'heard at once');
    await settle();
    assert.deepEqual(hostNode.acc, [[5, 0, 0, false]], 'and sent');
    // From now on the control is this phone's here: what comes back for it
    // does not fight its gesture
    hostNode.setParamValue(TILT, 0.9);
    await settle();
    assert.equal(localNode.getParamValue(TILT), 0.5);
});

test('under the mean policy, the local node follows the host for sensor controls', async () => {
    const { hostNode, localNode, control } = await session({ sensorPolicy: 'mean' });
    control.propagateAcc({ x: 5, y: 0, z: 0 }, false);
    assert.equal(localNode.getParamValue(TILT), 0, 'not driven here');
    await settle();
    assert.equal(hostNode.acc.length, 1, 'sent');
    // The mean, as the host applies it, comes back
    hostNode.setParamValue(TILT, 0.3);
    await settle();
    // Through the DSP's float32, as the fake node imitates
    assert.equal(localNode.getParamValue(TILT), Math.fround(0.3));
});

test('with groups, this phone drives its own group here and follows the others', async () => {
    const meta = /** @type {any} */ (describe('d'));
    meta.ui[0].items = ['p1', 'p2'].map((player) => ({
        type: 'hgroup',
        label: player,
        items: [
            {
                type: 'hslider',
                label: 'tilt',
                shortname: 'tilt',
                address: `/d/${player}/tilt`,
                url: '',
                index: 0,
                init: 0,
                min: 0,
                max: 1,
                step: 0.01,
                meta: [{ acc: '0 0 -10 0 10' }]
            }
        ]
    }));
    const { dsp, hostNode, localNode, control } = await session(
        { assign: 'groups', sensorPolicy: 'assigned' },
        JSON.stringify(meta)
    );
    assert.equal(dsp.group, 'p1');
    control.propagateAcc({ x: 5, y: 0, z: 0 }, false);
    assert.equal(localNode.getParamValue('/d/p1/tilt'), 0.5);
    assert.equal(localNode.getParamValue('/d/p2/tilt'), 0);
    // Another player's tilt, as the host applies it, comes back
    hostNode.setParamValue('/d/p2/tilt', 0.7);
    await settle();
    assert.equal(localNode.getParamValue('/d/p2/tilt'), Math.fround(0.7));
});

test('closed, the bridge no longer drives the local node', async () => {
    const { hostNode, localNode, control } = await session();
    control.close();
    hostNode.setParamValue(FREQ, 1000);
    await settle();
    assert.equal(localNode.getParamValue(FREQ), 440);
});
