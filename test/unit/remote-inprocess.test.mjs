/**
 * A host in the server's own process, as in a node.script of a Max patch:
 * `server.hostRoom(room, token)` gives it the room's relay as a port, with
 * no WebSocket in between, and `host.acceptRelay(port)` takes the remote
 * controls that arrive through it. The remote controls connect as they do
 * to any relaying host, over a real WebSocket to the real server.
 */
import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as os from 'node:os';
import createFaustRemoteServer from '../../src/faustRemoteServer.js';
import {
    FaustRemoteDsp,
    FaustRemoteHost,
    FaustRemoteHub,
    createHttpSignaling
} from '../../dist/remote/index.js';
import { FakeRTC } from './fake-rtc.mjs';
import { FREQ, GATE, JSON_TEXT } from './remote-fakes.mjs';

const settle = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

/** @type {ReturnType<typeof createFaustRemoteServer>} */ let server;
let url = '';
let roomCount = 0;

before(async () => {
    server = createFaustRemoteServer({ root: os.tmpdir() });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(null)));
    const address = /** @type {import('node:net').AddressInfo} */ (server.address());
    url = `http://127.0.0.1:${address.port}`;
});
after(() => new Promise((resolve) => server.close(() => resolve(null))));

/** @type {{ close(): void }[]} */
const toClose = [];
afterEach(() => {
    for (const thing of toClose.splice(0)) thing.close();
});

/** A hub, a host on it in this process, and the room its port serves. */
const inProcessHost = () => {
    const room = `room${roomCount++}`;
    /** @type {[string, number][]} */
    const writes = [];
    const hub = new FaustRemoteHub(JSON_TEXT, {
        onwrite: (path, value) => writes.push([path, value])
    });
    const host = new FaustRemoteHost(hub, { token: 'tok', outputRate: 1e6 });
    const port = server.hostRoom(room, 'tok');
    host.acceptRelay(port);
    toClose.push(host, hub, port);
    return { room, hub, host, port, writes };
};

const connect = async (/** @type {string} */ room, token = 'tok') => {
    const dsp = await FaustRemoteDsp.connectRelay(url, room, {
        token,
        id: 'phone',
        pingInterval: 0,
        gestureEnd: 0
    });
    toClose.push(dsp);
    return dsp;
};

test('a remote control reaches a host in the server process, both ways', async () => {
    const { room, hub, writes } = inProcessHost();
    const dsp = await connect(room);
    assert.equal(dsp.state, 'open');
    dsp.setParamValue(FREQ, 880);
    await settle(50);
    assert.deepEqual(writes, [[FREQ, 880]]);
    hub.update(FREQ, 220);
    await settle(50);
    assert.equal(dsp.getParamValue(FREQ), 220);
});

test('the wrong token is refused by the relay', async () => {
    const { room } = inProcessHost();
    await assert.rejects(connect(room, 'nope'));
});

test('a room another token holds cannot be hosted', () => {
    const { room } = inProcessHost();
    assert.throws(() => server.hostRoom(room, 'other'), /taken/);
});

test('closing the port ends the remote controls, which release what they held', async () => {
    const { room, port, writes } = inProcessHost();
    const dsp = await connect(room);
    dsp.setParamValue(GATE, 1);
    await settle(50);
    port.close();
    await settle(50);
    assert.equal(dsp.state, 'closed');
    assert.deepEqual(writes, [
        [GATE, 1],
        [GATE, 0]
    ]);
});

test('a host closing with a reason says it through the relay before the relay closes', async () => {
    const { room, host } = inProcessHost();
    const dsp = await connect(room);
    // As the Max bridge does when the patch's DSP changes
    host.close('dsp-changed');
    await settle(100);
    assert.equal(dsp.state, 'closed');
    assert.equal(dsp.closeReason, 'dsp-changed');
});

test('a remote control that leaves is gone from the host', async () => {
    const { room, host } = inProcessHost();
    const dsp = await connect(room);
    assert.equal(host.clients.length, 1);
    dsp.close();
    await settle(50);
    assert.equal(host.clients.length, 0);
});

test('a remote control trying WebRTC first gives up at once: this host only takes the relay', async () => {
    const { room } = inProcessHost();
    const started = Date.now();
    await assert.rejects(
        FaustRemoteDsp.connectRTC(
            createHttpSignaling(url, room, 'tok', { role: 'remote' }),
            { token: 'tok' },
            { RTCPeerConnection: FakeRTC, timeout: 8000 }
        ),
        /409/
    );
    assert.ok(Date.now() - started < 2000, 'not after the 8 s timeout');
    // ... and the relay takes it
    const dsp = await connect(room);
    assert.equal(dsp.state, 'open');
});
