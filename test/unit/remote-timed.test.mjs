/**
 * The timed mode: values applied as regularly as they were sent.
 *
 * Over a radio link, messages sent 10 ms apart arrive 2 ms or 40 ms apart.
 * With a playout delay, the remote control stamps each message in the host's
 * clock and the host applies it at its own moment plus the delay, on the
 * exact sample for parameters and MIDI. Here the network is the in-memory
 * transport with a latency drawn from a fixed pseudo-random sequence, and the
 * node a fake on the same clock as `performance.now()`; the assertions
 * compare the spacing the values were applied with to the spacing they were
 * sent with -- the jitter before and after.
 *
 * The clock estimator is tested on its own first, on exchanges whose offset
 * and asymmetry are known.
 */
import { test, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';
import {
    FaustRemoteDsp,
    FaustRemoteHost,
    createLoopbackTransports
} from '../../dist/remote/index.js';
import { FREQ, GATE, FakeNode } from './remote-fakes.mjs';

const ROOT = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../..'
);
const BUNDLE = path.join(ROOT, 'test', 'out', 'internals', 'remote-clock.mjs');

/** @type {any} */ let FaustRemoteClock;

before(async () => {
    await esbuild.build({
        entryPoints: [path.join(ROOT, 'src', 'remote', 'clock.ts')],
        outfile: BUNDLE,
        bundle: true,
        format: 'esm',
        target: 'es2019',
        logLevel: 'silent'
    });
    ({ FaustRemoteClock } = await import(pathToFileURL(BUNDLE).href));
});

const settle = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

const toClose = [];
afterEach(() => {
    for (const thing of toClose.splice(0)) thing.close();
});

/** A fixed sequence in [0, 1): the same "random" network on every run. */
const sequence = (seed) => () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
};

/** Largest gap between two series of intervals, in ms. */
const worstDeviation = (a, b) => {
    const gaps = (times) => times.slice(1).map((t, n) => t - times[n]);
    const ga = gaps(a);
    const gb = gaps(b);
    return Math.max(...ga.map((gap, n) => Math.abs(gap - gb[n])));
};

/**
 * A host with a playout delay and a remote control, over a jittery network.
 *
 * @param {number | null} playoutDelay - seconds
 * @param {(channel: string, message: string, from: 0 | 1) => number} latency
 */
const session = async (playoutDelay, latency) => {
    const node = new FakeNode();
    const host = new FaustRemoteHost(node, { outputRate: 1e6, playoutDelay });
    toClose.push(host);
    const [hostEnd, remoteEnd] = createLoopbackTransports({ latency });
    host.accept(hostEnd);
    const dsp = await FaustRemoteDsp.connect(remoteEnd, {
        pingInterval: 0,
        gestureEnd: 0
    });
    toClose.push(dsp);
    // Timestamps wait for the host's clock, and the burst of pings that
    // estimates it: an estimate refined mid-test shifts the stamps
    if (playoutDelay) await settle(200);
    assert.ok(!playoutDelay || dsp.clockOffset !== null, 'the clock is known');
    return { node, host, dsp, remoteEnd };
};

// ------------------------------------------------------------------ clock

test('the clock offset comes from the least delayed exchange', () => {
    const clock = new FaustRemoteClock();
    assert.equal(clock.offset, null);
    // The host's clock is 1000 ms ahead. Each exchange: send at t0, a forward
    // leg, 0.1 ms on the host, a return leg.
    const exchange = (t0, forward, back) => {
        const t1 = t0 + forward + 1000;
        const t2 = t1 + 0.1;
        clock.add(t0, t1, t2, t2 - 1000 + back);
    };
    exchange(0, 20, 2); // queued on the way there: offset off by 9 ms
    exchange(100, 2, 30); // queued on the way back
    exchange(200, 1, 1); // symmetric and short
    exchange(300, 5, 25);
    assert.ok(Math.abs(clock.offset - 1000) < 1e-9, `offset ${clock.offset}`);
    assert.ok(Math.abs(clock.rtt - 2) < 1e-9, `rtt ${clock.rtt}`);
});

test('the clock forgets exchanges past its window, and impossible ones', () => {
    const clock = new FaustRemoteClock(2);
    clock.add(0, 1, 1, 2); // rtt 2, offset 0
    clock.add(10, 505, 505, 20); // rtt 10, offset 490
    clock.add(20, 515, 515, 30); // rtt 10: the first one has left the window
    assert.equal(clock.offset, 490);
    clock.add(40, 45, 44, 50); // answered before it was received
    clock.add(60, 61, 61, 59); // received before it was sent
    assert.equal(clock.offset, 490);
});

// ------------------------------------------------------------- timed mode

test('without a playout delay, nothing is stamped and all is applied at once', async () => {
    const { node, dsp } = await session(null, () => 1);
    assert.equal(dsp.playoutDelay, 0);
    dsp.setParamValue(FREQ, 500);
    dsp.keyOn(0, 60, 100);
    await settle(20);
    assert.deepEqual(
        node.timed.map(({ time }) => time),
        [undefined]
    );
    assert.deepEqual(
        node.timedMidi.map(({ time }) => time),
        [undefined]
    );
});

test('timestamped notes keep the spacing they were sent with', async () => {
    const random = sequence(7);
    const NOTES = 30;
    const latency = (channel, message, from) =>
        // Up to 40 ms from the remote control; the host's answers are quick
        from === 1 ? random() * 40 : 1;

    for (const playoutDelay of [null, 0.08]) {
        const { node, dsp } = await session(playoutDelay, latency);
        /** @type {number[]} */
        const sent = [];
        for (let n = 0; n < NOTES; n += 1) {
            sent.push(performance.now());
            dsp.keyOn(0, 40 + n, 100);
            await settle(10);
        }
        await settle(150);
        assert.equal(node.timedMidi.length, NOTES);
        if (playoutDelay === null) {
            // Before: applied as they arrived
            const arrived = node.timedMidi.map(({ at }) => at);
            const jitter = worstDeviation(arrived, sent);
            assert.ok(jitter > 15, `the network should jitter (${jitter} ms)`);
        } else {
            // After: applied at the moment they were sent, plus the delay
            assert.ok(
                node.timedMidi.every(({ time }) => time !== undefined),
                'every note scheduled'
            );
            const applied = node.timedMidi.map(({ time }) => Number(time) * 1000);
            const jitter = worstDeviation(applied, sent);
            assert.ok(jitter < 2, `jitter after the playout delay: ${jitter} ms`);
            // And about the delay after they were sent
            const lag = applied.map((time, n) => time - sent[n]);
            assert.ok(
                lag.every((ms) => ms > 60 && ms < 100),
                `lags ${lag.map((ms) => ms.toFixed(1))}`
            );
        }
    }
});

test('a value that took longer than the delay is applied at once', async () => {
    const { node, dsp } = await session(0.03, (channel, message, from) =>
        from === 1 && message.includes('"param"') ? 80 : 1
    );
    dsp.setParamValue(FREQ, 700);
    await settle(120);
    assert.deepEqual(
        node.timed.map(({ value, time }) => [value, time]),
        [[700, undefined]]
    );
});

test('a vanished remote control is released after what it had scheduled', async () => {
    const { node, dsp, remoteEnd } = await session(0.1, () => 1);
    dsp.setParamValue(GATE, 1);
    dsp.keyOn(0, 60, 100);
    await settle(10);
    remoteEnd.close();
    await settle(20);
    const [press, release] = node.timed.filter(({ path }) => path === GATE);
    assert.equal(press.value, 1);
    assert.equal(release.value, 0);
    assert.ok(press.time !== undefined && Number(release.time) > press.time);
    const [on, off] = node.timedMidi;
    assert.deepEqual(off.data, [0x80, 60, 0]);
    assert.ok(on.time !== undefined && Number(off.time) > on.time);
});

test('sensor readings wait for their time, by a timer', async () => {
    const { node, dsp } = await session(0.05, () => 1);
    dsp.propagateAcc({ x: 1, y: 2, z: 3 }, false);
    await settle(15);
    assert.deepEqual(node.acc, [], 'applied before its time');
    await settle(70);
    assert.deepEqual(node.acc, [[1, 2, 3, false]]);
});
