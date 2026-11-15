/**
 * When a released voice gives its slot back.
 *
 * A voice whose note was released keeps being computed until its level falls
 * under a threshold, then it is freed. The threshold used to be a constant,
 * -90 dB. It is now the last argument of the `FaustPolyWebAudioDsp`
 * constructor, so that a host that considers a higher level inaudible can get
 * the CPU back sooner.
 *
 * The level of a voice is what the mixer returns for it, so the mixer here is
 * a fake that returns a number the test chooses: the questions asked are about
 * the comparison and about which values of the threshold are accepted, not
 * about audio.
 *
 * Port of faust PR #1394 (`stoplevel` of `mydsp_poly` in the C++ poly-dsp.h,
 * wy2lam), with the same accepted range: ]0, 0.01], anything else falls back
 * to the default.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    FaustPolyWebAudioDsp,
    FaustWebAudioDspVoice
} from '../../dist/esm/index.js';

const BLOCK = 128;

/** -80 dB: above the default threshold, under any of the higher ones used here. */
const QUIET = 0.0001;

/**
 * A one voice polyphonic DSP whose voice has the level the test sets.
 *
 * @param {unknown[]} stopLevel - the constructor argument, when given. An
 * array so that "left out" and "given as undefined" are two different calls.
 */
function polyDsp(...stopLevel) {
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
    const inertApi = {
        init: () => {},
        instanceInit: () => {},
        instanceClear: () => {},
        instanceConstants: () => {},
        instanceResetUserInterface: () => {},
        setParamValue: () => {},
        getParamValue: () => 0,
        compute: () => {},
        getNumInputs: () => 0,
        getNumOutputs: () => 1
    };
    const probe = { level: 1 };
    const instance = {
        memory: new WebAssembly.Memory({ initial: 1 }),
        voices: 1,
        voiceAPI: inertApi,
        effectAPI: undefined,
        effectJSON: undefined,
        mixerAPI: {
            clearOutput: () => {},
            mixCheckVoice: () => probe.level,
            fadeOut: () => {}
        },
        voiceJSON: JSON.stringify(meta)
    };
    // Typed loosely on purpose: the values refused below are not numbers
    /** @type {any} */
    const args = [instance, 48000, 4, BLOCK, {}, ...stopLevel];
    const dsp = new FaustPolyWebAudioDsp(
        .../** @type {ConstructorParameters<typeof FaustPolyWebAudioDsp>} */ (
            args
        )
    );
    return { dsp, probe };
}

/** Run `fn` with `console.warn` captured, return it with what was printed. */
function captureWarnings(fn) {
    /** @type {string[]} */
    const warnings = [];
    const warn = console.warn;
    console.warn = (...args) => warnings.push(args.map(String).join(' '));
    try {
        return { result: fn(), warnings };
    } finally {
        console.warn = warn;
    }
}

/**
 * Play a note, release it, and render one block with the voice at `level`.
 *
 * @returns {number} the voices still counted after that block: 1 when the
 * voice is kept, 0 when it was freed.
 */
function voicesAfterRelease({ dsp, probe }, level) {
    const out = [new Float32Array(BLOCK)];
    dsp.start();
    probe.level = 1;
    dsp.keyOn(0, 60, 100);
    dsp.compute([], out);
    assert.equal(dsp.getNumActiveVoices(), 1, 'the note is playing');
    dsp.keyOff(0, 60, 0);
    dsp.compute([], out);
    assert.equal(dsp.getNumActiveVoices(), 1, 'a loud release is kept');
    probe.level = level;
    dsp.compute([], out);
    return dsp.getNumActiveVoices();
}

test('the default threshold is -90 dB', () => {
    const def = FaustWebAudioDspVoice.VOICE_STOP_LEVEL;
    assert.equal(def, 0.00003162);
    assert.equal(voicesAfterRelease(polyDsp(), def * 1.01), 1, 'just above');
    assert.equal(voicesAfterRelease(polyDsp(), def * 0.99), 0, 'just under');
    // The level itself is not under it
    assert.equal(voicesAfterRelease(polyDsp(), def), 1, 'on the threshold');
});

test('a higher threshold frees the voice sooner', () => {
    // -80 dB: kept by default, freed with a -60 dB threshold
    assert.equal(voicesAfterRelease(polyDsp(), QUIET), 1, 'default');
    assert.equal(voicesAfterRelease(polyDsp(0.001), QUIET), 0, '-60 dB');
    // and a voice above the threshold given is still kept
    assert.equal(voicesAfterRelease(polyDsp(0.001), 0.002), 1, 'above -60 dB');
});

test('a lower threshold keeps the voice longer', () => {
    // -100 dB: freed by default, kept with a -110 dB threshold
    assert.equal(voicesAfterRelease(polyDsp(), 0.00001), 0, 'default');
    assert.equal(
        voicesAfterRelease(polyDsp(0.000003162), 0.00001),
        1,
        '-110 dB'
    );
});

test('-40 dB is the highest threshold accepted, itself included', () => {
    const { result: made, warnings } = captureWarnings(() => polyDsp(0.01));
    assert.deepEqual(warnings, [], '0.01 is accepted without a warning');
    assert.equal(voicesAfterRelease(made, 0.005), 0, 'freed under 0.01');
});

test('a threshold left out, or undefined, is the default without a warning', () => {
    for (const args of [[], [undefined]]) {
        const { result: made, warnings } = captureWarnings(() =>
            polyDsp(...args)
        );
        assert.deepEqual(warnings, [], `no warning for (${args})`);
        assert.equal(voicesAfterRelease(made, QUIET), 1);
    }
});

test('an invalid threshold is refused with a warning, and the default is used', () => {
    // Above -40 dB, null or negative, not finite, not a number at all
    const invalid = [0.011, 0.5, 0, -0.001, NaN, Infinity, null, '0.001'];
    for (const value of invalid) {
        const { result: made, warnings } = captureWarnings(() =>
            polyDsp(value)
        );
        assert.equal(warnings.length, 1, `one warning for ${String(value)}`);
        assert.match(warnings[0], /Invalid stop level/);
        // -80 dB is kept: the threshold is -90 dB, not the value given
        assert.equal(
            voicesAfterRelease(made, QUIET),
            1,
            `${String(value)} is not used`
        );
        // and the default still frees what it should
        const { result: again } = captureWarnings(() => polyDsp(value));
        assert.equal(voicesAfterRelease(again, 0.00003), 0);
    }
});
