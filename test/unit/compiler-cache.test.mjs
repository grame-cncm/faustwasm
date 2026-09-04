/**
 * The factory cache.
 *
 * `createMonoDSPFactory` hashes what it was asked for and hands back the
 * factory it already built when the hash matches. That makes the hash a
 * correctness question, not an optimisation: two requests that hash alike get
 * the same wasm, whatever they actually asked for.
 *
 * These compile for real, which is what makes the identity checks mean
 * something -- a cache hit is the same object, a miss is a different one.
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    instantiateFaustModuleFromFile,
    LibFaust,
    FaustCompiler
} from '../../dist/esm/index.js';

const ROOT = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../..'
);
const CODE = 'process = _;';

/** @type {any} */ let compiler;

before(async () => {
    const faustModule = await instantiateFaustModuleFromFile(
        path.join(ROOT, 'libfaust-wasm', 'libfaust-wasm.js')
    );
    compiler = new FaustCompiler(new LibFaust(faustModule));
});

/** The compile options the compiler recorded in a factory's metadata. */
const optionsOf = (factory) => JSON.parse(factory.json).compile_options;

test('the same request twice is compiled once', async () => {
    const first = await compiler.createMonoDSPFactory('same', CODE, '-ftz 2');
    const second = await compiler.createMonoDSPFactory('same', CODE, '-ftz 2');
    // The very same object, not an equal one: that is what a cache hit is.
    assert.equal(first, second);
});

test('different code is compiled separately', async () => {
    const a = await compiler.createMonoDSPFactory('c', 'process = _;', '');
    const b = await compiler.createMonoDSPFactory('c', 'process = _* 2;', '');
    assert.notEqual(a, b);
    assert.notEqual(a.shaKey, b.shaKey);
});

test('a different name is a different factory', async () => {
    const a = await compiler.createMonoDSPFactory('nameA', CODE, '');
    const b = await compiler.createMonoDSPFactory('nameB', CODE, '');
    // The name goes into the generated JSON, so it cannot be shared.
    assert.notEqual(a, b);
    assert.equal(JSON.parse(a.json).name, 'nameA');
    assert.equal(JSON.parse(b.json).name, 'nameB');
});

test('different arguments are a different factory', async () => {
    const plain = await compiler.createMonoDSPFactory('args', CODE, '');
    const double = await compiler.createMonoDSPFactory('args', CODE, '-double');
    assert.notEqual(plain, double);
    assert.ok(!/-double/.test(optionsOf(plain)));
    assert.match(optionsOf(double), /-double/);
});

test('mono and poly of the same code do not share a factory', async () => {
    const mono = await compiler.createMonoDSPFactory('shared', CODE, '');
    const poly = await compiler.createPolyDSPFactory('shared', CODE, '');
    // They are compiled for different memory layouts; handing the mono one
    // back for a poly request would produce a node that cannot allocate
    // voices.
    assert.notEqual(mono, poly);
    assert.equal(mono.poly, false);
    assert.equal(poly.poly, true);
});

test('a request cannot collide with another by concatenation', async () => {
    // Regression: the key was sha256(name + code + args + "mono"), with no
    // separator, so these two agreed character for character --
    // "x" + "process = _; // -ftz 2" + ""
    // "x" + "process = _; // "       + "-ftz 2"
    // and the second was served the first's factory, compiled without the
    // flag it had asked for. A comment is all it takes to reach.
    const inComment = await compiler.createMonoDSPFactory(
        'x',
        'process = _; // -ftz 2',
        ''
    );
    const inArgs = await compiler.createMonoDSPFactory(
        'x',
        'process = _; // ',
        '-ftz 2'
    );
    assert.notEqual(inComment, inArgs);
    assert.ok(
        !/-ftz 2/.test(optionsOf(inComment)),
        'the flag was not asked for here'
    );
    assert.match(optionsOf(inArgs), /-ftz 2/, 'the flag was asked for here');
});

test('every factory carries the key it was cached under', async () => {
    const factory = await compiler.createMonoDSPFactory('keyed', CODE, '');
    assert.equal(typeof factory.shaKey, 'string');
    assert.ok(factory.shaKey.length > 0);
});

test('a factory that failed to compile is not cached as a success', async () => {
    const bad = 'process = no_such_primitive;';
    await assert.rejects(() => compiler.createMonoDSPFactory('bad', bad, ''));
    // Asking again must try again rather than return a cached failure.
    await assert.rejects(() => compiler.createMonoDSPFactory('bad', bad, ''));
});
