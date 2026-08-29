/**
 * The block slicing itself.
 *
 * `renderBlock` is the whole of what makes a control land on a sample: walk to
 * the frame of the next event, render what came before it, apply it, carry on.
 * It touches no wasm, so the arithmetic is checked here against a `render` that
 * only writes down what it was asked for -- the slices must tile the block
 * exactly, in order, with the events falling between the right ones.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    FaustBaseWebAudioDsp,
    FaustMonoWebAudioDsp,
    FaustPolyWebAudioDsp
} from '../../dist/esm/index.js';

const BLOCK = 128;

/**
 * A DSP that renders nothing.
 *
 * `renderBlock` is `protected` in TypeScript and an ordinary method at
 * runtime; the base class is constructible on its own, and nothing below
 * reaches past it.
 */
function dsp() {
    return new FaustBaseWebAudioDsp(4, BLOCK, {});
}

/** Run a block and return what happened, in order. */
function run(events) {
    const log = [];
    const stamped = events.map((e) => ({
        frame: e.frame,
        apply: () => log.push(`apply:${e.name}`)
    }));
    dsp().renderBlock(stamped, (offset, count) =>
        log.push(`render:${offset}+${count}`)
    );
    return log;
}

/** The slices, as [offset, count] pairs. */
function slices(log) {
    return log
        .filter((l) => l.startsWith('render:'))
        .map((l) => l.slice(7).split('+').map(Number));
}

test('no events renders the block in one call', () => {
    const log = [];
    dsp().renderBlock(undefined, (offset, count) =>
        log.push(`render:${offset}+${count}`)
    );
    assert.deepEqual(log, ['render:0+128']);
});

test('an empty event list renders the block in one call', () => {
    assert.deepEqual(run([]), ['render:0+128']);
});

test('an event splits the block at its frame', () => {
    assert.deepEqual(run([{ frame: 64, name: 'a' }]), [
        'render:0+64',
        'apply:a',
        'render:64+64'
    ]);
});

test('an event on frame 0 is applied before anything is rendered', () => {
    assert.deepEqual(run([{ frame: 0, name: 'a' }]), [
        'apply:a',
        'render:0+128'
    ]);
});

test('an event on the last frame leaves a one-frame slice after it', () => {
    assert.deepEqual(run([{ frame: 127, name: 'a' }]), [
        'render:0+127',
        'apply:a',
        'render:127+1'
    ]);
});

test('two events on one frame do not produce an empty slice', () => {
    assert.deepEqual(
        run([
            { frame: 40, name: 'a' },
            { frame: 40, name: 'b' }
        ]),
        ['render:0+40', 'apply:a', 'apply:b', 'render:40+88']
    );
});

test('events are applied in the order they are given', () => {
    const log = run([
        { frame: 10, name: 'a' },
        { frame: 20, name: 'b' },
        { frame: 30, name: 'c' }
    ]);
    assert.deepEqual(
        log.filter((l) => l.startsWith('apply:')),
        ['apply:a', 'apply:b', 'apply:c']
    );
});

test('the slices tile the block exactly, however many events there are', () => {
    for (const frames of [
        [1],
        [0, 127],
        [5, 5, 5],
        [0, 1, 2, 3, 64, 127],
        Array.from({ length: BLOCK }, (_, i) => i)
    ]) {
        const parts = slices(
            run(frames.map((frame, i) => ({ frame, name: i })))
        );
        let at = 0;
        for (const [offset, count] of parts) {
            assert.equal(offset, at, `slice starts where the last one ended`);
            assert.ok(count > 0, 'no empty slice reaches wasm');
            at += count;
        }
        assert.equal(
            at,
            BLOCK,
            `${frames.length} events still render 128 frames`
        );
    }
});

test('a frame past the end of the block cannot run off it', () => {
    const parts = slices(run([{ frame: 1000, name: 'a' }]));
    assert.deepEqual(parts, [[0, 128]]);
});

test('a negative frame is applied at the top of the block', () => {
    assert.deepEqual(run([{ frame: -5, name: 'a' }]), [
        'apply:a',
        'render:0+128'
    ]);
});

test('applyEvents performs everything, in order, without rendering', () => {
    const log = [];
    const events = ['a', 'b', 'c'].map((name, i) => ({
        frame: i * 10,
        apply: () => log.push(name)
    }));
    dsp().applyEvents(events);
    assert.deepEqual(log, ['a', 'b', 'c']);
    assert.doesNotThrow(() => dsp().applyEvents(undefined));
});

/**
 * A block the DSP declines to render still has to take its control writes.
 *
 * They have already been taken off the processor's queue by the time `compute`
 * sees them, so a `keyOn` dropped here is a note that never sounds and never
 * will -- and the DSP's cached values would go on disagreeing with the host's.
 * The receiver is a bare base DSP, which is all these branches touch --
 * `fFirstCall` aside, since the polyphonic `compute` lays out its wasm memory
 * before it asks whether it is running.
 */
for (const [name, compute] of [
    ['mono', FaustMonoWebAudioDsp.prototype.compute],
    ['poly', FaustPolyWebAudioDsp.prototype.compute]
]) {
    test(`a stopped ${name} DSP still applies the block's events`, () => {
        const log = [];
        const stopped = dsp();
        stopped.fFirstCall = false;
        stopped.stop();
        const result = compute.call(
            stopped,
            [],
            [],
            [{ frame: 0, apply: () => log.push('applied') }]
        );
        assert.equal(result, true, 'and stays in the graph');
        assert.deepEqual(log, ['applied']);
    });

    test(`a destroyed ${name} DSP drops them`, () => {
        const log = [];
        const destroyed = dsp();
        destroyed.fFirstCall = false;
        destroyed.destroy();
        const result = compute.call(
            destroyed,
            [],
            [],
            [{ frame: 0, apply: () => log.push('applied') }]
        );
        assert.equal(result, false);
        assert.deepEqual(log, [], 'which is the point of destroying it');
    });
}
