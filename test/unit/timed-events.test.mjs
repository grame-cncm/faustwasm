/**
 * What the processor hands `compute` for a block.
 *
 * Two sources meet in `collectEvents`: the automation an `AudioParam` hands
 * `process` for the block, and the port messages that were timestamped for a
 * frame inside it. These tests are about the frames -- that a step at 40 is an
 * event at 40 and not at 0, that a `1 -> 0 -> 1` inside one block is two edges
 * and not none, that a message for a later block waits for it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { monoProcessor, BLOCK, SAMPLE_RATE } from './harness.mjs';

const GATE = '/probe/gate';
const VOL = '/probe/vol';

/** A block of automation: `value` from `at` onwards, `from` before it. */
function step(from, value, at) {
    return Array.from({ length: BLOCK }, (_, i) => (i < at ? from : value));
}

test('a block where nothing moves carries no events', () => {
    const p = monoProcessor();
    assert.deepEqual(p.render(), []);
    assert.deepEqual(p.dsp.writes, []);
});

test('a control that changes between blocks is written once, at frame 0', () => {
    const p = monoProcessor();
    p.render();
    assert.deepEqual(p.render({ [VOL]: 0.25 }), [{ frame: 0, seq: -1 }]);
    assert.deepEqual(p.dsp.writes, [{ path: VOL, value: 0.25 }]);
});

test('a control that holds its new value is not written again', () => {
    const p = monoProcessor();
    p.render({ [VOL]: 0.25 });
    p.render({ [VOL]: 0.25 });
    p.render();
    assert.equal(p.dsp.writes.length, 1);
});

test('a step inside the block is an event on the frame it happens', () => {
    const p = monoProcessor();
    const events = p.render({ [GATE]: step(0, 1, 40) });
    assert.deepEqual(events, [{ frame: 40, seq: -1 }]);
    assert.deepEqual(p.dsp.writes, [{ path: GATE, value: 1 }]);
});

test('1 -> 0 -> 1 inside one block is two edges, not none', () => {
    const p = monoProcessor();
    // The gate is already up when the block starts, drops at 60 and comes back
    // at 70. Reading only frame 0 sees 1, compares it to a cached 1, and lets
    // the whole thing through unnoticed: the hit that never retriggers.
    p.render({ [GATE]: 1 });
    const automation = Array.from({ length: BLOCK }, (_, i) =>
        i >= 60 && i < 70 ? 0 : 1
    );
    assert.deepEqual(p.render({ [GATE]: automation }), [
        { frame: 60, seq: -1 },
        { frame: 70, seq: -1 }
    ]);
    assert.deepEqual(p.dsp.writes.slice(1), [
        { path: GATE, value: 0 },
        { path: GATE, value: 1 }
    ]);
});

test('every step of a ramp is its own event', () => {
    const p = monoProcessor();
    const events = p.render({
        [VOL]: Array.from({ length: BLOCK }, (_, i) => i / BLOCK)
    });
    assert.equal(events.length, BLOCK);
    assert.deepEqual(
        events.map((e) => e.frame),
        Array.from({ length: BLOCK }, (_, i) => i)
    );
    assert.deepEqual(
        p.dsp.writes.map((w) => w.value),
        Array.from({ length: BLOCK }, (_, i) => i / BLOCK)
    );
});

test('a ramp that starts where the control already is skips frame 0', () => {
    const p = monoProcessor();
    // 0.5 is the control's `init`, which is what the cache was seeded with.
    const events = p.render({
        [VOL]: Array.from({ length: BLOCK }, (_, i) => 0.5 + i / 256)
    });
    assert.equal(events.length, BLOCK - 1);
    assert.equal(events[0].frame, 1);
    assert.equal(events.at(-1).frame, BLOCK - 1);
});

test('an untimed message is applied on arrival, before the next block', () => {
    const p = monoProcessor();
    p.port.send({ type: 'keyOn', data: [0, 60, 100] });
    assert.deepEqual(p.dsp.notes, [
        { type: 'keyOn', channel: 0, pitch: 60, velocity: 100 }
    ]);
    assert.deepEqual(p.render(), []);
});

test('a timed message waits for its frame inside the right block', () => {
    const p = monoProcessor();
    p.port.send({ type: 'keyOn', data: [0, 60, 100], time: 40 / SAMPLE_RATE });
    assert.deepEqual(p.dsp.notes, [], 'not applied on arrival');
    const events = p.render();
    assert.equal(events.length, 1);
    assert.equal(events[0].frame, 40);
    assert.deepEqual(p.dsp.notes, [
        { type: 'keyOn', channel: 0, pitch: 60, velocity: 100 }
    ]);
});

test('a message for a later block is held until that block', () => {
    const p = monoProcessor();
    // Three blocks out, 20 frames in.
    const frame = 3 * BLOCK + 20;
    p.port.send({
        type: 'keyOn',
        data: [0, 60, 100],
        time: frame / SAMPLE_RATE
    });
    assert.deepEqual(p.render(), []);
    assert.deepEqual(p.render(), []);
    assert.deepEqual(p.render(), []);
    const events = p.render();
    assert.equal(events.length, 1);
    assert.equal(events[0].frame, 20, 'offset from the start of its own block');
});

test('a message whose block has gone by happens at the top of this one', () => {
    const p = monoProcessor();
    p.render();
    p.render();
    p.port.send({ type: 'keyOn', data: [0, 60, 100], time: 10 / SAMPLE_RATE });
    const events = p.render();
    assert.equal(events.length, 1);
    assert.equal(events[0].frame, 0, 'late, not lost');
});

test('a frame is taken as given, alongside a time in seconds', () => {
    const p = monoProcessor();
    p.port.send({ type: 'keyOn', data: [0, 60, 100], frame: 77 });
    assert.equal(p.render()[0].frame, 77);
});

test('a timed param message is written at its frame', () => {
    const p = monoProcessor();
    p.port.send({
        type: 'param',
        data: { path: VOL, value: 0.75 },
        time: 33 / SAMPLE_RATE
    });
    assert.deepEqual(p.dsp.writes, [], 'not applied on arrival');
    assert.equal(p.render()[0].frame, 33);
    assert.deepEqual(p.dsp.writes, [{ path: VOL, value: 0.75 }]);
});

test('a timed MIDI message reaches the DSP at its frame', () => {
    const p = monoProcessor();
    p.port.send({ type: 'midi', data: [144, 60, 100], time: 12 / SAMPLE_RATE });
    assert.deepEqual(p.dsp.midi, []);
    assert.equal(p.render()[0].frame, 12);
    assert.deepEqual(p.dsp.midi, [{ type: 'midi', data: [144, 60, 100] }]);
});

test('messages on one frame keep the order they were posted', () => {
    const p = monoProcessor();
    const time = 50 / SAMPLE_RATE;
    p.port.send({ type: 'keyOff', data: [0, 60, 0], time });
    p.port.send({ type: 'keyOn', data: [0, 60, 100], time });
    p.render();
    assert.deepEqual(
        p.dsp.notes.map((n) => n.type),
        ['keyOff', 'keyOn'],
        'a keyOn sorted ahead of the keyOff before it would leave a voice on'
    );
});

test('messages posted out of order are applied in time order', () => {
    const p = monoProcessor();
    p.port.send({ type: 'keyOn', data: [0, 62, 100], time: 90 / SAMPLE_RATE });
    p.port.send({ type: 'keyOn', data: [0, 60, 100], time: 10 / SAMPLE_RATE });
    const events = p.render();
    assert.deepEqual(
        events.map((e) => e.frame),
        [10, 90]
    );
    assert.deepEqual(
        p.dsp.notes.map((n) => n.pitch),
        [60, 62]
    );
});

test('automation goes before a message on the same frame', () => {
    const p = monoProcessor();
    p.port.send({ type: 'keyOn', data: [0, 60, 100], frame: 40 });
    const events = p.render({ [GATE]: step(0, 1, 40) });
    assert.deepEqual(
        events.map((e) => e.frame),
        [40, 40]
    );
    assert.equal(events[0].seq, -1, 'the block starts from the automation');
    assert.ok(events[1].seq >= 0);
});

test('the events of a block always tile it exactly', () => {
    const p = monoProcessor();
    p.port.send({ type: 'keyOn', data: [0, 60, 100], frame: 0 });
    p.port.send({ type: 'keyOn', data: [0, 62, 100], frame: 60 });
    p.port.send({ type: 'keyOff', data: [0, 60, 0], frame: 60 });
    p.port.send({ type: 'keyOff', data: [0, 62, 0], frame: BLOCK - 1 });
    p.render({ [GATE]: step(0, 1, 60) });
    // The fake DSP renders through the real `renderBlock`, so this is what the
    // wasm calls would have been.
    const parts = p.dsp.slices[0];
    assert.deepEqual(parts, [
        [0, 60],
        [60, 67],
        [127, 1]
    ]);
    assert.equal(
        parts.reduce((n, [, count]) => n + count, 0),
        BLOCK
    );
});

test('automation and messages interleave by frame', () => {
    const p = monoProcessor();
    p.port.send({ type: 'keyOn', data: [0, 60, 100], frame: 20 });
    p.port.send({ type: 'keyOn', data: [0, 62, 100], frame: 100 });
    const events = p.render({ [GATE]: step(0, 1, 60) });
    assert.deepEqual(
        events.map((e) => e.frame),
        [20, 60, 100]
    );
});
