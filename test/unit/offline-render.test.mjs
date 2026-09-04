/**
 * How the offline processor feeds a DSP.
 *
 * `render` turns "give me N frames" into a series of `compute` calls of at
 * most `bufferSize`, slicing the caller's input to match. The slicing has
 * three cases -- the block sits inside the input, straddles its end, or starts
 * past it -- and a fourth when a channel was not supplied at all. None of them
 * touches wasm, so they run here against a DSP that only records what it was
 * handed.
 *
 * This is the path behind `faust2sndfile`, including its `-in` mode, where
 * getting a slice wrong means silence or a repeated fragment in the rendered
 * file rather than an error.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FaustOfflineProcessor } from '../../dist/esm/index.js';

const BUFFER = 8;

/**
 * A DSP that copies its input to its output and remembers the calls.
 *
 * `render` needs only these five methods off the DSP, so a plain object
 * standing in for one keeps the test about the slicing and nothing else.
 *
 * @param {number} inputs
 * @param {number} outputs
 */
const recorder = (inputs, outputs) => {
    const calls = [];
    return {
        calls,
        started: 0,
        stopped: 0,
        getNumInputs: () => inputs,
        getNumOutputs: () => outputs,
        start() {
            this.started += 1;
        },
        stop() {
            this.stopped += 1;
        },
        compute(ins, outs) {
            // Copy what came in, since the processor reuses its buffers.
            calls.push(ins.map((channel) => Array.from(channel)));
            for (let ch = 0; ch < outs.length; ch += 1) {
                const source = ins[0];
                for (let i = 0; i < outs[ch].length; i += 1) {
                    outs[ch][i] = source ? (source[i] ?? 0) : 0;
                }
            }
        }
    };
};

/** A processor over a recording DSP. */
const processor = (dsp, bufferSize = BUFFER) =>
    new FaustOfflineProcessor(dsp, bufferSize);

/** 1, 2, 3, ... as a Float32Array, so every frame is recognisable. */
const counting = (length, from = 1) =>
    Float32Array.from({ length }, (_, i) => from + i);

test('a length equal to the buffer size is one call', () => {
    const dsp = recorder(0, 1);
    const out = processor(dsp).render([], BUFFER);
    assert.equal(dsp.calls.length, 1);
    assert.equal(out[0].length, BUFFER);
});

test('a longer length is split into whole buffers', () => {
    const dsp = recorder(0, 1);
    processor(dsp).render([], BUFFER * 4);
    assert.equal(dsp.calls.length, 4);
});

test('a length that is not a multiple of the buffer ends on a short slice', () => {
    const dsp = recorder(1, 1);
    const out = processor(dsp).render([counting(20)], 20);
    // 20 frames at a buffer of 8: 8 + 8 + 4.
    assert.equal(dsp.calls.length, 3);
    assert.equal(dsp.calls[2][0].length, 4);
    assert.equal(out[0].length, 20);
});

test('a length shorter than the buffer renders just that many frames', () => {
    const dsp = recorder(1, 1);
    const out = processor(dsp).render([counting(3)], 3);
    assert.equal(dsp.calls.length, 1);
    assert.equal(out[0].length, 3);
    assert.deepEqual(Array.from(out[0]), [1, 2, 3]);
});

test('the DSP is started and stopped around the render', () => {
    const dsp = recorder(0, 1);
    const p = processor(dsp);
    assert.equal(dsp.started, 0);
    p.render([], BUFFER);
    // Rendering activates the DSP itself, so a caller does not have to.
    assert.equal(dsp.started, 1);
    assert.equal(dsp.stopped, 1);
});

test('the output has one channel per DSP output', () => {
    const dsp = recorder(1, 3);
    const out = processor(dsp).render([counting(BUFFER)], BUFFER);
    assert.equal(out.length, 3);
    for (const channel of out) assert.equal(channel.length, BUFFER);
});

test('the input reaches the DSP in order, frame for frame', () => {
    const dsp = recorder(1, 1);
    const input = counting(BUFFER * 3);
    processor(dsp).render([input], BUFFER * 3);
    assert.deepEqual(dsp.calls[0][0], [1, 2, 3, 4, 5, 6, 7, 8]);
    assert.deepEqual(dsp.calls[1][0], [9, 10, 11, 12, 13, 14, 15, 16]);
    assert.deepEqual(dsp.calls[2][0], [17, 18, 19, 20, 21, 22, 23, 24]);
});

test('an input shorter than the render is followed by silence', () => {
    const dsp = recorder(1, 1);
    // Four frames of signal, three buffers asked for.
    const out = processor(dsp).render([counting(4)], BUFFER * 3);
    // First block straddles the end of the input: only what exists is passed.
    assert.deepEqual(dsp.calls[0][0], [1, 2, 3, 4]);
    // The blocks past the end get a zero-filled buffer, not the tail again.
    assert.deepEqual(dsp.calls[1][0], new Array(BUFFER).fill(0));
    assert.deepEqual(dsp.calls[2][0], new Array(BUFFER).fill(0));
    assert.equal(out[0].length, BUFFER * 3);
});

test('an input longer than the render is cut, not wrapped', () => {
    const dsp = recorder(1, 1);
    processor(dsp).render([counting(1000)], BUFFER);
    assert.equal(dsp.calls.length, 1);
    assert.deepEqual(dsp.calls[0][0], [1, 2, 3, 4, 5, 6, 7, 8]);
});

test('an input ending exactly on a block boundary is not read past', () => {
    const dsp = recorder(1, 1);
    processor(dsp).render([counting(BUFFER)], BUFFER * 2);
    assert.deepEqual(dsp.calls[0][0], [1, 2, 3, 4, 5, 6, 7, 8]);
    // The input ran out exactly here; the next block is silence.
    assert.deepEqual(dsp.calls[1][0], new Array(BUFFER).fill(0));
});

test('a missing input channel is fed silence', () => {
    const dsp = recorder(2, 1);
    // Only the first of the DSP's two inputs is supplied.
    processor(dsp).render([counting(BUFFER)], BUFFER);
    assert.deepEqual(dsp.calls[0][0], [1, 2, 3, 4, 5, 6, 7, 8]);
    assert.deepEqual(dsp.calls[0][1], new Array(BUFFER).fill(0));
});

test('no input at all is silence, not a crash', () => {
    const dsp = recorder(2, 2);
    const out = processor(dsp).render([], BUFFER * 2);
    for (const call of dsp.calls) {
        for (const channel of call) {
            assert.deepEqual(channel, new Array(BUFFER).fill(0));
        }
    }
    assert.equal(out[0].length, BUFFER * 2);
});

test('a DSP with no inputs is handed nothing', () => {
    const dsp = recorder(0, 1);
    processor(dsp).render([counting(BUFFER)], BUFFER);
    // The extra channel offered by the caller is ignored, not forced in.
    assert.equal(dsp.calls[0].length, 0);
});

test('onUpdate reports the running frame count, ending at the total', () => {
    const dsp = recorder(0, 1);
    const seen = [];
    processor(dsp).render([], 20, (sample) => seen.push(sample));
    // One callback per computed block, carrying frames done so far.
    assert.deepEqual(seen, [8, 16, 20]);
});

test('onUpdate is optional', () => {
    const dsp = recorder(0, 1);
    assert.doesNotThrow(() => processor(dsp).render([], BUFFER));
});

test('the rendered output is the DSP output, block after block', () => {
    const dsp = recorder(1, 1);
    const out = processor(dsp).render([counting(20)], 20);
    // The recorder copies input to output, so the render must come back as
    // the input did: contiguous, in order, including the short last block.
    assert.deepEqual(Array.from(out[0]), Array.from(counting(20)));
});

test('rendering twice does not carry the first render into the second', () => {
    const dsp = recorder(1, 1);
    const p = processor(dsp);
    p.render([counting(BUFFER)], BUFFER);
    const second = p.render([], BUFFER);
    // The processor reuses its buffers between calls; a stale one would show
    // up here as the previous input coming back out.
    assert.deepEqual(Array.from(second[0]), new Array(BUFFER).fill(0));
});
