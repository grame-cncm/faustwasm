/**
 * A voice hands the raw MIDI velocity to a `vel` or `velocity` control.
 *
 * The MIDI manual offers them as the alternative to `gain`: "gain (or vel or
 * velocity)", "vel or velocity can be used to get the raw MIDI velocity".
 * `keyOn` writes it -- but `extractPaths` collected those controls only when
 * a path ended in both `/vel` and `/velocity`, which no path does, so they
 * never received a value. `gain` gets velocity / 127 (`normalizeVelocity`).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FaustWebAudioDspVoice } from '../../dist/esm/index.js';

/** A voice over an API that only records the parameter writes. */
function voice(paths) {
    const writes = [];
    const api = /** @type {any} */ ({
        init: () => {},
        setParamValue: (_dsp, index, value) => writes.push([index, value])
    });
    const table = Object.fromEntries(paths.map((path, i) => [path, i * 4]));
    const v = new FaustWebAudioDspVoice(0, api, paths, table, 48000);
    return { v, writes, table };
}

test('vel and velocity get the raw velocity, gain velocity / 127', () => {
    const { v, writes, table } = voice([
        '/probe/freq',
        '/probe/gain',
        '/probe/gate',
        '/probe/vel',
        '/probe/velocity'
    ]);
    v.keyOn(60, 100);
    const at = (path) => writes.filter(([i]) => i === table[path]).map(([, value]) => value);
    assert.deepEqual(at('/probe/vel'), [100]);
    assert.deepEqual(at('/probe/velocity'), [100]);
    assert.deepEqual(at('/probe/gain'), [100 / 127]);
    assert.deepEqual(at('/probe/gate'), [1]);
});
