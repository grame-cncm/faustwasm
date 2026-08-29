/**
 * What the processor hands `compute` for a block.
 *
 * `collectEvents` merges two sources: the automation an `AudioParam` gives
 * `process`, and the port messages timestamped for a frame inside the block.
 * These tests are about the frames -- a step at 40 becoming an event at 40
 * rather than 0, a `1 -> 0 -> 1` inside one block becoming two edges rather
 * than none, a message for a later block waiting for it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { monoProcessor, BLOCK, SAMPLE_RATE } from './harness.mjs';

const GATE = '/probe/gate';
const VOL = '/probe/vol';

/** The frames a block's events landed on. */
const frames = (events) => events.map((e) => e.frame);

/** A block of automation: `from` up to frame `at`, `value` from there on. */
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
    assert.deepEqual(frames(p.render({ [VOL]: 0.25 })), [0]);
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
    assert.deepEqual(frames(p.render({ [GATE]: step(0, 1, 40) })), [40]);
    assert.deepEqual(p.dsp.writes, [{ path: GATE, value: 1 }]);
});

test('1 -> 0 -> 1 inside one block is two edges, not none', () => {
    const p = monoProcessor();
    // The gate is up when the block starts, drops at 60, returns at 70.
    // Reading only frame 0 sees 1, matches the cached 1, and misses the drop
    // entirely -- the hit that never retriggers.
    p.render({ [GATE]: 1 });
    const automation = Array.from({ length: BLOCK }, (_, i) =>
        i >= 60 && i < 70 ? 0 : 1
    );
    assert.deepEqual(frames(p.render({ [GATE]: automation })), [60, 70]);
    assert.deepEqual(p.dsp.writes.slice(1), [
        { path: GATE, value: 0 },
        { path: GATE, value: 1 }
    ]);
});

test('a handful of steps in one block are all kept', () => {
    const p = monoProcessor();
    const at = [3, 17, 40, 41, 90, 127];
    // Starting at 0.5, the control's default, so frame 0 is not a change.
    const automation = Array.from(
        { length: BLOCK },
        (_, i) => 0.5 + at.filter((f) => f <= i).length / 16
    );
    assert.deepEqual(frames(p.render({ [VOL]: automation })), at);
});

test('a ramp is followed coarsely rather than sample by sample', () => {
    const p = monoProcessor();
    // A `linearRampToValueAtTime` across the block: 128 distinct values, no
    // edges. Honouring each would mean 128 one-frame compute calls and 128
    // messages to the main thread, for a slider.
    const events = p.render({
        [VOL]: Array.from({ length: BLOCK }, (_, i) => i / BLOCK)
    });
    assert.ok(
        events.length < BLOCK / 4,
        `${events.length} events for a ramp is still a per-sample walk`
    );
    assert.ok(events.length > 1, 'a ramp is still followed inside the block');
    assert.equal(events[0].frame, 0);
});

test('a ramp still leaves the DSP holding the value the block ended on', () => {
    const p = monoProcessor();
    const ramp = Array.from({ length: BLOCK }, (_, i) => i / BLOCK);
    p.render({ [VOL]: ramp });
    assert.equal(p.dsp.writes.at(-1).value, ramp[BLOCK - 1]);
    // That is what the next block compares against, so a block holding the
    // value the ramp reached produces no events.
    assert.deepEqual(p.render({ [VOL]: ramp[BLOCK - 1] }), []);
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

test('a frame is on the audio clock, not on the block', () => {
    const p = monoProcessor();
    p.render();
    p.render();
    // Two blocks in, so absolute and block-relative readings differ and this
    // pins down which one `frame` means.
    assert.equal(p.frame, 2 * BLOCK);
    p.port.send({ type: 'keyOn', data: [0, 60, 100], frame: 2 * BLOCK + 77 });
    assert.equal(p.render()[0].frame, 77);
});

test('a fractional frame is rounded to a whole one', () => {
    const p = monoProcessor();
    p.port.send({ type: 'keyOn', data: [0, 60, 100], frame: 40.6 });
    assert.equal(p.render()[0].frame, 41);
});

test('a time that is not a number is refused rather than queued', () => {
    const p = monoProcessor();
    for (const time of [NaN, Infinity, -Infinity, '40', null]) {
        p.port.send({ type: 'keyOn', data: [0, 99, 100], time });
    }
    // A NaN compares false against every frame, so a queued one would stay at
    // the head of the queue and block everything behind it.
    p.port.send({ type: 'keyOn', data: [0, 60, 100], frame: 20 });
    const events = p.render();
    assert.equal(events.length, 1);
    assert.equal(events[0].frame, 20);
    assert.deepEqual(
        p.dsp.notes.map((n) => n.pitch),
        [99, 99, 99, 99, 99, 60],
        'the unusable timestamps are treated as untimed, and applied on arrival'
    );
});

test('two overdue messages are applied in time order, not post order', () => {
    const p = monoProcessor();
    p.render();
    p.render();
    // Both belong to a block that has passed, and are posted late and out of
    // order. They collapse onto frame 0, where only the tie-break separates
    // them.
    p.port.send({ type: 'keyOn', data: [0, 62, 100], frame: 100 });
    p.port.send({ type: 'keyOn', data: [0, 60, 100], frame: 10 });
    p.render();
    assert.deepEqual(
        p.dsp.notes.map((n) => n.pitch),
        [60, 62],
        'the same order they would have played in if they had been on time'
    );
});

test('a panic cancels what has been scheduled and not yet played', () => {
    const p = monoProcessor();
    p.port.send({ type: 'keyOn', data: [0, 60, 100], frame: 4 * BLOCK });
    // All notes off, arriving now.
    p.port.send({ type: 'ctrlChange', data: [0, 123, 0] });
    for (let i = 0; i < 6; i++) p.render();
    assert.deepEqual(p.dsp.notes, [], 'the queued note never played');
    assert.deepEqual(p.dsp.midi, [
        { type: 'ctrlChange', channel: 0, ctrl: 123, value: 0 }
    ]);
});

test('a stop clears what was scheduled for the stretch it stopped', () => {
    const p = monoProcessor();
    p.port.send({ type: 'keyOn', data: [0, 60, 100], frame: 4 * BLOCK });
    p.port.send({ type: 'stop' });
    for (let i = 0; i < 6; i++) p.render();
    assert.deepEqual(p.dsp.notes, []);
});

test('a message that throws costs that message and nothing else', () => {
    const p = monoProcessor();
    // Per the Web Audio spec, a `process` that throws fires processorerror
    // and is never called again, so one bad message would silence the node
    // permanently.
    p.dsp.keyOn = (channel, pitch) => {
        if (pitch === 99) throw new Error('no such voice');
        p.dsp.notes.push({ type: 'keyOn', channel, pitch });
    };
    const errors = [];
    const reported = console.error;
    console.error = (...args) => errors.push(args);
    try {
        p.port.send({ type: 'keyOn', data: [0, 99, 100], frame: 10 });
        p.port.send({ type: 'keyOn', data: [0, 60, 100], frame: 20 });
        assert.doesNotThrow(() => p.render());
    } finally {
        console.error = reported;
    }
    assert.deepEqual(
        p.dsp.notes.map((n) => n.pitch),
        [60],
        'the message after the bad one still played'
    );
    assert.equal(errors.length, 1, 'and the failure was reported');
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
    assert.deepEqual(frames(events), [10, 90]);
    assert.deepEqual(
        p.dsp.notes.map((n) => n.pitch),
        [60, 62]
    );
});

test('automation goes before a message on the same frame', () => {
    const p = monoProcessor();
    const order = [];
    p.dsp.setParamValue = () => order.push('automation');
    p.dsp.keyOn = () => order.push('message');
    p.port.send({ type: 'keyOn', data: [0, 60, 100], frame: 40 });
    assert.deepEqual(frames(p.render({ [GATE]: step(0, 1, 40) })), [40, 40]);
    assert.deepEqual(
        order,
        ['automation', 'message'],
        'the automation is the state the block starts from'
    );
});

test('the events of a block always tile it exactly', () => {
    const p = monoProcessor();
    p.port.send({ type: 'keyOn', data: [0, 60, 100], frame: 0 });
    p.port.send({ type: 'keyOn', data: [0, 62, 100], frame: 60 });
    p.port.send({ type: 'keyOff', data: [0, 60, 0], frame: 60 });
    p.port.send({ type: 'keyOff', data: [0, 62, 0], frame: BLOCK - 1 });
    p.render({ [GATE]: step(0, 1, 60) });
    // The fake DSP goes through the real `renderBlock`, so these are the wasm
    // calls that would have been made.
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
    assert.deepEqual(frames(events), [20, 60, 100]);
});

test('a timed panic cancels the notes later in its own block', () => {
    const p = monoProcessor();
    p.port.send({ type: 'keyOn', data: [0, 60, 100], frame: 20 });
    p.port.send({ type: 'ctrlChange', data: [0, 123, 0], frame: 40 });
    p.port.send({ type: 'keyOn', data: [0, 62, 100], frame: 100 });
    p.port.send({ type: 'keyOn', data: [0, 64, 100], frame: 3 * BLOCK });
    p.render();
    assert.deepEqual(
        p.dsp.notes.map((n) => n.pitch),
        [60],
        'the note before it played, the ones after it did not'
    );
    for (let i = 0; i < 4; i++) p.render();
    assert.deepEqual(
        p.dsp.notes.map((n) => n.pitch),
        [60],
        'and the one in a later block is gone too'
    );
});

test('a panic does not cancel the automation around it', () => {
    const p = monoProcessor();
    p.port.send({ type: 'ctrlChange', data: [0, 123, 0], frame: 40 });
    p.render({ [VOL]: step(0.5, 0.25, 90) });
    assert.deepEqual(
        p.dsp.writes,
        [{ path: VOL, value: 0.25 }],
        'a filter sweep is not a note waiting to sound'
    );
});

test('only the controllers that silence the instrument flush', () => {
    // 120 (all sound off) and 123 (all notes off) are the two the polyphonic
    // DSP itself treats as all-notes-off. 121 resets controllers without
    // ending a note; 122 is a keyboard's local control.
    for (const [ctrl, expected] of [
        [120, []],
        [121, [60]],
        [122, [60]],
        [123, []]
    ]) {
        const p = monoProcessor();
        p.port.send({ type: 'ctrlChange', data: [0, ctrl, 0], frame: 10 });
        p.port.send({ type: 'keyOn', data: [0, 60, 100], frame: 50 });
        p.render();
        assert.deepEqual(
            p.dsp.notes.map((n) => n.pitch),
            expected,
            `controller ${ctrl}`
        );
    }
});

// The WAM path had its own way of losing a note: `setupWamEventHandler`
// installed a handler that called `midiMessage` directly and dropped the
// event's time, so anything routed through Web Audio Modules landed at the top
// of whichever block it was processed in -- the scatter this whole branch
// exists to remove, still there on the one route that was not a port message.
test('a WAM MIDI event is applied on the frame it carries', () => {
    const p = monoProcessor({ wamInfo: true });
    p.port.send({ type: 'setupWamEventHandler' });
    assert.equal(
        typeof p.wam.handleEvent,
        'function',
        'the handler is installed'
    );

    p.wam.handleEvent({
        type: 'wam-midi',
        // WamEvent.time is AudioContext seconds, the same clock as a port
        // message's, so it belongs in the same queue.
        time: 55 / SAMPLE_RATE,
        data: { bytes: [144, 60, 100] }
    });
    assert.deepEqual(p.dsp.midi, [], 'not applied on arrival');
    assert.deepEqual(frames(p.render()), [55]);
    assert.deepEqual(p.dsp.midi, [{ type: 'midi', data: [144, 60, 100] }]);
});

test('a WAM MIDI event with no time is applied on arrival', () => {
    const p = monoProcessor({ wamInfo: true });
    p.port.send({ type: 'setupWamEventHandler' });
    p.wam.handleEvent({ type: 'wam-midi', data: { bytes: [144, 60, 100] } });
    assert.deepEqual(p.dsp.midi, [{ type: 'midi', data: [144, 60, 100] }]);
    assert.deepEqual(p.render(), []);
});
