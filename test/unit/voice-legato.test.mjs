/**
 * The legato split.
 *
 * `computeLegato` can be handed any count, odd ones included. A fractional
 * count reaching wasm is a different number of frames from what the mixer
 * reads, so the two halves must be whole and must add up to what was asked
 * for.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FaustWebAudioDspVoice } from '../../dist/esm/index.js';

const GATE = '/probe/gate';

/**
 * A voice whose wasm only records what it was asked to do.
 *
 * Control writes and renders share one log, so tests can assert on the order
 * between them.
 */
function voice() {
    const log = [];
    const api = {
        init: () => {},
        setParamValue: (dsp, index, value) => log.push(`gate=${value}`),
        compute: (dsp, count, $inputs, $outputs) =>
            log.push(`render:${count}->${$outputs}`)
    };
    const v = new FaustWebAudioDspVoice(0, api, [GATE], { [GATE]: 0 }, 48000);
    v.fNextNote = 60;
    v.fNextVel = 100;
    log.length = 0;
    return { voice: v, log };
}

/** The frame counts of the two renders, in order. */
const counts = (log) =>
    log
        .filter((l) => l.startsWith('render:'))
        .map((l) => +l.slice(7).split('->')[0]);

test('the two halves add up to the count asked for', () => {
    for (const count of [128, 127, 64, 63, 3, 2, 1, 0]) {
        const { voice: v, log } = voice();
        v.computeLegato(count, 0, 100, 200);
        const halves = counts(log);
        assert.equal(halves.length, 2, `${count}: still two halves`);
        assert.equal(
            halves[0] + halves[1],
            count,
            `${count}: no frame rendered twice, none dropped`
        );
        for (const half of halves) {
            assert.ok(Number.isInteger(half), `${count}: whole frames`);
            assert.ok(half >= 0, `${count}: no negative count`);
        }
    }
});

test('an odd count gives the extra frame to the second half', () => {
    const { voice: v, log } = voice();
    v.computeLegato(127, 0, 100, 200);
    assert.deepEqual(counts(log), [63, 64]);
});

test('the first half renders at the slice, the second at the split', () => {
    const { voice: v, log } = voice();
    v.computeLegato(128, 0, 100, 200);
    assert.deepEqual(
        log.filter((l) => l.startsWith('render:')),
        ['render:64->100', 'render:64->200']
    );
});

test('the note being replaced ends before the new one starts', () => {
    const { voice: v, log } = voice();
    v.computeLegato(128, 0, 100, 200);
    assert.deepEqual(log, [
        // The gate drops, so the first half renders the release of the
        // outgoing note...
        'gate=0',
        'render:64->100',
        // ...and the new note is keyed on for the second half
        'gate=1',
        'render:64->200'
    ]);
    assert.equal(v.fCurNote, 60);
});
