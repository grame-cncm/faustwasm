/**
 * The nodes a page actually creates, made to produce samples.
 *
 * Everything else in this suite drives a piece: the DSP object, the worklet
 * processor, the offline processor, the node's message wire. Nobody put the
 * pieces together, because the two node classes only exist inside a browser:
 * they extend `AudioWorkletNode` and `ScriptProcessorNode`, and the worklet
 * half of the pair is normally built by serialising classes into a blob and
 * loading it into another thread. So the one path every user takes --
 * `createNode`, then let the audio thread call it -- was the one path with no
 * test, and "the node comes back but renders silence" is exactly the failure
 * that shape of gap hides.
 *
 * `web-audio.mjs` supplies a Web Audio API of plain objects, including an
 * `addModule` that evaluates the generated processor source in this process.
 * What is exercised here is therefore the real thing on both sides of the
 * port: the real `createNode`, the real serialisation of the DSP classes into
 * the processor module, the real node, and the real processor.
 *
 * Rendering silence is the failure being watched for, so every test asserts
 * something audible, and the two generator cases pin the samples exactly
 * against the offline processor rather than merely "not zero".
 */
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
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
const SAMPLE_RATE = 48000;
const BLOCKS = 16;
const FRAMES = BLOCK * BLOCKS;
const VOICES = 4;

// Before the bundle is imported, never after: the node classes read these
// globals as they are defined. Hence the dynamic import below.
installWebAudio(SAMPLE_RATE);

const {
    instantiateFaustModuleFromFile,
    LibFaust,
    FaustCompiler,
    FaustMonoDspGenerator,
    FaustPolyDspGenerator
} = await import('../../dist/esm/index.js');

/** A plain generator: nothing to set, so silence means the node is broken. */
const OSC = 'import("stdfaust.lib"); process = os.osc(440) * 0.5;';

/** An instrument: silent until a control is written, or a note played. */
const INSTRUMENT = `import("stdfaust.lib");
process = os.osc(hslider("freq", 440, 20, 3000, 1))
        * hslider("gain", 0.5, 0, 1, 0.01)
        * (button("gate") : en.adsr(0.01, 0.1, 0.9, 0.2));`;

/** One input into a stereo reverb: silent until it is fed. */
const EFFECT = 'import("stdfaust.lib"); process = _ <: dm.freeverb_demo;';

/** @type {any} */ let compiler;

before(async () => {
    const faustModule = await instantiateFaustModuleFromFile(
        path.join(ROOT, 'libfaust-wasm', 'libfaust-wasm.js')
    );
    compiler = new FaustCompiler(new LibFaust(faustModule));
});

// Each test renders from frame zero, so a time scheduled in one cannot land
// in the middle of the next.
beforeEach(resetClock);

/**
 * A context of its own per test, as a page has one per session.
 *
 * Typed loosely at the boundary: `createNode` asks for a `BaseAudioContext`,
 * and the fake implements the three members it actually uses rather than the
 * two dozen the interface declares.
 *
 * @returns {any}
 */
const audioContext = () => new FakeAudioContext(SAMPLE_RATE);

/**
 * A compiled monophonic generator.
 *
 * @param {string} name
 * @param {string} code
 */
const monoGenerator = async (name, code) => {
    const generator = new FaustMonoDspGenerator();
    await generator.compile(compiler, name, code, '-ftz 2');
    const { factory } = generator;
    // `compile` reports a failed compilation by leaving the factory null, so
    // a test that only looked at the render would blame the node for it.
    assert.ok(factory, `${name} has to have compiled`);
    return { generator, factory };
};

/**
 * A compiled polyphonic generator.
 *
 * @param {string} name
 * @param {string} code
 */
const polyGenerator = async (name, code) => {
    const generator = new FaustPolyDspGenerator();
    await generator.compile(compiler, name, code, '-ftz 2');
    const { voiceFactory, mixerModule } = generator;
    assert.ok(voiceFactory, `${name} voices have to have compiled`);
    assert.ok(mixerModule, 'the mixer has to have been loaded');
    return { generator, voiceFactory, mixerModule };
};

/** Assert a render carries sound, which is the whole point of a node. */
const assertAudible = (rendered, what) =>
    assert.ok(
        rendered.some((channel) => channel.some((sample) => sample !== 0)),
        `${what} rendered silence`
    );

/** Assert a render is exactly zero, so "audible" above means something. */
const assertSilent = (rendered, what) => {
    for (const [channel, samples] of rendered.entries()) {
        const at = samples.findIndex((sample) => sample !== 0);
        if (at !== -1) {
            assert.fail(
                `${what}: channel ${channel} frame ${at} is ${samples[at]}, expected silence`
            );
        }
    }
};

/** Assert every sample is a number a sound card could take. */
const assertFinite = (rendered, what) => {
    for (const [channel, samples] of rendered.entries()) {
        const at = samples.findIndex((sample) => !Number.isFinite(sample));
        if (at !== -1) {
            assert.fail(
                `${what}: channel ${channel} frame ${at} is ${samples[at]}`
            );
        }
    }
};

/** Assert two renders match sample for sample. */
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

/** A ramp-and-sine input, deterministic and never zero for long. */
const inputSignal = (length) =>
    Float32Array.from({ length }, (_, i) => Math.sin(i * 0.05) * 0.4);

// --------------------------------------------------- both kinds of node

/**
 * The two node kinds, run through the same four cases.
 *
 * They share an API and nothing else -- one talks to a processor across a
 * port, the other computes in the callback -- so what a page can do with one
 * it has to be able to do with the other.
 *
 * @type {[string, boolean][]} - the name of a node kind, and its `sp` flag
 */
const KINDS = [
    ['an AudioWorklet node', false],
    ['a ScriptProcessor node', true]
];

for (const [kind, sp] of KINDS) {
    test(`${kind} renders the samples the offline processor renders`, async () => {
        const { generator, factory } = await monoGenerator('nodeosc', OSC);
        const context = audioContext();
        const node = await generator.createNode(
            context,
            'nodeosc',
            factory,
            sp,
            // The block a ScriptProcessor is given, matched to the worklet's
            // render quantum so both sides slice the DSP the same way and the
            // comparison below is about the node, not the buffer size.
            BLOCK
        );
        assert.ok(node, 'createNode returned nothing');
        assert.equal(node.getNumInputs(), 0);
        assert.equal(node.getNumOutputs(), 1);

        const rendered = renderNode(node, FRAMES);

        assertFinite(rendered, kind);
        assertAudible(rendered, kind);

        // Not just "some sample is non-zero": the offline processor renders
        // the same DSP through none of the node machinery, so anything but
        // equality means the node changed the sound rather than carrying it.
        const offline = await generator.createOfflineProcessor(
            SAMPLE_RATE,
            BLOCK
        );
        assert.ok(offline, 'the offline processor has to exist');
        assertSame(rendered, offline.render([], FRAMES), kind);
    });

    test(`${kind} stays silent until its controls say otherwise`, async () => {
        const { generator, factory } = await monoGenerator(
            'nodeinst',
            INSTRUMENT
        );
        const context = audioContext();
        const node = await generator.createNode(
            context,
            'nodeinst',
            factory,
            sp,
            BLOCK
        );
        assert.ok(node, 'createNode returned nothing');

        // The gate is the only thing holding the envelope shut, so this is
        // both a check that a closed instrument is quiet and the baseline
        // that makes the render below mean the write arrived.
        assertSilent(renderNode(node, FRAMES), `${kind} with its gate shut`);

        node.setParamValue('/nodeinst/gate', 1);
        const open = renderNode(node, FRAMES);
        assertAudible(open, `${kind} with its gate open`);

        // And the value written has to be the one that reached the DSP, not
        // merely some value: a different frequency has to sound different.
        node.setParamValue('/nodeinst/freq', 1000);
        assert.notDeepEqual(
            Array.from(renderNode(node, FRAMES)[0]),
            Array.from(open[0]),
            `${kind}: the frequency did not reach the DSP`
        );
    });

    test(`${kind} passes its input through an effect`, async () => {
        const { generator, factory } = await monoGenerator('nodefx', EFFECT);
        const context = audioContext();
        const node = await generator.createNode(
            context,
            'nodefx',
            factory,
            sp,
            BLOCK
        );
        assert.ok(node, 'createNode returned nothing');
        assert.equal(node.getNumInputs(), 1);
        assert.equal(node.getNumOutputs(), 2);

        // A reverb is linear: fed nothing it has nothing to give back, so a
        // node that invented samples here would be inventing them out of an
        // uninitialised buffer.
        assertSilent(
            renderNode(node, FRAMES, [new Float32Array(FRAMES)]),
            `${kind} fed silence`
        );

        const rendered = renderNode(node, FRAMES, [inputSignal(FRAMES)]);
        assertFinite(rendered, kind);
        assertAudible(rendered, `${kind} fed a signal`);
        assertAudible([rendered[1]], `${kind}: the right channel`);
    });

    test(`${kind} sounds a polyphonic note`, async () => {
        const { generator, voiceFactory, mixerModule } = await polyGenerator(
            'nodepoly',
            INSTRUMENT
        );
        const context = audioContext();
        const node = await generator.createNode(
            context,
            VOICES,
            'nodepoly',
            voiceFactory,
            mixerModule,
            generator.effectFactory,
            sp,
            BLOCK
        );
        assert.ok(node, 'createNode returned nothing');

        // Nothing is playing yet: an idle pool of voices has to add up to
        // nothing, or the note below would be audible whatever keyOn did.
        assertSilent(renderNode(node, FRAMES), `${kind} with no note playing`);

        node.keyOn(0, 69, 127);
        const rendered = renderNode(node, FRAMES);
        assertFinite(rendered, kind);
        assertAudible(rendered, `${kind} playing a note`);
    });
}
