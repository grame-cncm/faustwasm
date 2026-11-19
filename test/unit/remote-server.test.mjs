/**
 * The signaling server of `scripts/faust-remote-server.js`, in this process.
 *
 * Its job is narrow and has to be done exactly: relay a remote control's
 * messages to the host of its room and nowhere else, the host's to the remote
 * control they name, refuse whoever lacks the room's token, never let a
 * remote control speak for another, and serve files from its root and not one
 * byte from outside it. The last test runs a whole session through it, with
 * the client of `src/remote/signaling.ts` on both ends.
 */
import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import createFaustRemoteServer from '../../src/faustRemoteServer.js';
import {
    FaustRemoteDsp,
    FaustRemoteHost,
    createHttpSignaling
} from '../../dist/remote/index.js';
import { FakeRTC, FakeRTCPeerConnection } from './fake-rtc.mjs';
import { GATE, FakeNode } from './remote-fakes.mjs';

const ROOT = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../..'
);

/** @type {import('node:http').Server} */ let server;
let base = '';

before(async () => {
    server = /** @type {import('node:http').Server} */ (
        createFaustRemoteServer({ root: ROOT })
    );
    await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(null)));
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    base = `http://127.0.0.1:${address.port}`;
});

after(() => {
    server.closeAllConnections();
    server.close();
});

const toClose = [];
afterEach(() => {
    for (const thing of toClose.splice(0)) thing.close();
});

const settle = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms));

/** A room name no other test uses. */
let rooms = 0;
const room = () => `room${(rooms += 1)}`;

/**
 * @param {string} name
 * @param {string} action
 * @param {object} body
 * @param {string | null} [token]
 */
const post = (name, action, body, token = 'secret') =>
    fetch(`${base}/signal/${name}/${action}`, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            ...(token === null ? {} : { 'x-faust-token': token })
        },
        body: JSON.stringify(body)
    });

/** A signaling client that records what it receives. */
const client = (name, role, options = {}) => {
    const signaling = createHttpSignaling(base, name, 'secret', {
        role,
        ...options
    });
    toClose.push(signaling);
    /** @type {any[]} */
    const received = [];
    signaling.onmessage = (message) => received.push(message);
    return { signaling, received };
};

// -------------------------------------------------------------------- files

test('files under the root are served with their type', async () => {
    const dsp = await fetch(`${base}/test/poly.dsp`);
    assert.equal(dsp.status, 200);
    assert.match(dsp.headers.get('content-type') ?? '', /^text\/plain/);
    assert.match(await dsp.text(), /process/);

    const wasm = await fetch(`${base}/libfaust-wasm/libfaust-wasm.wasm`, {
        method: 'HEAD'
    });
    assert.equal(wasm.status, 200);
    assert.equal(wasm.headers.get('content-type'), 'application/wasm');

    assert.equal((await fetch(`${base}/no/such/file`)).status, 404);
});

test('nothing outside the root is served', async () => {
    const outside = createFaustRemoteServer({ root: path.join(ROOT, 'test') });
    await new Promise((resolve) => outside.listen(0, '127.0.0.1', () => resolve(null)));
    const address = outside.address();
    assert.ok(address && typeof address === 'object');
    const url = `http://127.0.0.1:${address.port}`;
    try {
        // An encoded slash survives URL normalisation, then decodes to '..'
        const escaped = await fetch(`${url}/%2e%2e%2fpackage.json`);
        assert.equal(escaped.status, 403);
        // Plain dot segments are folded by the URL before the server sees them
        const folded = await fetch(`${url}/../package.json`);
        assert.equal(folded.status, 404);
        assert.equal((await fetch(`${url}/poly.dsp`)).status, 200);
    } finally {
        outside.close();
    }
});

// ---------------------------------------------------------------- signaling

test('signaling requires the token, and the first token owns the room', async () => {
    const name = room();
    assert.equal((await post(name, 'host', { id: 'h' }, null)).status, 401);
    assert.equal((await post(name, 'host', { id: 'h' })).status, 204);
    assert.equal((await post(name, 'host', { id: 'x' }, 'other')).status, 403);
    assert.equal(
        (await post(name, 'send', { id: 'p', message: { type: 'bye', peer: 'p' } }, 'other')).status,
        403
    );
    const events = await fetch(`${base}/signal/${name}/events/p`, {
        headers: { 'x-faust-token': 'wrong' }
    });
    assert.equal(events.status, 403);
    assert.equal(
        (await fetch(`${base}/signal/nowhere/events/p`, {
            headers: { 'x-faust-token': 'secret' }
        })).status,
        404
    );
});

test('malformed signaling requests are refused', async () => {
    const name = room();
    await post(name, 'host', { id: 'h' });
    const raw = (body) =>
        fetch(`${base}/signal/${name}/send`, {
            method: 'POST',
            headers: { 'x-faust-token': 'secret' },
            body
        });
    assert.equal((await raw('not json')).status, 400);
    assert.equal((await raw(JSON.stringify({ id: 'p' }))).status, 400);
    assert.equal(
        (await raw(JSON.stringify({ id: 'p', message: { type: 'offer' } }))).status,
        400
    );
    assert.equal((await raw('x'.repeat(70 * 1024))).status, 413);
});

test('a remote control reaches the host, speaking only for itself', async () => {
    const name = room();
    const host = client(name, 'host', { id: 'host-secret' });
    await host.signaling.ready;
    const remote = client(name, 'remote');
    await remote.signaling.ready;

    remote.signaling.send({ type: 'offer', peer: 'someone-else', sdp: 'o' });
    await settle();
    assert.deepEqual(host.received, [
        { type: 'offer', peer: remote.signaling.id, sdp: 'o' }
    ]);

    host.signaling.send({ type: 'answer', peer: remote.signaling.id, sdp: 'a' });
    await settle();
    assert.deepEqual(remote.received, [
        { type: 'answer', peer: remote.signaling.id, sdp: 'a' }
    ]);
});

test('messages for a stream not yet open are kept until it opens', async () => {
    const name = room();
    const host = client(name, 'host', { id: 'host-secret' });
    await host.signaling.ready;
    host.signaling.send({ type: 'answer', peer: 'late', sdp: 'a' });
    await settle();
    const late = client(name, 'remote', { id: 'late' });
    await late.signaling.ready;
    await settle();
    assert.deepEqual(late.received, [{ type: 'answer', peer: 'late', sdp: 'a' }]);
});

// A timeout, so that a `ready` that never resolves fails instead of hanging
test('a remote control waits for a host that registers later', { timeout: 5000 }, async () => {
    const name = room();
    const remote = client(name, 'remote', { retry: 20 });
    await settle(50);
    const host = client(name, 'host', { id: 'host-secret' });
    await host.signaling.ready;
    await remote.signaling.ready;
    remote.signaling.send({ type: 'bye', peer: remote.signaling.id });
    await settle();
    assert.deepEqual(host.received, [{ type: 'bye', peer: remote.signaling.id }]);
});

test('a whole session is established through the server', async () => {
    FakeRTCPeerConnection.reset();
    const name = room();
    const node = new FakeNode();
    const host = new FaustRemoteHost(node, { token: 'secret' });
    toClose.push(host);
    const hostSignaling = createHttpSignaling(base, name, 'secret', { role: 'host' });
    toClose.push(hostSignaling);
    await hostSignaling.ready;
    host.listen(hostSignaling, { RTCPeerConnection: FakeRTC });

    const dsp = await FaustRemoteDsp.connectRTC(
        createHttpSignaling(base, name, 'secret', { role: 'remote' }),
        { token: 'secret', pingInterval: 0, gestureEnd: 0 },
        { RTCPeerConnection: FakeRTC }
    );
    toClose.push(dsp);
    dsp.setParamValue(GATE, 1);
    await settle();
    assert.deepEqual(node.writesTo(GATE), [1]);
    assert.equal(FakeRTCPeerConnection.refused, 0);
});
