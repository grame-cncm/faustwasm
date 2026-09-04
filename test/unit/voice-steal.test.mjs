/**
 * Which voice a full pool gives up.
 *
 * When every voice is busy and a new note arrives, the allocator must steal
 * the voice whose note has been held the longest. That is a question about
 * *when each voice was allocated*, so `allocVoice` stamps the voice with one
 * global monotonic date. It used to increment the voice's own `fDate`
 * instead -- a per-slot reuse counter: notes played and released before a
 * chord kept reusing slot 0 and inflating only its date, and when the chord
 * then overflowed the pool, the allocator considered a younger note "oldest"
 * and stole the wrong one.
 *
 * Port of the C++ fix and reproducer (faust commit cc0acf83, PR #1284,
 * Timothy Sikes) to `FaustPolyWebAudioDsp`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    FaustPolyWebAudioDsp,
    FaustWebAudioDspVoice
} from '../../dist/esm/index.js';

const VOICES = 4;

/**
 * A polyphonic DSP over a wasm instance that does nothing.
 *
 * Allocation order is decided entirely in JavaScript -- `keyOn`, `keyOff`,
 * `getFreeVoice` -- so the voice API can be inert and the memory empty. The
 * UI declares the `freq`/`gain`/`gate` controls a voice looks up by suffix.
 */
function polyDsp() {
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
    const instance = {
        memory: new WebAssembly.Memory({ initial: 1 }),
        voices: VOICES,
        voiceAPI: inertApi,
        effectAPI: undefined,
        effectJSON: undefined,
        mixerAPI: {
            clearOutput: () => {},
            mixCheckVoice: () => 0,
            fadeOut: () => {}
        },
        voiceJSON: JSON.stringify(meta)
    };
    return new FaustPolyWebAudioDsp(instance, 48000, 4, 128, []);
}

/** The note each voice slot holds, `kLegatoVoice` slots by the note leaving. */
const notes = (dsp) => dsp.fVoiceTable.map((voice) => voice.fCurNote);

/**
 * Let a released voice's tail die away.
 *
 * In the real thing `compute` frees a released voice once its level stays
 * under the threshold for a block; these tests never render, so the freeing
 * is done by hand.
 */
function fadeOut(dsp, pitch) {
    dsp.keyOff(0, pitch, 0);
    dsp.fVoiceTable.forEach((voice) => {
        if (voice.fCurNote === FaustWebAudioDspVoice.kReleaseVoice)
            voice.fCurNote = FaustWebAudioDspVoice.kFreeVoice;
    });
}

test('a full pool steals the note held the longest', () => {
    const dsp = polyDsp();
    for (const pitch of [60, 63, 65, 68]) dsp.keyOn(0, pitch, 100);
    const held = notes(dsp);

    dsp.keyOn(0, 70, 100);

    const stolen = notes(dsp).indexOf(FaustWebAudioDspVoice.kLegatoVoice);
    assert.notEqual(stolen, -1, 'a voice was stolen');
    assert.equal(held[stolen], 60, 'the first note of the chord goes');
    assert.equal(dsp.fVoiceTable[stolen].fNextNote, 70);
});

test('notes played before the chord do not change which voice goes', () => {
    const dsp = polyDsp();
    // Play and release a few notes first. Each one lands in slot 0 and lets
    // it go again; with a per-slot date this inflated slot 0's date alone,
    // and the chord's second note then looked "oldest" and was stolen.
    for (let i = 0; i < 3; i++) {
        dsp.keyOn(0, 50, 100);
        fadeOut(dsp, 50);
    }
    for (const pitch of [60, 63, 65, 68]) dsp.keyOn(0, pitch, 100);
    const held = notes(dsp);

    dsp.keyOn(0, 70, 100);

    const stolen = notes(dsp).indexOf(FaustWebAudioDspVoice.kLegatoVoice);
    assert.notEqual(stolen, -1, 'a voice was stolen');
    assert.equal(
        held[stolen],
        60,
        'still the note held the longest, not the slot reused the least'
    );
});

test('a voice in release is stolen before any playing voice', () => {
    const dsp = polyDsp();
    for (const pitch of [60, 63, 65, 68]) dsp.keyOn(0, pitch, 100);
    // 65 is released but still sounding its tail: it goes first, even though
    // 60 and 63 were allocated earlier.
    dsp.keyOff(0, 65, 0);
    const held = notes(dsp);

    dsp.keyOn(0, 70, 100);

    const stolen = notes(dsp).indexOf(FaustWebAudioDspVoice.kLegatoVoice);
    assert.equal(held[stolen], FaustWebAudioDspVoice.kReleaseVoice);
    assert.equal(dsp.fVoiceTable[stolen].fNextNote, 70);
});
