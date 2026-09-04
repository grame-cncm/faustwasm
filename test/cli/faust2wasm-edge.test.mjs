/**
 * The edges of `faust2wasm.js`: includes, argument handling, and failure.
 *
 * The happy path is covered elsewhere. What is checked here is the behaviour
 * around it -- where the compiler's in-memory filesystem meets the host's,
 * what reaches the Faust compiler untouched, what a bad invocation does, and
 * the three bugs this suite was written alongside.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
    ROOT,
    listDir,
    outDir,
    outExists,
    readMeta,
    runCli,
    runCliAsync,
    runCliOk
} from './runner.mjs';

test('-h prints the usage and succeeds', () => {
    const { status, stdout } = runCli('faust2wasm', ['-h']);
    assert.equal(status, 0);
    assert.match(stdout, /faust2wasm\.js <file\.dsp> <outputDir>/);
});

test('-help prints the same usage', () => {
    const { status, stdout } = runCli('faust2wasm', ['-help']);
    assert.equal(status, 0);
    assert.match(stdout, /faust2wasm\.js <file\.dsp> <outputDir>/);
});

test('a missing output directory argument fails and says so', () => {
    const { status, stderr } = runCli('faust2wasm', ['test/mono.dsp']);
    assert.notEqual(status, 0);
    assert.match(stderr, /Usage: faust2wasm\.js/);
});

test('no arguments at all fails', () => {
    const { status } = runCli('faust2wasm', []);
    assert.notEqual(status, 0);
});

test('a missing input file fails and names the file', () => {
    const dir = outDir('edge-missing-input');
    const { status, stderr } = runCli('faust2wasm', ['test/nope.dsp', dir]);
    assert.notEqual(status, 0);
    assert.match(stderr, /nope\.dsp/);
    // Nothing half-written is left behind for the next command to pick up.
    assert.ok(!fs.existsSync(dir));
});

test('a DSP that does not compile fails and reports the compiler error', () => {
    const dir = outDir('edge-bad-dsp');
    const source = path.join(dir, '..', 'edge-bad-source.dsp');
    fs.mkdirSync(path.dirname(source), { recursive: true });
    fs.writeFileSync(source, 'process = no_such_primitive;\n');

    const { status, stderr } = runCli('faust2wasm', [source, dir]);
    assert.notEqual(status, 0);
    // The Faust compiler's own diagnostic has to survive to the user.
    assert.match(stderr, /undefined symbol|no_such_primitive/i);
});

test('-I makes a library outside the DSP directory reachable', () => {
    const dir = outDir('edge-include');
    // mylib.lib lives in test/includes, not next to test/foo.dsp, so this
    // build only works if the include path is mirrored into the compiler's
    // in-memory filesystem.
    runCliOk('faust2wasm', [
        '-I',
        'test/includes',
        'test/foo.dsp',
        dir,
        '-no-template'
    ]);
    const meta = readMeta(dir, 'dsp-meta.json');
    // The slider comes from mylib.lib: seeing it proves the import resolved.
    assert.match(JSON.stringify(meta.ui), /"gain"/);
});

test('without -I the same DSP fails to find its library', () => {
    const dir = outDir('edge-include-missing');
    const { status, stderr } = runCli('faust2wasm', [
        'test/foo.dsp',
        dir,
        '-no-template'
    ]);
    assert.notEqual(status, 0);
    assert.match(stderr, /mylib\.lib/);
});

test('a DSP compiles from a working directory of its own', () => {
    const dir = outDir('edge-other-cwd');
    // The include remapping resolves paths against the process's cwd, so
    // running from elsewhere with absolute paths has to work the same.
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'faustwasm-cwd-'));
    try {
        runCliOk(
            'faust2wasm',
            [
                '-I',
                path.join(ROOT, 'test', 'includes'),
                path.join(ROOT, 'test', 'foo.dsp'),
                dir,
                '-no-template'
            ],
            { cwd }
        );
        assert.deepEqual(listDir(dir), ['dsp-meta.json', 'dsp-module.wasm']);
    } finally {
        fs.rmSync(cwd, { recursive: true, force: true });
    }
});

test('a DSP next to its own library needs no -I at all', () => {
    const dir = outDir('edge-sibling-include');
    // The input file's directory is always added to the include path.
    const src = fs.mkdtempSync(path.join(os.tmpdir(), 'faustwasm-src-'));
    try {
        fs.writeFileSync(
            path.join(src, 'sibling.lib'),
            'import("stdfaust.lib");\nmyosc = os.osc(330);\n'
        );
        fs.writeFileSync(
            path.join(src, 'uses.dsp'),
            'import("sibling.lib");\nprocess = myosc;\n'
        );
        runCliOk('faust2wasm', [
            path.join(src, 'uses.dsp'),
            dir,
            '-no-template'
        ]);
        assert.ok(outExists(dir, 'dsp-module.wasm'));
    } finally {
        fs.rmSync(src, { recursive: true, force: true });
    }
});

test('Faust compiler flags are passed through', () => {
    const dir = outDir('edge-double');
    runCliOk('faust2wasm', ['test/mono.dsp', dir, '-no-template', '-double']);
    const meta = readMeta(dir, 'dsp-meta.json');
    // compile_options records what the compiler was actually given.
    assert.match(meta.compile_options, /-double/);
});

test('the flush-to-zero flag is always applied', () => {
    const dir = outDir('edge-ftz');
    runCliOk('faust2wasm', ['test/mono.dsp', dir, '-no-template']);
    const meta = readMeta(dir, 'dsp-meta.json');
    // Denormals are expensive on the audio thread; the CLI appends -ftz 2.
    assert.match(meta.compile_options, /-ftz 2/);
});

test('flags may appear before the positional arguments', () => {
    const dir = outDir('edge-flags-first');
    runCliOk('faust2wasm', ['-no-template', '-poly', 'test/organ1.dsp', dir]);
    assert.ok(outExists(dir, 'mixer-module.wasm'));
    assert.ok(outExists(dir, 'effect-module.wasm'));
});

test('a nested output directory is created', () => {
    const dir = path.join(outDir('edge-nested'), 'a', 'b', 'c');
    // Regression: mkdirSync ran without `recursive`, so this died on ENOENT
    // with a raw stack trace instead of building.
    runCliOk('faust2wasm', ['test/mono.dsp', dir, '-no-template']);
    assert.deepEqual(listDir(dir), ['dsp-meta.json', 'dsp-module.wasm']);
});

test('a nested output directory is created for template modes too', () => {
    const dir = path.join(outDir('edge-nested-standalone'), 'x', 'y');
    runCliOk('faust2wasm', ['test/mono.dsp', dir, '-standalone']);
    assert.ok(outExists(dir, 'service-worker.js'));
});

test('a mono rebuild clears the poly files left in the directory', () => {
    const dir = outDir('edge-stale-poly');
    runCliOk('faust2wasm', ['test/organ1.dsp', dir, '-no-template', '-poly']);
    assert.ok(outExists(dir, 'effect-module.wasm'));
    assert.ok(outExists(dir, 'mixer-module.wasm'));

    // Regression: the cleanup loop used `for...in` over an array and so
    // unlinked nothing, leaving a mono build sitting next to the previous
    // build's effect and mixer modules.
    runCliOk('faust2wasm', ['test/mono.dsp', dir, '-no-template']);
    assert.deepEqual(listDir(dir), ['dsp-meta.json', 'dsp-module.wasm']);
});

test('a rebuild in another mode clears the previous mode DSP files', () => {
    const dir = outDir('edge-stale-effect');
    runCliOk('faust2wasm', ['test/poly.dsp', dir, '-no-template', '-poly']);
    // organ1.dsp is poly with an effect too, so only the bytes change here;
    // what matters is that nothing from the first build survives untouched.
    const before = fs.readFileSync(path.join(dir, 'dsp-module.wasm'));
    runCliOk('faust2wasm', ['test/organ1.dsp', dir, '-no-template', '-poly']);
    const after = fs.readFileSync(path.join(dir, 'dsp-module.wasm'));
    assert.ok(!before.equals(after), 'the DSP module was not rewritten');
    assert.equal(readMeta(dir, 'dsp-meta.json').name, 'organ1');
});

test('rebuilding the same target twice is stable', () => {
    const dir = outDir('edge-rebuild-idempotent');
    runCliOk('faust2wasm', ['test/mono.dsp', dir, '-standalone']);
    const first = listDir(dir);
    runCliOk('faust2wasm', ['test/mono.dsp', dir, '-standalone']);
    assert.deepEqual(listDir(dir), first);
});

test('several compilations can run at the same time', async () => {
    // Regression: loading the compiler wrote a wrapper module under a fixed
    // name next to libfaust-wasm.js and unlinked it afterwards, so parallel
    // invocations -- a Makefile building a folder of DSPs, or this suite --
    // deleted the file out from under each other. Most runs failed.
    const count = 6;
    const dirs = Array.from({ length: count }, (_, i) =>
        outDir(`edge-parallel-${i}`)
    );
    // runCliAsync, not runCli: spawnSync would serialise these and the test
    // would pass no matter what.
    const runs = await Promise.all(
        dirs.map((dir) =>
            runCliAsync('faust2wasm', ['test/mono.dsp', dir, '-no-template'])
        )
    );
    for (const [i, run] of runs.entries()) {
        assert.equal(run.status, 0, `run ${i} failed: ${run.stderr}`);
        assert.ok(outExists(dirs[i], 'dsp-module.wasm'));
    }
});
