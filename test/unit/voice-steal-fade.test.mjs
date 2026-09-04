/**
 * The hand-over on a stolen voice fades in as well as out.
 *
 * `renderStolenVoices` plays the outgoing note over the first half of the
 * block and fades that half out through the mixer. The new note then plays
 * the second half from the DSP's live state -- `keyOn` does not reset a
 * voice, and an envelope that never reached silence is still up -- so that
 * half has to be faded in too, or every stolen note starts with a step.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FaustPolyWebAudioDsp } from '../../dist/esm/index.js';

const BLOCK = 128;

/**
 * A polyphonic DSP whose single voice renders a constant 1.
 *
 * The mixer is inert -- `fadeOut` is the wasm side's business -- so what
 * ends up in the mixing buffer is the voice's output shaped only by the
 * JavaScript side of the hand-over.
 */
function polyDsp(block = BLOCK) {
    const memory = new WebAssembly.Memory({ initial: 1 });
    const meta = {
        name: 'probe',
        inputs: 0,
        outputs: 1,
        size: 8,
        ui: [
            {
                type: 'vgroup',
                label: 'probe',
                items: [
                    {
                        type: 'hslider',
                        label: 'freq',
                        address: '/probe/freq',
                        index: 0,
                        init: 440,
                        min: 20,
                        max: 2000,
                        step: 1
                    },
                    {
                        type: 'hslider',
                        label: 'gain',
                        address: '/probe/gain',
                        index: 4,
                        init: 0.5,
                        min: 0,
                        max: 1,
                        step: 0.01
                    },
                    {
                        type: 'button',
                        label: 'gate',
                        address: '/probe/gate',
                        index: 8
                    }
                ]
            }
        ]
    };
    const voiceAPI = {
        init: () => {},
        instanceInit: () => {},
        instanceClear: () => {},
        instanceConstants: () => {},
        instanceResetUserInterface: () => {},
        setParamValue: () => {},
        getParamValue: () => 0,
        compute: (dsp, count, $inputs, $outputs) => {
            const HEAP32 = new Int32Array(memory.buffer);
            const HEAPF = new Float32Array(memory.buffer);
            const start = HEAP32[$outputs >> 2] >> 2;
            for (let i = 0; i < count; i++) HEAPF[start + i] = 1;
        },
        getNumInputs: () => 0,
        getNumOutputs: () => 1
    };
    const instance = {
        memory,
        voices: 1,
        voiceAPI,
        effectAPI: undefined,
        effectJSON: undefined,
        mixerAPI: {
            clearOutput: () => {},
            mixCheckVoice: () => 1,
            fadeOut: () => {}
        },
        voiceJSON: JSON.stringify(meta)
    };
    const dsp = new FaustPolyWebAudioDsp(
        /** @type {any} */ (instance),
        48000,
        4,
        block,
        {}
    );
    return { dsp, memory };
}

/** The mixing buffer of channel 0 after a block. */
function mixing(dsp, memory, block = BLOCK) {
    const HEAP32 = new Int32Array(memory.buffer);
    const HEAPF = new Float32Array(memory.buffer);
    const start = HEAP32[dsp.fAudioMixing >> 2] >> 2;
    return Array.from(HEAPF.subarray(start, start + block));
}

test('the second half of a stolen block fades in from 1/count', () => {
    const { dsp, memory } = polyDsp();
    dsp.start();
    const out = [new Float32Array(BLOCK)];
    dsp.keyOn(0, 60, 100);
    dsp.compute([], out);
    // The pool has one voice, so the next note steals it.
    dsp.keyOn(0, 67, 100);
    dsp.compute([], out);

    const half = BLOCK >> 1;
    const buf = mixing(dsp, memory);
    // First half: the outgoing note, left to the mixer's fadeOut (inert here).
    assert.ok(
        buf.slice(0, half).every((v) => v === 1),
        'first half untouched by the JS side'
    );
    // Second half: a ramp from 1/64 to 1, the mirror of fadeOut.
    const ramp = buf.slice(half);
    assert.equal(ramp.length, BLOCK - half);
    assert.ok(
        Math.abs(ramp[0] - 1 / ramp.length) < 1e-6,
        `starts at 1/count, got ${ramp[0]}`
    );
    assert.equal(ramp[ramp.length - 1], 1, 'ends at 1');
    for (let i = 1; i < ramp.length; i++) {
        assert.ok(ramp[i] > ramp[i - 1], `rises at frame ${i}`);
    }
});

test('an odd block gives the extra frame to the second half, and the ramp covers it', () => {
    const block = 127;
    const { dsp, memory } = polyDsp(block);
    dsp.start();
    const out = [new Float32Array(block)];
    dsp.keyOn(0, 60, 100);
    dsp.compute([], out);
    dsp.keyOn(0, 67, 100);
    dsp.compute([], out);

    // computeLegato splits at count >> 1 = 63 and renders the remaining 64
    // frames as the second half; the fade-in is measured from the split.
    const half = block >> 1;
    const buf = mixing(dsp, memory, block);
    assert.ok(
        buf.slice(0, half).every((v) => v === 1),
        'first half untouched by the JS side'
    );
    const ramp = buf.slice(half);
    assert.equal(ramp.length, block - half);
    assert.ok(
        Math.abs(ramp[0] - 1 / ramp.length) < 1e-6,
        `starts at 1/count, got ${ramp[0]}`
    );
    assert.equal(
        ramp[ramp.length - 1],
        1,
        'ends at 1 on the last frame of the block'
    );
    for (let i = 1; i < ramp.length; i++) {
        assert.ok(ramp[i] > ramp[i - 1], `rises at frame ${i}`);
    }
});

test('a note on a free voice is not faded', () => {
    const { dsp, memory } = polyDsp();
    dsp.start();
    const out = [new Float32Array(BLOCK)];
    dsp.keyOn(0, 60, 100);
    dsp.compute([], out);
    assert.ok(
        mixing(dsp, memory).every((v) => v === 1),
        'no ramp on a fresh voice'
    );
});
