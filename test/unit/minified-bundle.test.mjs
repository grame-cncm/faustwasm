/**
 * The AudioWorklet nodes still work once an application has minified us.
 *
 * Applications do not ship `dist/esm` as it is: their bundler (Vite, by
 * default) takes it in and renames every identifier it can. The worklet
 * module used to be assembled at run time from `Class.toString()` and
 * `Class.name`, which assumed that a class's `.name` is the identifier the
 * other classes' bodies use for it. A minifier renames the two independently,
 * so the module came out with free references and never registered its
 * processor, and the page only saw "the node name ... is not defined"
 * (grame-cncm/faustwasm#53). Nothing in the rest of this suite could see it,
 * since they all import the unminified bundle, where the names agree.
 *
 * So this file minifies `dist/esm` the way an application's build does, with
 * identifier mangling on, and creates each kind of AudioWorklet node from the
 * result -- mono, polyphonic and FFT -- through the real `createNode`, the
 * real `addModule` of `web-audio.mjs` and the real processor.
 */
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';
import {
    BLOCK,
    FakeAudioContext,
    installWebAudio,
    renderNode,
    resetClock
} from './web-audio.mjs';

const ROOT = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../..'
);
const BUNDLE = path.join(ROOT, 'test', 'out', 'minified', 'index.mjs');
const SAMPLE_RATE = 48000;
const FRAMES = BLOCK * 16;

const OSC = 'import("stdfaust.lib"); process = os.osc(440) * 0.5;';
const INSTRUMENT = `import("stdfaust.lib");
process = os.osc(hslider("freq", 440, 20, 3000, 1))
        * hslider("gain", 0.5, 0, 1, 0.01)
        * (button("gate") : en.adsr(0.01, 0.1, 0.9, 0.2));`;

// Before the bundle is imported, never after: the node classes read these
// globals as they are defined.
installWebAudio(SAMPLE_RATE);

/** @type {any} */ let faust;
/** @type {any} */ let compiler;

before(async () => {
    await esbuild.build({
        entryPoints: [path.join(ROOT, 'dist', 'esm', 'index.js')],
        outfile: BUNDLE,
        bundle: true,
        format: 'esm',
        platform: 'node',
        external: ['fs', 'url'],
        // What `vite build` does by default: whitespace, syntax and,
        // the part that matters here, identifiers.
        minify: true,
        logLevel: 'silent'
    });
    faust = await import(pathToFileURL(BUNDLE).href);
    const faustModule = await faust.instantiateFaustModuleFromFile(
        path.join(ROOT, 'libfaust-wasm', 'libfaust-wasm.js')
    );
    compiler = new faust.FaustCompiler(new faust.LibFaust(faustModule));
});

beforeEach(resetClock);

/** @returns {any} */
const audioContext = () => new FakeAudioContext(SAMPLE_RATE);

/** Assert a render carries sound. */
const assertAudible = (rendered, what) =>
    assert.ok(
        rendered.some((channel) => channel.some((sample) => sample !== 0)),
        `${what} rendered silence`
    );

test('the minifier did rename the classes, or this file tests nothing', async () => {
    // The unminified bundle declares its classes under their own names; the
    // minified one must not, or the case of #53 is not being reproduced.
    const { readFile } = await import('node:fs/promises');
    const minified = await readFile(BUNDLE, 'utf8');
    const original = await readFile(
        path.join(ROOT, 'dist', 'esm', 'index.js'),
        'utf8'
    );
    const declaration = /\bFaustMonoWebAudioDsp\s*=\s*class\b/;
    assert.match(original, declaration);
    assert.doesNotMatch(minified, declaration);
});

test('a mono AudioWorklet node from a minified bundle renders', async () => {
    const generator = new faust.FaustMonoDspGenerator();
    await generator.compile(compiler, 'minosc', OSC, '-ftz 2');
    assert.ok(generator.factory, 'minosc has to have compiled');
    const node = await generator.createNode(
        audioContext(),
        'minosc',
        generator.factory,
        false
    );
    assert.ok(node, 'createNode returned nothing');
    assertAudible(renderNode(node, FRAMES), 'the mono node');
});

test('a polyphonic AudioWorklet node from a minified bundle plays a note', async () => {
    const generator = new faust.FaustPolyDspGenerator();
    await generator.compile(compiler, 'minpoly', INSTRUMENT, '-ftz 2');
    assert.ok(generator.voiceFactory, 'minpoly has to have compiled');
    const node = await generator.createNode(
        audioContext(),
        4,
        'minpoly',
        generator.voiceFactory,
        generator.mixerModule,
        generator.effectFactory,
        false
    );
    assert.ok(node, 'createNode returned nothing');
    node.keyOn(0, 69, 127);
    assertAudible(renderNode(node, FRAMES), 'the polyphonic node');
});

test('an FFT AudioWorklet node from a minified bundle is created', async () => {
    // Registration is what #53 broke, so creating the node is the assertion:
    // the FFT itself is the caller's, and this stub never provides one.
    const FFTUtils = class {
        static getFFT() {
            return new Promise(() => {});
        }
        static fftToSignal() {}
        static signalToFFT() {}
        static signalToNoFFT() {}
    };
    const generator = new faust.FaustMonoDspGenerator();
    await generator.compile(compiler, 'minfft', OSC, '-ftz 2');
    assert.ok(generator.factory, 'minfft has to have compiled');
    const node = await generator.createFFTNode(
        audioContext(),
        FFTUtils,
        'minfft',
        generator.factory
    );
    assert.ok(node, 'createFFTNode returned nothing');
});
