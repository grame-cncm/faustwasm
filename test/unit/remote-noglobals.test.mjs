/**
 * The host where browser globals are missing: Max's `v8` object documents no
 * `EventTarget`, `CustomEvent`, `performance` or `crypto` (section 20 of
 * docs/remote-control.md). The host bundle must still load there, and a
 * host on a FaustRemoteHub must still take a remote control, check its DSP
 * hash (with the plain JavaScript SHA-256), apply its writes and send it the
 * patch's changes.
 *
 * Node runs each test file in a process of its own, so removing the
 * globals here touches no other test. They are removed before the bundle is
 * imported, since some of them are read when its classes are defined. The
 * remote control is played by hand: the client side needs those globals.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { FREQ, JSON_TEXT } from './remote-fakes.mjs';

for (const name of ['EventTarget', 'CustomEvent', 'Event', 'performance', 'crypto'])
    Object.defineProperty(globalThis, name, {
        value: undefined,
        configurable: true,
        writable: true
    });

const { FaustRemoteHost, FaustRemoteHub, PROTOCOL_VERSION } = await import(
    '../../dist/remote/host.js'
);

const settle = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
const HASH = createHash('sha256').update(JSON_TEXT).digest('hex');

/** The host's end of a connection, recording what the host sends. */
const hostEnd = () => {
    /** @type {any[]} */
    const sent = [];
    const transport = {
        maxMessageSize: 1 << 20,
        onmessage: /** @type {any} */ (null),
        onclose: /** @type {any} */ (null),
        bufferedAmount: () => 0,
        send: (/** @type {string} */ _channel, /** @type {string} */ text) =>
            sent.push(JSON.parse(text)),
        close: () => {}
    };
    const say = (/** @type {object} */ message) =>
        transport.onmessage('ctl', JSON.stringify(message));
    return { transport, sent, say };
};

const hello = (hash = HASH) => ({
    type: 'hello',
    v: PROTOCOL_VERSION,
    id: 'phone',
    mode: 'bi',
    token: 'tok',
    hash
});

test('the globals are really gone', () => {
    assert.equal(globalThis.EventTarget, undefined);
    assert.equal(globalThis.crypto, undefined);
    assert.equal(globalThis.performance, undefined);
});

test('without them, a host on a hub takes a remote control and applies its writes', async () => {
    /** @type {[string, number][]} */
    const writes = [];
    const hub = new FaustRemoteHub(JSON_TEXT, {
        onwrite: (path, value) => writes.push([path, value])
    });
    const host = new FaustRemoteHost(hub, { token: 'tok', outputRate: 1e6 });
    /** @type {any[]} */
    const joined = [];
    host.addEventListener('join', (/** @type {any} */ event) => joined.push(event.detail));

    const { transport, sent, say } = hostEnd();
    host.accept(transport);
    say(hello());
    await settle(10);
    assert.equal(sent[0]?.type, 'welcome', 'the hash matched: the plain SHA-256 is right');
    assert.deepEqual(joined, [{ id: 'phone', mode: 'bi' }]);

    say({ type: 'param', i: 0, value: 880 });
    await settle(10);
    assert.deepEqual(writes, [[FREQ, 880]]);

    hub.update(FREQ, 330);
    await settle(10);
    assert.deepEqual(
        sent.filter((message) => message.type === 'sync').at(-1),
        { type: 'sync', i: 0, value: 330 }
    );
    host.close();
});

test('without them, a remote control holding another DSP is refused', async () => {
    const host = new FaustRemoteHost(new FaustRemoteHub(JSON_TEXT), { token: 'tok' });
    const { transport, sent, say } = hostEnd();
    host.accept(transport);
    say(hello('0'.repeat(64)));
    await settle(10);
    assert.equal(sent[0]?.type, 'reject');
    assert.equal(sent[0]?.code, 'dsp-mismatch');
    host.close();
});
