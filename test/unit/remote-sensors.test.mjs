/**
 * The sensors of several remote controls.
 *
 * A node applies every `[acc:]`/`[gyr:]` mapping at once, so by default the
 * phones all drive the same controls and the latest reading wins. The host's
 * `sensorPolicy` offers two other ways: `mean`, where the controls follow
 * the mean of the phones' latest readings, and `assigned`, where each phone
 * drives only the controls it may write, mapped by the host itself. With
 * `assign: 'groups'`, each phone gets its own top-level group of the DSP.
 *
 * On a fake node that records what reaches it; `remote-render.test.mjs`
 * checks on real nodes that the host's mapping gives the values the node's
 * own would.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
    FaustRemoteDsp,
    FaustRemoteHost,
    createLoopbackTransports
} from '../../dist/remote/index.js';
import { FakeNode } from './remote-fakes.mjs';

const settle = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

const toClose = [];
afterEach(() => {
    for (const thing of toClose.splice(0)) thing.close();
});

/** An input control, as the compiler describes one. */
const slider = (path, label, meta = [], init = 0) => ({
    type: 'hslider',
    label,
    shortname: label,
    address: `${path}/${label}`,
    url: '',
    index: 0,
    init,
    min: 0,
    max: 1,
    step: 0.01,
    meta
});
const button = (path, label) => ({
    type: 'button',
    label,
    shortname: label,
    address: `${path}/${label}`,
    url: '',
    index: 0
});

/** A DSP with one tilt and one turn control at the top. */
const SOLO = {
    name: 's',
    filename: 's.dsp',
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
            label: 's',
            items: [
                slider('/s', 'tilt', [{ acc: '0 0 -10 0 10' }]),
                slider('/s', 'turn', [{ gyr: '0 0 -90 0 90' }]),
                button('/s', 'gate')
            ]
        }
    ]
};

/** A DSP for two players: a group each, with a gate and a tilt control. */
const DUO = {
    ...SOLO,
    name: 'd',
    ui: [
        {
            type: 'vgroup',
            label: 'd',
            items: ['p1', 'p2'].map((player) => ({
                type: 'hgroup',
                label: player,
                items: [
                    button(`/d/${player}`, 'gate'),
                    slider(`/d/${player}`, 'tilt', [{ acc: '0 0 -10 0 10' }])
                ]
            }))
        }
    ]
};

const host = (meta, options) => {
    const node = new FakeNode(JSON.stringify(meta));
    const remoteHost = new FaustRemoteHost(node, { outputRate: 1e6, ...options });
    toClose.push(remoteHost);
    return { node, remoteHost };
};

const connect = async (remoteHost, id) => {
    const [hostEnd, remoteEnd] = createLoopbackTransports();
    remoteHost.accept(hostEnd);
    const dsp = await FaustRemoteDsp.connect(remoteEnd, {
        id,
        pingInterval: 0,
        gestureEnd: 0
    });
    toClose.push(dsp);
    return dsp;
};

const near = (actual, expected, what) =>
    assert.ok(Math.abs(actual - expected) < 1e-9, `${what}: ${actual}, expected ${expected}`);

// --------------------------------------------------------------------- shared

test('by default the latest reading drives every sensor control', async () => {
    const { node, remoteHost } = host(SOLO, {});
    const a = await connect(remoteHost, 'a');
    const b = await connect(remoteHost, 'b');
    a.propagateAcc({ x: 1, y: 0, z: 0 }, false);
    await settle();
    b.propagateAcc({ x: 3, y: 0, z: 0 }, false);
    await settle();
    assert.deepEqual(node.acc, [
        [1, 0, 0, false],
        [3, 0, 0, false]
    ]);
});

// ----------------------------------------------------------------------- mean

test('the mean policy drives the controls with the mean of recent readings', async () => {
    const { node, remoteHost } = host(SOLO, { sensorPolicy: 'mean', sensorWindow: 60 });
    const a = await connect(remoteHost, 'a');
    const b = await connect(remoteHost, 'b');
    // An Android phone: its sign is corrected before averaging
    a.propagateAcc({ x: 1, y: 2, z: 0 }, true);
    await settle();
    b.propagateAcc({ x: 3, y: 4, z: 0 }, false);
    await settle();
    assert.deepEqual(node.acc.at(-2), [-1, -2, 0, false]);
    assert.deepEqual(node.acc.at(-1), [1, 1, 0, false]);
    // A phone that stopped sending drops out of the mean
    await settle(100);
    b.propagateAcc({ x: 5, y: 4, z: 0 }, false);
    await settle();
    assert.deepEqual(node.acc.at(-1), [5, 4, 0, false]);
});

test('gyroscope angles are averaged around the circle', async () => {
    const { node, remoteHost } = host(SOLO, { sensorPolicy: 'mean' });
    const a = await connect(remoteHost, 'a');
    const b = await connect(remoteHost, 'b');
    a.propagateGyr({ alpha: 350, beta: 170, gamma: 10 });
    await settle();
    b.propagateGyr({ alpha: 10, beta: -170, gamma: 30 });
    await settle();
    const [alpha, beta, gamma] = node.gyr.at(-1) ?? [NaN, NaN, NaN];
    // 350 and 10 make 0, not 180; 170 and -170 make 180, not 0
    near(Math.min(alpha, 360 - alpha), 0, 'alpha');
    near(Math.abs(beta), 180, 'beta');
    near(gamma, 20, 'gamma');
});

// ------------------------------------------------------------------ assigned

test('the assigned policy maps each phone onto the controls it may write', async () => {
    const { node, remoteHost } = host(SOLO, {
        sensorPolicy: 'assigned',
        assign: (client) => (path) => (client.id === 'a' ? path === '/s/tilt' : path === '/s/gate')
    });
    const a = await connect(remoteHost, 'a');
    const b = await connect(remoteHost, 'b');
    // The DSP's curve: -10, 0, 10 onto min, init, max
    a.propagateAcc({ x: 5, y: 0, z: 0 }, false);
    await settle();
    a.propagateAcc({ x: -5, y: 0, z: 0 }, true);
    await settle();
    // b may write no sensor control: its readings drive nothing
    b.propagateAcc({ x: 10, y: 0, z: 0 }, false);
    a.propagateGyr({ alpha: 45, beta: 0, gamma: 0 });
    await settle();
    assert.deepEqual(node.writesTo('/s/tilt'), [0.5, 0.5]);
    assert.deepEqual(node.writesTo('/s/turn'), []);
    // Mapped by the host: the node's own mapping is not used
    assert.deepEqual(node.acc, []);
});

// --------------------------------------------------------------------- groups

test('assign: groups gives each phone a group of its own, and frees it', async () => {
    const { node, remoteHost } = host(DUO, { assign: 'groups', sensorPolicy: 'assigned' });
    const a = await connect(remoteHost, 'a');
    const b = await connect(remoteHost, 'b');
    const c = await connect(remoteHost, 'c');
    assert.equal(a.group, 'p1');
    assert.equal(b.group, 'p2');
    assert.equal(c.group, undefined, 'no group left');
    assert.deepEqual(
        remoteHost.clients.map((client) => [client.id, client.group]),
        [['a', 'p1'], ['b', 'p2'], ['c', undefined]]
    );

    // Each phone writes its group and nothing else
    const seenByA = [];
    a.setInputParamHandler((path, value) => seenByA.push([path, value]));
    await settle();
    seenByA.length = 0;
    a.setParamValue('/d/p1/gate', 1);
    a.setParamValue('/d/p2/gate', 1);
    c.setParamValue('/d/p1/gate', 0);
    await settle();
    assert.deepEqual(node.writesTo('/d/p1/gate'), [1]);
    assert.deepEqual(node.writesTo('/d/p2/gate'), []);
    // The refused write is answered with the real value
    assert.deepEqual(seenByA, [['/d/p2/gate', 0]]);

    // And each phone's sensors drive its own group's tilt
    a.propagateAcc({ x: 5, y: 0, z: 0 }, false);
    b.propagateAcc({ x: 10, y: 0, z: 0 }, false);
    c.propagateAcc({ x: 2, y: 0, z: 0 }, false);
    await settle();
    assert.deepEqual(node.writesTo('/d/p1/tilt'), [0.5]);
    assert.deepEqual(node.writesTo('/d/p2/tilt'), [1]);

    // A group is freed when its phone leaves
    a.close();
    await settle();
    const d = await connect(remoteHost, 'd');
    assert.equal(d.group, 'p1');
});
