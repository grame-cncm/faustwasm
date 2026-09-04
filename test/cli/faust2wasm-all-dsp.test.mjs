/**
 * Every `.dsp` in `test/`, compiled and actually run.
 *
 * "It compiled" is a weak claim: the CLI can write a truncated module, or
 * metadata that disagrees with the wasm, and still exit 0. So each fixture is
 * compiled through the CLI, then the files it wrote are loaded back from disk
 * and rendered. What gets instantiated is the exact bytes a user would deploy.
 *
 * The fixtures are discovered, not listed, so a `.dsp` dropped into `test/` is
 * covered from the moment it lands.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    FaustMonoDspGenerator,
    FaustPolyDspGenerator
} from '../../dist/esm/index.js';
import {
    allTestDsps,
    dspArgs,
    loadFactory,
    loadWasm,
    outDir,
    outExists,
    readMeta,
    runCliOk
} from './runner.mjs';

const SAMPLE_RATE = 48000;
const BUFFER_SIZE = 256;
const FRAMES = 4096;
const VOICES = 4;

/**
 * Walk a Faust UI tree and hand every leaf to a visitor.
 *
 * @param {any[]} items
 * @param {(item: any) => void} visit
 */
const walkUI = (items, visit) => {
    for (const item of items ?? []) {
        if (item.items) walkUI(item.items, visit);
        else visit(item);
    }
};

/**
 * Turn on every gate the DSP exposes.
 *
 * Most of these fixtures are instruments: at their default settings an
 * envelope sits closed and the DSP renders exact silence, which would make a
 * "did it produce anything" assertion meaningless. Pressing every button and
 * checkbox is the closest thing to a generic "play it" available from the
 * metadata alone.
 *
 * @param {any} processor
 * @param {any} meta
 */
const openGates = (processor, meta) => {
    walkUI(meta.ui, (item) => {
        if (item.type === 'button' || item.type === 'checkbox') {
            processor.setParamValue(item.address, 1);
        }
    });
};

/**
 * Whether every sample of every channel is a finite number.
 *
 * NaN is the failure mode that matters here: it is silent at the file level,
 * survives into the deployed app, and poisons whatever the node is connected
 * to.
 *
 * @param {Float32Array[]} channels
 * @returns {{ ok: boolean, where?: string }}
 */
const allFinite = (channels) => {
    for (let c = 0; c < channels.length; c += 1) {
        const channel = channels[c];
        for (let i = 0; i < channel.length; i += 1) {
            if (!Number.isFinite(channel[i])) {
                return { ok: false, where: `channel ${c}, frame ${i}` };
            }
        }
    }
    return { ok: true };
};

/** Whether any sample anywhere is non-zero. */
const anyNonZero = (channels) =>
    channels.some((channel) => channel.some((sample) => sample !== 0));

/**
 * A DSP that needs audio assets we do not ship cannot be asked for sound.
 *
 * `declare soundfiles "<url>"` means the samples live on a remote server; with
 * none loaded the DSP legitimately renders silence.
 *
 * @param {any} meta
 * @returns {boolean}
 */
const needsSoundfiles = (meta) =>
    (meta.meta ?? []).some((entry) => 'soundfiles' in entry);

for (const dsp of allTestDsps()) {
    const name = dsp.replace(/\.dsp$/, '');

    test(`${name} compiles and renders as a mono DSP`, async () => {
        const dir = outDir(`dsp-mono-${name}`);
        runCliOk('faust2wasm', [
            `test/${dsp}`,
            dir,
            '-no-template',
            ...dspArgs(dsp)
        ]);

        const meta = readMeta(dir, 'dsp-meta.json');
        assert.equal(typeof meta.name, 'string');
        assert.ok(meta.name.length > 0);
        assert.ok(Number.isInteger(meta.inputs) && meta.inputs >= 0);
        assert.ok(Number.isInteger(meta.outputs) && meta.outputs >= 1);
        assert.ok(Array.isArray(meta.ui));
        assert.equal(typeof meta.compile_options, 'string');

        const factory = await loadFactory(dir);
        const generator = new FaustMonoDspGenerator();
        const processor = await generator.createOfflineProcessor(
            SAMPLE_RATE,
            BUFFER_SIZE,
            factory
        );

        openGates(processor, meta);
        const out = processor.render([], FRAMES);

        assert.equal(
            out.length,
            meta.outputs,
            'rendered channel count must match the metadata'
        );
        assert.equal(out[0].length, FRAMES);
        const finite = allFinite(out);
        assert.ok(finite.ok, `non-finite sample at ${finite.where}`);

        // An effect fed silence is entitled to stay silent; a generator is not.
        if (meta.inputs === 0 && !needsSoundfiles(meta)) {
            assert.ok(anyNonZero(out), 'a generator rendered exact silence');
        }
    });

    test(`${name} compiles and renders as a poly DSP`, async () => {
        const dir = outDir(`dsp-poly-${name}`);
        runCliOk('faust2wasm', [
            `test/${dsp}`,
            dir,
            '-no-template',
            '-poly',
            ...dspArgs(dsp)
        ]);

        const voiceFactory = await loadFactory(dir);
        const mixerModule = await loadWasm(dir, 'mixer-module.wasm');
        // The effect module is written only when the source declares one.
        const effectFactory = outExists(dir, 'effect-module.wasm')
            ? await loadFactory(dir, 'effect')
            : null;

        const generator = new FaustPolyDspGenerator();
        const processor = await generator.createOfflineProcessor(
            SAMPLE_RATE,
            BUFFER_SIZE,
            VOICES,
            voiceFactory,
            mixerModule,
            effectFactory
        );

        // A polyphonic instrument only makes sound once a voice is allocated.
        processor.keyOn(0, 60, 100);
        const out = processor.render([], FRAMES);

        assert.equal(out[0].length, FRAMES);
        const finite = allFinite(out);
        assert.ok(finite.ok, `non-finite sample at ${finite.where}`);
    });
}
