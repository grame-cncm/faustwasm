/**
 * The same DSP down two different paths has to come out the same.
 *
 * There are several ways to run a Faust DSP in this package -- the offline
 * processor and the AudioWorklet processor, mono and polyphonic -- and they
 * share the wasm but not the JavaScript around it: instantiation, the path
 * table, block slicing, voice allocation, the mixer. That glue is this
 * package's own, and it is where a change quietly shifts the sound.
 *
 * Comparing the paths against each other tests exactly that glue, and unlike a
 * recorded reference it needs no regenerating: it says nothing about what the
 * samples should be, only that the two routes agree. A libfaust upgrade moves
 * both sides at once and the tests stay green, which is the point -- they fire
 * for a regression here, not for a compiler that improved.
 *
 * AGENTS.md asks that mono and poly behaviour stay bit-identical to the
 * published package. This is the half of that claim which can be checked
 * without pinning a compiler version.
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    instantiateFaustModuleFromFile,
    LibFaust,
    FaustCompiler,
    FaustBaseWebAudioDsp,
    FaustMonoWebAudioDsp,
    FaustPolyWebAudioDsp,
    FaustWebAudioDspVoice,
    FaustWasmInstantiator,
    FaustMonoDspGenerator,
    FaustPolyDspGenerator,
    getFaustAudioWorkletProcessor
} from '../../dist/esm/index.js';

const ROOT = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../..'
);
const SAMPLE_RATE = 48000;
const BLOCK = 128;
const BLOCKS = 16;
const FRAMES = BLOCK * BLOCKS;

/** A plain generator: no controls, nothing to line up between the two paths. */
const OSC = 'import("stdfaust.lib"); process = os.osc(440) * 0.5;';

/** Two outputs, to catch a channel that goes missing on one route. */
const STEREO =
    'import("stdfaust.lib"); process = os.osc(440) * 0.5 <: _, os.osc(661) * 0.3;';

/** One input into a reverb: the only shape that exercises input slicing. */
const EFFECT = 'import("stdfaust.lib"); process = _ <: dm.freeverb_demo;';

/** An instrument, in the shape a polyphonic voice expects. */
const INSTRUMENT = `import("stdfaust.lib");
process = os.osc(hslider("freq", 440, 20, 3000, 1))
        * hslider("gain", 0.5, 0, 1, 0.01)
        * (button("gate") : en.adsr(0.01, 0.1, 0.9, 0.2));`;

/** @type {any} */ let compiler;

before(async () => {
    const faustModule = await instantiateFaustModuleFromFile(
        path.join(ROOT, 'libfaust-wasm', 'libfaust-wasm.js')
    );
    compiler = new FaustCompiler(new LibFaust(faustModule));

    // The AudioWorklet globals the processor reads off its scope. Set once:
    // node --test gives each file its own process, so nothing else sees them.
    globalThis.sampleRate = SAMPLE_RATE;
    globalThis.registerProcessor = () => {};
    globalThis.AudioWorkletProcessor = class {
        constructor() {
            this.port = {
                addEventListener() {},
                start() {},
                postMessage() {}
            };
        }
    };
});

/** Reports no accelerometer or gyroscope data, ever. */
class SilentCommunicator {
    getNewAccDataAvailable() {
        return false;
    }
    getNewGyrDataAvailable() {
        return false;
    }
    setNewAccDataAvailable() {}
    setNewGyrDataAvailable() {}
}

/** The dependency bundle a generated processor is built against. */
const DEPENDENCIES = {
    FaustBaseWebAudioDsp,
    FaustMonoWebAudioDsp,
    FaustPolyWebAudioDsp,
    FaustWebAudioDspVoice,
    FaustWasmInstantiator,
    FaustAudioWorkletProcessorCommunicator: SilentCommunicator
};

/**
 * Drive a worklet processor for a whole render, block by block.
 *
 * `currentFrame` advances between calls, as the browser advances it, because
 * the event queue reads the clock off the scope.
 *
 * @param {any} Processor - a class from getFaustAudioWorkletProcessor
 * @param {any} processorOptions
 * @param {number} outputs - channel count
 * @param {Float32Array[]} [inputs] - the whole input signal, per channel
 * @param {(processor: any) => void} [before] - run once before the first block
 * @returns {Float32Array[]}
 */
const renderWorklet = (
    Processor,
    processorOptions,
    outputs,
    inputs = [],
    setUp
) => {
    let frame = 0;
    Object.defineProperty(globalThis, 'currentFrame', {
        configurable: true,
        get: () => frame
    });

    const processor = new Processor({ processorOptions });
    setUp?.(processor);

    const rendered = Array.from(
        { length: outputs },
        () => new Float32Array(FRAMES)
    );
    for (let block = 0; block < BLOCKS; block += 1) {
        const at = block * BLOCK;
        const blockIn = inputs.map((channel) =>
            channel.subarray(at, at + BLOCK)
        );
        const blockOut = Array.from(
            { length: outputs },
            () => new Float32Array(BLOCK)
        );
        processor.process([blockIn], [blockOut], {});
        blockOut.forEach((channel, i) => rendered[i].set(channel, at));
        frame += BLOCK;
    }
    return rendered;
};

/**
 * Assert two renders are the same sample for sample.
 *
 * Not "close": both sides run the same wasm on the same inputs, so anything
 * but equality means the glue diverged.
 */
const assertSame = (a, b, what) => {
    assert.equal(a.length, b.length, `${what}: channel count`);
    for (let channel = 0; channel < a.length; channel += 1) {
        for (let i = 0; i < a[channel].length; i += 1) {
            if (a[channel][i] !== b[channel][i]) {
                assert.fail(
                    `${what}: channel ${channel} frame ${i}, ` +
                        `${a[channel][i]} vs ${b[channel][i]}`
                );
            }
        }
    }
};

/** Assert a render is not silence, so agreement is not agreement on nothing. */
const assertAudible = (rendered, what) =>
    assert.ok(
        rendered.some((channel) => channel.some((sample) => sample !== 0)),
        `${what} rendered silence`
    );

/** A ramp-and-sine input, deterministic and never zero for long. */
const inputSignal = (length) =>
    Float32Array.from({ length }, (_, i) => Math.sin(i * 0.05) * 0.4);

// ------------------------------------------ the offline and worklet paths

for (const [name, code, outputs] of [
    ['a generator', OSC, 1],
    ['a stereo DSP', STEREO, 2]
]) {
    test(`${name} renders the same offline and in a worklet`, async () => {
        const factory = await compiler.createMonoDSPFactory(
            'agree',
            code,
            '-ftz 2'
        );
        const generator = new FaustMonoDspGenerator();
        const offline = (
            await generator.createOfflineProcessor(SAMPLE_RATE, BLOCK, factory)
        ).render([], FRAMES);

        const Processor = getFaustAudioWorkletProcessor(
            DEPENDENCIES,
            {
                processorName: 'agree',
                dspName: 'agree',
                dspMeta: JSON.parse(factory.json),
                poly: false
            },
            false
        );
        const worklet = renderWorklet(
            Processor,
            { factory, sampleSize: 4 },
            outputs
        );

        assertAudible(offline, 'the offline processor');
        assertSame(offline, worklet, name);
    });
}

test('an effect renders the same on both paths, input and all', async () => {
    const factory = await compiler.createMonoDSPFactory(
        'agreefx',
        EFFECT,
        '-ftz 2'
    );
    const signal = inputSignal(FRAMES);

    const generator = new FaustMonoDspGenerator();
    const offline = (
        await generator.createOfflineProcessor(SAMPLE_RATE, BLOCK, factory)
    ).render([signal], FRAMES);

    const Processor = getFaustAudioWorkletProcessor(
        DEPENDENCIES,
        {
            processorName: 'agreefx',
            dspName: 'agreefx',
            dspMeta: JSON.parse(factory.json),
            poly: false
        },
        false
    );
    const worklet = renderWorklet(Processor, { factory, sampleSize: 4 }, 2, [
        signal
    ]);

    // A reverb carries state across blocks, so the two paths have to agree on
    // the slicing as well as the arithmetic.
    assertAudible(offline, 'the offline effect');
    assertSame(offline, worklet, 'effect');
});

test('a parameter set on both paths moves both the same way', async () => {
    const factory = await compiler.createMonoDSPFactory(
        'agreeparam',
        INSTRUMENT,
        '-ftz 2'
    );
    const meta = JSON.parse(factory.json);
    const set = (target) => {
        target.setParamValue('/agreeparam/freq', 660);
        target.setParamValue('/agreeparam/gain', 0.8);
        target.setParamValue('/agreeparam/gate', 1);
    };

    const generator = new FaustMonoDspGenerator();
    const offlineProcessor = await generator.createOfflineProcessor(
        SAMPLE_RATE,
        BLOCK,
        factory
    );
    set(offlineProcessor);
    const offline = offlineProcessor.render([], FRAMES);

    const Processor = getFaustAudioWorkletProcessor(
        DEPENDENCIES,
        {
            processorName: 'agreeparam',
            dspName: 'agreeparam',
            dspMeta: meta,
            poly: false
        },
        false
    );
    const worklet = renderWorklet(
        Processor,
        { factory, sampleSize: 4 },
        1,
        [],
        set
    );

    assertAudible(offline, 'the offline instrument');
    assertSame(offline, worklet, 'parameters');
});

// --------------------------------------------- the mono and poly paths

/** MIDI pitch to frequency, the mapping a voice applies on keyOn. */
const midiToFreq = (pitch) => 440 * 2 ** ((pitch - 69) / 12);

/**
 * Render the instrument as a mono DSP, set up as one poly voice would be.
 *
 * @param {number} pitch
 * @param {number} velocity
 */
const renderMono = async (pitch, velocity) => {
    const generator = new FaustMonoDspGenerator();
    await generator.compile(compiler, 'inst', INSTRUMENT, '-ftz 2');
    const processor = await generator.createOfflineProcessor(
        SAMPLE_RATE,
        BLOCK
    );
    processor.setParamValue('/inst/freq', midiToFreq(pitch));
    processor.setParamValue('/inst/gain', velocity / 127);
    processor.setParamValue('/inst/gate', 1);
    return processor.render([], FRAMES);
};

/**
 * Render the same instrument polyphonically, playing one note.
 *
 * @param {number} voices - the size of the pool, not the notes played
 * @param {number} pitch
 * @param {number} velocity
 */
const renderPoly = async (voices, pitch, velocity) => {
    const generator = new FaustPolyDspGenerator();
    // The voice count belongs to createOfflineProcessor, not here: compile's
    // fifth parameter is the effect's Faust source, and passing a number
    // there reached the emscripten binding as a non-string.
    await generator.compile(compiler, 'instpoly', INSTRUMENT, '-ftz 2');
    const processor = await generator.createOfflineProcessor(
        SAMPLE_RATE,
        BLOCK,
        voices
    );
    processor.keyOn(0, pitch, velocity);
    return processor.render([], FRAMES);
};

test('one polyphonic voice sounds exactly like the mono DSP', async () => {
    const mono = await renderMono(69, 127);
    const poly = await renderPoly(1, 69, 127);
    // keyOn sets freq, gain and gate on the voice; the mono side is set to
    // the same three values. Everything between -- voice allocation, the
    // mixer, the wasm memory layout of a poly instance -- has to add up to
    // nothing.
    assertAudible(mono, 'the mono instrument');
    assertSame(mono, poly, 'mono against one voice');
});

test('the pitch really reaches the voice', async () => {
    // Otherwise the test above would pass just as well on a voice that
    // ignored keyOn and sat at the slider's init value.
    const low = await renderPoly(1, 45, 127);
    const high = await renderPoly(1, 81, 127);
    assert.notDeepEqual(Array.from(low[0]), Array.from(high[0]));
});

test('an idle voice pool adds nothing to the note being played', async () => {
    const alone = await renderPoly(1, 69, 100);
    const inACrowd = await renderPoly(8, 69, 100);
    // Seven silent voices go through the same mixer; if it scaled by the
    // pool size, or summed uninitialised voices, this is where it shows.
    assertAudible(alone, 'a single voice');
    assertSame(alone, inACrowd, 'one voice against eight');
});

test('the velocity reaches the voice as gain', async () => {
    const soft = await renderPoly(1, 69, 32);
    const loud = await renderPoly(1, 69, 127);
    const peak = (rendered) => Math.max(...Array.from(rendered[0], Math.abs));
    assert.ok(peak(loud) > peak(soft), 'velocity did not change the level');
});
