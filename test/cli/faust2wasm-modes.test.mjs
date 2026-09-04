/**
 * The four output modes of `faust2wasm.js`.
 *
 * A mode is a file set plus a set of substitutions: the templates in
 * `assets/standalone/` are copied through `cpSyncModify`, which rewrites
 * `FAUST_DSP_NAME`, `FAUST_DSP_VOICES`, `FAUST_DSP_HAS_EFFECT` and
 * `VERSION_DATE` on the way. Both halves fail silently -- a missing asset only
 * shows up as a 404 in someone's browser, and a missed substitution as a page
 * that loads the wrong DSP or a service worker that never invalidates its
 * cache. The matrix below pins them down.
 *
 * Two fixtures cover the interesting axis: `mono.dsp` has no `effect`,
 * `organ1.dsp` has one, so the effect files must appear for exactly one of
 * them and only under `-poly`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { listDir, outDir, readOut, runCliOk } from './runner.mjs';
import { MODES, expectedFiles, modeFlags } from './expected.mjs';

/** The fixtures, and whether their source defines an `effect`. */
const FIXTURES = [
    { dsp: 'mono.dsp', name: 'mono', effect: false },
    { dsp: 'organ1.dsp', name: 'organ1', effect: true }
];

/** Placeholders that must never survive into a generated file. */
const PLACEHOLDERS = ['FAUST_DSP_NAME', 'VERSION_DATE'];

/** Generated files that are text and therefore worth scanning. */
const isText = (name) => /\.(js|html|json)$/.test(name);

/**
 * Every generated text file at the top level of a build, as [name, content].
 *
 * The copied `faustwasm/` and `faust-ui/` folders are library code, untouched
 * by the substitution pass, so they are left out.
 *
 * @param {string} dir
 * @returns {[string, string][]}
 */
const textFiles = (dir) =>
    listDir(dir)
        .filter((name) => !name.endsWith('/') && isText(name))
        .map((name) => [name, readOut(dir, name)]);

for (const mode of MODES) {
    for (const { dsp, name, effect } of FIXTURES) {
        for (const poly of [false, true]) {
            const label = `${mode} ${name}${poly ? ' -poly' : ''}`;

            test(`${label} writes exactly the expected files`, () => {
                const dir = outDir(`modes-${mode}-${name}-${poly}`);
                runCliOk('faust2wasm', [
                    `test/${dsp}`,
                    dir,
                    ...modeFlags(mode),
                    ...(poly ? ['-poly'] : [])
                ]);
                assert.deepEqual(
                    listDir(dir),
                    expectedFiles(mode, { poly, effect })
                );
            });
        }
    }
}

test('a mono build ignores the effect its source defines', () => {
    const dir = outDir('modes-mono-ignores-effect');
    runCliOk('faust2wasm', ['test/organ1.dsp', dir, '-no-template']);
    // organ1.dsp defines `effect`, but without -poly there is nothing to
    // apply it to: no effect module, and no mixer either.
    assert.deepEqual(listDir(dir), ['dsp-meta.json', 'dsp-module.wasm']);
});

test('a poly build without an effect still gets the mixer', () => {
    const dir = outDir('modes-poly-no-effect');
    runCliOk('faust2wasm', ['test/mono.dsp', dir, '-no-template', '-poly']);
    // The mixer sums the voices, so it is there whether or not an effect is.
    assert.ok(fs.existsSync(path.join(dir, 'mixer-module.wasm')));
    assert.ok(!fs.existsSync(path.join(dir, 'effect-module.wasm')));
});

for (const mode of MODES.filter((m) => m !== 'no-template')) {
    test(`${mode} substitutes every placeholder`, () => {
        const dir = outDir(`subst-${mode}`);
        runCliOk('faust2wasm', ['test/mono.dsp', dir, ...modeFlags(mode)]);
        for (const [file, content] of textFiles(dir)) {
            for (const placeholder of PLACEHOLDERS) {
                assert.ok(
                    !content.includes(placeholder),
                    `${file} still contains the literal ${placeholder}`
                );
            }
        }
    });

    test(`${mode} carries the DSP name into the generated page`, () => {
        const dir = outDir(`name-${mode}`);
        runCliOk('faust2wasm', ['test/mono.dsp', dir, ...modeFlags(mode)]);
        assert.match(readOut(dir, 'index.js'), /"mono"/);
    });
}

test('mono leaves the voice count and the effect flag alone', () => {
    const dir = outDir('flags-mono');
    runCliOk('faust2wasm', ['test/organ1.dsp', dir, '-standalone']);
    assert.match(readOut(dir, 'index.js'), /FAUST_DSP_VOICES = 0/);
    assert.match(
        readOut(dir, 'create-node.js'),
        /FAUST_DSP_HAS_EFFECT = false/
    );
});

test('poly without an effect raises the voice count only', () => {
    const dir = outDir('flags-poly-no-effect');
    runCliOk('faust2wasm', ['test/mono.dsp', dir, '-standalone', '-poly']);
    assert.match(readOut(dir, 'index.js'), /FAUST_DSP_VOICES = 16/);
    // No `effect` in mono.dsp, so create-node.js must not go looking for one.
    assert.match(
        readOut(dir, 'create-node.js'),
        /FAUST_DSP_HAS_EFFECT = false/
    );
});

test('poly with an effect raises both', () => {
    const dir = outDir('flags-poly-effect');
    runCliOk('faust2wasm', ['test/organ1.dsp', dir, '-standalone', '-poly']);
    assert.match(readOut(dir, 'index.js'), /FAUST_DSP_VOICES = 16/);
    assert.match(readOut(dir, 'create-node.js'), /FAUST_DSP_HAS_EFFECT = true/);
});

test('the service worker caches the effect files only when there are any', () => {
    const withEffect = outDir('sw-effect');
    runCliOk('faust2wasm', ['test/organ1.dsp', withEffect, '-pwa', '-poly']);
    assert.match(
        readOut(withEffect, 'service-worker.js'),
        /FAUST_DSP_HAS_EFFECT = true/
    );

    const withoutEffect = outDir('sw-no-effect');
    runCliOk('faust2wasm', ['test/mono.dsp', withoutEffect, '-pwa', '-poly']);
    assert.match(
        readOut(withoutEffect, 'service-worker.js'),
        /FAUST_DSP_HAS_EFFECT = false/
    );
});

test('the PWA cache name is versioned per build', () => {
    const dir = outDir('pwa-cache-name');
    runCliOk('faust2wasm', ['test/mono.dsp', dir, '-pwa']);
    // "<dspName>_<YYYYMMDD-HHmm>": a fresh name per build is what makes a
    // redeployed app drop the previous cache instead of serving it forever.
    assert.match(
        readOut(dir, 'service-worker.js'),
        /const CACHE_NAME = "mono_\d{8}-\d{4}"/
    );
});

test('the standalone cache name is versioned too', () => {
    const dir = outDir('standalone-cache-name');
    runCliOk('faust2wasm', ['test/mono.dsp', dir, '-standalone']);
    // -standalone ships the same service worker as -pwa, so it needs the same
    // per-build cache name; a literal VERSION_DATE here pins every deployment
    // of the app to whatever it cached first.
    assert.match(
        readOut(dir, 'service-worker.js'),
        /const CACHE_NAME = "mono_\d{8}-\d{4}"/
    );
});

test('-standalone wins over -pwa when both are given', () => {
    const dir = outDir('modes-standalone-over-pwa');
    runCliOk('faust2wasm', ['test/mono.dsp', dir, '-standalone', '-pwa']);
    // The script tests -standalone first; the marker is that the PWA-only
    // install logic is absent.
    assert.deepEqual(listDir(dir), expectedFiles('standalone'));
});

test('-no-template is ignored when a template mode is also given', () => {
    const dir = outDir('modes-standalone-over-no-template');
    runCliOk('faust2wasm', [
        'test/mono.dsp',
        dir,
        '-standalone',
        '-no-template'
    ]);
    assert.deepEqual(listDir(dir), expectedFiles('standalone'));
});
