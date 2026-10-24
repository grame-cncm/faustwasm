/**
 * A DSP that produces NaN or Inf must not hand it on.
 *
 * Faust compiles a division by a control, or a filter whose Q a control
 * sets, into code that is fine until the control reaches the value that
 * makes it divide by zero. The compiler cannot know that value. Once a NaN
 * is in a node's recursive state it stays there for good -- a filter or a
 * delay never recovers from one -- and everything after the node that keeps
 * state of its own (a reverb, a delay, the next effect) is poisoned for good
 * as well. An Inf reaches the sound card as a full-scale click.
 *
 * So, once a host sets a handler with `setNonFiniteHandler`, `compute` zeroes
 * every non-finite output sample and calls the handler once. Measured here on
 * every path a page can take: the two node kinds, mono and polyphonic, and the
 * offline processor -- all of them render through `compute`. Without a handler
 * nothing is checked and the output is exactly what the DSP computed: the
 * guard is opt-in, like `dsp_me_checker` on the C++ side.
 *
 * The node itself stays silent afterwards (its state is broken); the point is
 * that nothing downstream is, and that the host can say which node it was.
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
const FRAMES = BLOCK * 16;
const VOICES = 4;

installWebAudio(SAMPLE_RATE);

const {
    instantiateFaustModuleFromFile,
    LibFaust,
    FaustCompiler,
    FaustMonoDspGenerator,
    FaustPolyDspGenerator
} = await import('../../dist/esm/index.js');

/**
 * Noise through a band-pass whose Q a control sets, then a delay. At q = 0
 * `fi.resonbp` divides by zero and the delay line keeps the NaN for good.
 */
const POISON = `import("stdfaust.lib");
q = hslider("q", 1, 0, 1, 0.01);
process = no.noise * 0.2 : fi.resonbp(800, q, 1) : de.delay(4096, 100);`;

/** The same trap behind an instrument, for the polyphonic path. */
const POISON_VOICE = `import("stdfaust.lib");
q = hslider("q", 1, 0, 1, 0.01);
process = os.osc(hslider("freq", 440, 20, 3000, 1))
        * hslider("gain", 0.5, 0, 1, 0.01)
        * (button("gate") : en.adsr(0.01, 0.1, 0.9, 0.2))
        : fi.resonbp(800, q, 1);`;

/** @type {any} */ let compiler;

before(async () => {
    const faustModule = await instantiateFaustModuleFromFile(
        path.join(ROOT, 'libfaust-wasm', 'libfaust-wasm.js')
    );
    compiler = new FaustCompiler(new LibFaust(faustModule));
});

beforeEach(resetClock);

/** @returns {any} */
const audioContext = () => new FakeAudioContext(SAMPLE_RATE);

/** The address of the `q` slider, whatever the DSP name puts before it. */
const qPath = (dsp) => {
    const found = dsp.getParams().find((p) => p.endsWith('/q'));
    assert.ok(found, 'the DSP has to have its q slider');
    return found;
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

/** Assert a render carries sound, so "finite" below is not just silence. */
const assertAudible = (rendered, what) =>
    assert.ok(
        rendered.some((channel) => channel.some((sample) => sample !== 0)),
        `${what} rendered silence`
    );

/**
 * The two node kinds, run through the same cases.
 *
 * @type {[string, boolean][]} - the name of a node kind, and its `sp` flag
 */
const KINDS = [
    ['an AudioWorklet node', false],
    ['a ScriptProcessor node', true]
];

for (const [kind, sp] of KINDS) {
    test(`${kind} hands on no NaN, and says so once`, async () => {
        const generator = new FaustMonoDspGenerator();
        await generator.compile(compiler, 'nonfinite', POISON, '-ftz 2');
        assert.ok(generator.factory, 'POISON has to have compiled');
        const node = await generator.createNode(
            audioContext(),
            'nonfinite',
            generator.factory,
            sp,
            BLOCK
        );
        assert.ok(node, 'createNode returned nothing');
        let reports = 0;
        node.setNonFiniteHandler(() => {
            reports += 1;
        });

        // A healthy Q first: sound, and nothing to report.
        const healthy = renderNode(node, FRAMES);
        assertFinite(healthy, `${kind} at q = 1`);
        assertAudible(healthy, `${kind} at q = 1`);
        assert.equal(reports, 0, 'a healthy node reported a fault');

        node.setParamValue(qPath(node), 0);
        assertFinite(renderNode(node, FRAMES), `${kind} at q = 0`);
        assert.equal(
            reports,
            1,
            'the first non-finite block has to be reported'
        );

        // Poisoned for good, and still nothing non-finite comes out -- but the
        // host has been told already.
        node.setParamValue(qPath(node), 1);
        assertFinite(
            renderNode(node, FRAMES),
            `${kind} after q went back to 1`
        );
        assert.equal(reports, 1, 'a node reports once, not per block');
    });

    test(`${kind} playing polyphonic voices hands on no NaN, and says so once`, async () => {
        const generator = new FaustPolyDspGenerator();
        await generator.compile(
            compiler,
            'nonfinitepoly',
            POISON_VOICE,
            '-ftz 2'
        );
        assert.ok(generator.voiceFactory, 'POISON_VOICE has to have compiled');
        const node = await generator.createNode(
            audioContext(),
            VOICES,
            'nonfinitepoly',
            generator.voiceFactory,
            generator.mixerModule,
            generator.effectFactory,
            sp,
            BLOCK
        );
        assert.ok(node, 'createNode returned nothing');
        let reports = 0;
        node.setNonFiniteHandler(() => {
            reports += 1;
        });

        node.keyOn(0, 69, 127);
        const healthy = renderNode(node, FRAMES);
        assertFinite(healthy, `${kind} playing at q = 1`);
        assertAudible(healthy, `${kind} playing at q = 1`);
        assert.equal(reports, 0, 'a healthy node reported a fault');

        node.setParamValue(qPath(node), 0);
        assertFinite(renderNode(node, FRAMES), `${kind} playing at q = 0`);
        assert.equal(
            reports,
            1,
            'the first non-finite block has to be reported'
        );
        assertFinite(renderNode(node, FRAMES), `${kind} playing on`);
        assert.equal(reports, 1, 'a node reports once, not per block');
    });
}

test('the offline processor renders no NaN either, and says so once', async () => {
    const generator = new FaustMonoDspGenerator();
    await generator.compile(compiler, 'nonfiniteoff', POISON, '-ftz 2');
    const offline = await generator.createOfflineProcessor(SAMPLE_RATE, BLOCK);
    assert.ok(offline, 'the offline processor has to exist');
    let reports = 0;
    offline.setNonFiniteHandler(() => {
        reports += 1;
    });

    offline.setParamValue(qPath(offline), 0);
    assertFinite(offline.render([], FRAMES), 'offline at q = 0');
    assert.equal(reports, 1, 'the first non-finite block has to be reported');
    assertFinite(offline.render([], FRAMES), 'offline rendering on');
    assert.equal(
        reports,
        1,
        'an offline processor reports once, not per block'
    );
});

test('without a handler nothing is checked: the output is what the DSP computed', async () => {
    const generator = new FaustMonoDspGenerator();
    await generator.compile(compiler, 'nonfiniteoptin', POISON, '-ftz 2');
    const offline = await generator.createOfflineProcessor(SAMPLE_RATE, BLOCK);
    assert.ok(offline, 'the offline processor has to exist');

    offline.setParamValue(qPath(offline), 0);
    const rendered = offline.render([], FRAMES);
    assert.ok(
        rendered.some((channel) => channel.some((s) => Number.isNaN(s))),
        'with no handler set, the NaN the DSP computes has to come out as it is'
    );
});

for (const [kind, sp] of KINDS) {
    test(`${kind} clears nothing once its handler is taken away again`, async () => {
        const generator = new FaustMonoDspGenerator();
        await generator.compile(compiler, 'nonfiniteoff2', POISON, '-ftz 2');
        assert.ok(generator.factory, 'POISON has to have compiled');
        const node = await generator.createNode(
            audioContext(),
            'nonfiniteoff2',
            generator.factory,
            sp,
            BLOCK
        );
        assert.ok(node, 'createNode returned nothing');
        node.setNonFiniteHandler(() => {});
        node.setNonFiniteHandler(null);

        node.setParamValue(qPath(node), 0);
        const rendered = renderNode(node, FRAMES);
        assert.ok(
            rendered.some((channel) => channel.some((s) => Number.isNaN(s))),
            `${kind}: with the handler removed, the guard has to be off`
        );
    });
}
