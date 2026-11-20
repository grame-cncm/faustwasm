/**
 * The faust2*Files functions hold the event loop while they work.
 *
 * Without a live libuv handle, awaiting WebAssembly.compile sends Node's main
 * thread into NodePlatform::DrainTasks, where it can deadlock with a
 * concurrent V8 compile job that needs a GC (nodejs/node#54918): the script
 * then sleeps forever at 0% CPU, having written nothing. `faust2wasm.js
 * -poly` did so intermittently, which hung the all-DSP sweep of this suite.
 * `src/holdEventLoop.js` explains the mechanism.
 *
 * The hang itself is too rare to catch in a test in reasonable time, and only
 * on some Node versions. What can be checked every time is the remedy: each
 * function holds a timer from the moment it is called, and lets go of it once
 * it settles, whether it succeeded or threw. Letting go matters as much as
 * holding: a timer left behind would keep the process alive forever, the same
 * hang by another road.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'node:path';
import faust2wasmFiles from '../../src/faust2wasmFiles.js';
import faust2svgFiles from '../../src/faust2svgFiles.js';
import faust2cmajorFiles from '../../src/faust2cmajorFiles.js';
import faust2wavFiles from '../../src/faust2wavFiles.js';
import { outDir } from './runner.mjs';

/** How many timers the event loop is holding right now. */
const timers = () =>
    process.getActiveResourcesInfo().filter((r) => r === 'Timeout').length;

/**
 * Call `start`, check a timer is held while its promise is pending and gone
 * once it settles. The functions log their progress; it is kept out of the
 * test report.
 *
 * @param {() => Promise<unknown>} start
 * @returns {Promise<unknown>} the settled promise, to assert on its outcome
 */
const heldWhilePending = async (start) => {
    const log = console.log;
    console.log = () => {};
    try {
        const before = timers();
        const pending = start();
        assert.equal(
            timers(),
            before + 1,
            'expected a timer to be held while the work is pending'
        );
        // Settle either way; the caller asserts on the outcome.
        await pending.catch(() => {});
        assert.equal(timers(), before, 'expected the timer to be released');
        return pending;
    } finally {
        console.log = log;
    }
};

test('faust2wasmFiles holds the event loop while compiling a poly DSP', async () => {
    const dir = outDir('event-loop-wasm-poly');
    const { dspMeta } = /** @type {{ dspMeta: { name: string } }} */ (
        await heldWhilePending(() =>
            faust2wasmFiles('test/organ.dsp', dir, [], true)
        )
    );
    assert.equal(dspMeta.name, 'organ');
});

test('faust2wasmFiles releases the event loop when it fails', async () => {
    const dir = outDir('event-loop-wasm-missing');
    const pending = heldWhilePending(() =>
        faust2wasmFiles(path.join('test', 'no-such-file.dsp'), dir)
    );
    await assert.rejects(pending, /ENOENT/);
});

test('faust2svgFiles holds the event loop while it works', async () => {
    const dir = outDir('event-loop-svg');
    await heldWhilePending(() => faust2svgFiles('test/mono.dsp', dir));
});

test('faust2cmajorFiles holds the event loop while it works', async () => {
    const dir = outDir('event-loop-cmajor');
    await heldWhilePending(() => faust2cmajorFiles('test/mono.dsp', dir));
});

test('faust2wavFiles holds the event loop while it works', async () => {
    const wav = path.join(outDir('event-loop-wav'), 'out.wav');
    await heldWhilePending(() =>
        faust2wavFiles('test/mono.dsp', '', wav, 64, 44100, 64)
    );
});
