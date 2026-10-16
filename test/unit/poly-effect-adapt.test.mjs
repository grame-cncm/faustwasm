/**
 * A polyphonic instrument's `effect`, adapted to its voice whatever their
 * channel counts.
 *
 * The voices are mixed into the buffers the effect then processes in place,
 * so the voice, the effect inputs and the effect outputs share one width: the
 * largest of the three counts. `FaustPolyDspGenerator.compile` adapts both to
 * it. The voice's own channels reach the effect inputs through the adaptor of
 * `poly-dsp.h` (`getEffectCode`): split when there are at least as many
 * inputs, merged otherwise, so one count must be a multiple of the other. The
 * adaptation used to know one and two channels only, and a voice of five
 * (a piano's soundboard regions into a stereo body) ran without its effect.
 *
 * The programs are constants, so each output's value says which channels
 * reached it.
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    instantiateFaustModuleFromFile,
    LibFaust,
    FaustCompiler,
    FaustPolyDspGenerator
} from '../../dist/esm/index.js';

const ROOT = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../..'
);
const SAMPLE_RATE = 48000;
const BLOCK = 128;
const FRAMES = BLOCK * 2;

/** @type {any} */ let compiler;

before(async () => {
    const faustModule = await instantiateFaustModuleFromFile(
        path.join(ROOT, 'libfaust-wasm', 'libfaust-wasm.js')
    );
    compiler = new FaustCompiler(new LibFaust(faustModule));
});

/**
 * Compile `voice` and `effect`, play one note, and return the generator and
 * the value of each output in the middle of the render.
 *
 * @param {string} name
 * @param {string} voice - the voice's `process`, of the gate `g`
 * @param {string} effect - the instrument's `effect`
 */
const play = async (name, voice, effect) => {
    const generator = new FaustPolyDspGenerator();
    const code = `g = button("gate");\nprocess = ${voice};\neffect = ${effect};\n`;
    const warnings = [];
    const warn = console.warn;
    console.warn = (...args) => warnings.push(args.map(String).join(' '));
    try {
        await generator.compile(compiler, name, code, '-ftz 2');
    } finally {
        console.warn = warn;
    }
    assert.ok(generator.voiceFactory, 'the voices have to have compiled');
    const processor = await generator.createOfflineProcessor(
        SAMPLE_RATE,
        BLOCK,
        2
    );
    processor.keyOn(0, 60, 127);
    const rendered = processor.render([], FRAMES);
    return {
        generator,
        warnings,
        values: rendered.map((channel) => channel[FRAMES / 2])
    };
};

test('five voice channels reach a stereo body, padded back to five', async () => {
    const { generator, values } = await play(
        'body',
        'g <: _, *(0.5), *(0.25), *(2), *(3)',
        '_, _, _, _, _ :> _ <: *(1), *(2)'
    );
    assert.ok(generator.effectFactory, 'the effect has to be kept');
    // 1 + 0.5 + 0.25 + 2 + 3 into the body, its two outputs, then silence
    assert.deepEqual(values, [6.75, 13.5, 0, 0, 0]);
});

test('a mono voice is split into a stereo effect, as before', async () => {
    const { generator, values } = await play('split', 'g', '*(2), *(3)');
    assert.ok(generator.effectFactory);
    assert.deepEqual(values, [2, 3]);
});

test('a stereo voice is merged into a mono effect, as before', async () => {
    const { generator, values } = await play('merge', 'g <: _, *(0.5)', '*(4)');
    assert.ok(generator.effectFactory);
    // the effect's single output is the left channel, the right one silent
    assert.deepEqual(values, [6, 0]);
});

test('channels in multiples are merged pairwise', async () => {
    const { generator, values } = await play(
        'pairs',
        'g <: _, *(0.5), *(0.25), *(0.125)',
        '*(1), *(10)'
    );
    assert.ok(generator.effectFactory);
    // channel i into input i mod 2, the effect's two outputs, then silence
    assert.deepEqual(values, [1.25, 6.25, 0, 0]);
});

test('a stereo voice into an effect of five outputs keeps its two inputs', async () => {
    const { generator, values } = await play(
        'wide',
        'g <: _, *(0.5)',
        '+ <: par(i, 5, *(i + 1))'
    );
    assert.ok(generator.effectFactory);
    // the voice is padded to five, the silent channels never reach the effect
    assert.deepEqual(values, [1.5, 3, 4.5, 6, 7.5]);
});

test('a mono voice into a mono effect stays one channel', async () => {
    const { generator, values } = await play('mono', 'g', '*(2)');
    assert.ok(generator.effectFactory);
    assert.equal(
        JSON.parse(generator.effectFactory.json).outputs,
        1,
        'the effect writes the one buffer there is, not a second one'
    );
    assert.deepEqual(values, [2]);
});

test('an effect no adaptor fits is left out, and said', async () => {
    const { generator, warnings, values } = await play(
        'refused',
        'g <: _, _, _',
        '_, _'
    );
    // three channels into two inputs: neither count divides the other
    assert.equal(generator.effectFactory, null);
    assert.deepEqual(values, [1, 1, 1], 'the dry voice');
    assert.ok(warnings.length > 0, 'the refusal has to be reported');
});
