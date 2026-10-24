import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import {
    instantiateFaustModuleFromFile,
    LibFaust,
    FaustCompiler,
    FaustPolyDspGenerator
} from '../../dist/esm/index.js';

const SAMPLE_RATE = 48000;
const DSP = `import("stdfaust.lib");
freq = nentry("freq", 440, 50, 2000, 0.01);
gain = nentry("gain", 1, 0, 1, 0.01);
gate = button("gate");
level = hslider("level", 1, 0, 1, 0.01) : si.smoo;
process = os.sawtooth(freq) * en.adsr(0.001, 0.1, 0, 0.1, gate) * level <: _, _;`;

/** @type {FaustCompiler} */
let compiler;

before(async () => {
    const module = await instantiateFaustModuleFromFile(
        fileURLToPath(
            new URL('../../libfaust-wasm/libfaust-wasm.js', import.meta.url)
        )
    );
    compiler = new FaustCompiler(new LibFaust(module));
});

test('reactivated voices stay silent after a smoothed level is set to zero while idle', async () => {
    const generator = new FaustPolyDspGenerator();
    assert.ok(await generator.compile(compiler, 'smoothing', DSP, '-ftz 2'));
    const processor = await generator.createOfflineProcessor(
        SAMPLE_RATE,
        128,
        8
    );
    assert.ok(processor);
    const level = processor.getParams().find((p) => p.endsWith('/level'));
    assert.ok(level);

    for (let i = 0; i < 8; i++) processor.keyOn(0, 60 + i, 100);
    const sounding = processor.render([], SAMPLE_RATE * 0.2)[0];
    assert.ok(sounding.some((sample) => Math.abs(sample) > 0.01));
    for (let i = 0; i < 8; i++) processor.keyOff(0, 60 + i, 100);
    processor.render([], SAMPLE_RATE * 0.4);

    processor.setParamValue(level, 0);
    processor.render([], SAMPLE_RATE * 0.8);

    for (let i = 0; i < 8; i++) processor.keyOn(0, 72 + i, 100);
    const output = processor.render([], 960);
    for (const channel of output) {
        const rms = Math.sqrt(
            channel.reduce((sum, sample) => sum + sample * sample, 0) /
                channel.length
        );
        assert.ok(rms < 1e-6, `expected silence, got onset RMS ${rms}`);
    }
});
for (const [initial, target] of [
    [1, 0.25],
    [0.25, 0.75]
]) {
    test(`an idle smoother reaches ${target} before the next note`, async () => {
        const generator = new FaustPolyDspGenerator();
        const code = `import("stdfaust.lib");
level = hslider("level", 1, 0, 1, 0.01) : si.smoo;
process = button("gate") * level;`;
        assert.ok(await generator.compile(compiler, 'control', code, '-ftz 2'));
        const processor = await generator.createOfflineProcessor(
            SAMPLE_RATE,
            128,
            1
        );
        assert.ok(processor);
        const level = processor.getParams().find((p) => p.endsWith('/level'));
        assert.ok(level);

        processor.setParamValue(level, initial);
        processor.keyOn(0, 60, 100);
        processor.render([], SAMPLE_RATE * 0.2);
        processor.keyOff(0, 60, 100);
        processor.render([], SAMPLE_RATE * 0.4);
        processor.setParamValue(level, target);
        processor.render([], SAMPLE_RATE * 0.8);

        processor.keyOn(0, 72, 100);
        const output = processor.render([], 128)[0];
        for (const sample of output) {
            assert.ok(
                Math.abs(sample - target) < 1e-4,
                `expected level ${target} at note onset, got ${sample}`
            );
        }
    });
}

test('free voices are not mixed even when their DSP produces sound', async () => {
    const generator = new FaustPolyDspGenerator();
    assert.ok(
        await generator.compile(compiler, 'ungated', 'process = 1;', '-ftz 2')
    );
    const processor = await generator.createOfflineProcessor(
        SAMPLE_RATE,
        128,
        4
    );
    assert.ok(processor);
    assert.ok(processor.render([], 128)[0].every((sample) => sample === 0));

    processor.keyOn(0, 60, 100);
    assert.ok(processor.render([], 128)[0].every((sample) => sample === 1));
    processor.allNotesOff(true);
    assert.ok(processor.render([], 128)[0].every((sample) => sample === 0));
});
