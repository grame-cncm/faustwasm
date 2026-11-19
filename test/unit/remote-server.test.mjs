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
import { request as httpRequest } from 'node:http';
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

// -------------------------------------------------------------------- relay

test('a whole session goes through the relay when WebRTC is out of reach', async () => {
    const name = room();
    const node = new FakeNode();
    const host = new FaustRemoteHost(node, { token: 'secret', outputRate: 1e6 });
    toClose.push(host);
    host.listenRelay(base, name, 'secret', { retry: 50 });
    await settle(100);

    const dsp = await FaustRemoteDsp.connectRelay(base, name, {
        token: 'secret',
        pingInterval: 0,
        gestureEnd: 0
    });
    toClose.push(dsp);
    // The welcome, over 125 bytes, took the 16-bit length of the framing
    assert.ok(dsp.getJSON().length > 125);
    /** @type {number[]} */
    const levels = [];
    dsp.setOutputParamHandler((path, value) => levels.push(value));
    dsp.setParamValue(GATE, 1);
    await settle();
    assert.deepEqual(node.writesTo(GATE), [1]);
    node.emit('/t/level', 0.5);
    await settle();
    assert.equal(levels.at(-1), 0.5);

    // The remote control's connection drops: the host releases the gate
    dsp.close();
    await settle();
    assert.deepEqual(node.writesTo(GATE), [1, 0]);
    assert.deepEqual(host.clients, []);
});

test('a relayed connection that drops is released without a goodbye', async () => {
    const name = room();
    const node = new FakeNode();
    const host = new FaustRemoteHost(node, { token: 'secret' });
    toClose.push(host);
    host.listenRelay(base, name, 'secret', { retry: 50 });
    await settle(100);
    const { connectRelay } = await import('../../dist/remote/index.js');
    const transport = await connectRelay(base, name, 'secret');
    const dsp = await FaustRemoteDsp.connect(transport, {
        token: 'secret',
        pingInterval: 0,
        gestureEnd: 0
    });
    dsp.setParamValue(GATE, 1);
    await settle();
    // The socket closes under the remote control: no 'bye' is sent
    transport.close();
    await settle();
    assert.deepEqual(node.writesTo(GATE), [1, 0]);
});

test('the relay refuses a wrong token, and a room without a relaying host', async () => {
    const name = room();
    const host = new FaustRemoteHost(new FakeNode(), { token: 'secret' });
    toClose.push(host);
    host.listenRelay(base, name, 'secret', { retry: 50 });
    await settle(100);
    await assert.rejects(
        FaustRemoteDsp.connectRelay(base, name, { token: 'guess' }),
        /refused/
    );
    await assert.rejects(
        FaustRemoteDsp.connectRelay(base, room(), { token: 'secret' }),
        /refused/
    );
    // Another host cannot take the room with another token; stopped while it
    // waits to try again, it tries no more
    const { listenRelay } = await import('../../dist/remote/index.js');
    const errors = [];
    const stop = listenRelay(base, name, 'other', () => {}, { retry: 50 }, (error) => {
        errors.push(error);
        setTimeout(stop, 5);
    });
    await settle(300);
    assert.equal(errors.length, 1);
});

test('the relay answers no plain HTTP request on its path', async () => {
    const response = await fetch(`${base}/relay/someroom`);
    assert.equal(response.status, 404);
});

// ------------------------------------------------------------ other origins

/**
 * A raw request, to set the `Origin` header a browser would, and read the
 * headers of a response that may never end (an event stream).
 *
 * @param {string} url
 * @param {string} method
 * @param {Record<string, string>} headers
 * @param {string} [body]
 * @returns {Promise<{ status: number, headers: import('node:http').IncomingHttpHeaders }>}
 */
const raw = (url, method, headers, body) =>
    new Promise((resolve, reject) => {
        const request = httpRequest(url, { method, headers });
        request.on('response', (response) => {
            resolve({ status: response.statusCode ?? 0, headers: response.headers });
            response.destroy();
        });
        // A refused WebSocket upgrade answers with a plain response; an
        // accepted one with 101, as an 'upgrade' event
        request.on('upgrade', (response, socket) => {
            resolve({ status: response.statusCode ?? 0, headers: response.headers });
            socket.destroy();
        });
        request.on('error', reject);
        request.end(body);
    });

test('pages of an allowed origin may use the signaling, others may not', async () => {
    const IDE = 'https://ide.example.org';
    const server = createFaustRemoteServer({ root: ROOT, allowOrigins: [IDE] });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(null)));
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const url = `http://127.0.0.1:${address.port}`;
    const json = { 'content-type': 'application/json', 'x-faust-token': 'secret' };
    try {
        // The preflight a browser sends first: no token, answered on the origin
        const preflight = await raw(`${url}/signal/r1/host`, 'OPTIONS', {
            origin: IDE,
            'access-control-request-method': 'POST',
            'access-control-request-headers': 'content-type, x-faust-token'
        });
        assert.equal(preflight.status, 204);
        assert.equal(preflight.headers['access-control-allow-origin'], IDE);
        assert.match(String(preflight.headers['access-control-allow-headers']), /x-faust-token/);
        assert.match(String(preflight.headers['access-control-allow-methods']), /POST/);

        // The request itself, and the event stream
        const host = await raw(`${url}/signal/r1/host`, 'POST', { ...json, origin: IDE }, '{"id":"h"}');
        assert.equal(host.status, 204);
        assert.equal(host.headers['access-control-allow-origin'], IDE);
        const events = await raw(`${url}/signal/r1/events/h`, 'GET', { ...json, origin: IDE });
        assert.equal(events.status, 200);
        assert.equal(events.headers['access-control-allow-origin'], IDE);
        // Not held back by a reverse proxy
        assert.equal(events.headers['x-accel-buffering'], 'no');

        // Another origin is refused, preflight included
        const other = { ...json, origin: 'https://elsewhere.example.org' };
        assert.equal((await raw(`${url}/signal/r1/host`, 'OPTIONS', other)).status, 403);
        assert.equal((await raw(`${url}/signal/r1/host`, 'POST', other, '{"id":"x"}')).status, 403);

        // The server's own pages, and clients that are no page, as before
        const own = await raw(`${url}/signal/r2/host`, 'POST', { ...json, origin: url }, '{"id":"h"}');
        assert.equal(own.status, 204);
        assert.equal(own.headers['access-control-allow-origin'], undefined);
        assert.equal((await raw(`${url}/signal/r3/host`, 'POST', json, '{"id":"h"}')).status, 204);
    } finally {
        server.closeAllConnections();
        server.close();
    }
});

test('the relay checks the origin itself, which CORS does not cover', async () => {
    const IDE = 'https://ide.example.org';
    const server = createFaustRemoteServer({ root: ROOT, allowOrigins: [IDE] });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(null)));
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const upgrade = (origin) =>
        raw(`http://127.0.0.1:${address.port}/relay/r1`, 'GET', {
            connection: 'Upgrade',
            upgrade: 'websocket',
            'sec-websocket-version': '13',
            'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==',
            ...(origin ? { origin } : {})
        });
    try {
        assert.equal((await upgrade('https://elsewhere.example.org')).status, 403);
        assert.equal((await upgrade(IDE)).status, 101);
        assert.equal((await upgrade(null)).status, 101);
    } finally {
        server.close();
    }
});
