/**
 * `getParamValue` answers what the DSP has, whoever wrote it.
 *
 * Some controls are written on the audio thread, not by the node: a slider
 * mapped to the accelerometer (`[acc:...]`) when `propagateAcc` is called, a
 * slider mapped to a MIDI controller (`[midi:ctrl n]`) when the controller
 * arrives. An AudioWorklet node used to answer `getParamValue` from its
 * `AudioParam`, which those writes never touch: the DSP moved, the node kept
 * saying the slider was where the page had last put it. Anything that reads
 * the node to show or send its state -- a UI built after the fact, a remote
 * control joining -- got a stale value.
 *
 * Both node kinds, through the Web Audio fake of `web-audio.mjs`, as in
 * `node-render.test.mjs`. A ScriptProcessor node reads its DSP directly and
 * was never affected; it is here so the two kinds keep agreeing.
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

// Before the bundle is imported: the node classes extend these globals
installWebAudio(SAMPLE_RATE);

const {
    instantiateFaustModuleFromFile,
    LibFaust,
    FaustCompiler,
    FaustMonoDspGenerator,
    FaustPolyDspGenerator
} = await import('../../dist/esm/index.js');

/** One slider driven by the accelerometer, one by MIDI controller 7. */
const MAPPED = `declare options "[midi:on]";
import("stdfaust.lib");
tilt = hslider("tilt [acc: 0 0 -10 0 10]", 0, 0, 1, 0.01);
vol = hslider("vol [midi:ctrl 7]", 0, 0, 1, 0.01);
gate = button("gate");
process = os.osc(440) * (tilt + vol) * gate * 0.1;`;

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

const near = (actual, expected, what) =>
    assert.ok(
        Math.abs(actual - expected) < 1e-6,
        `${what}: ${actual}, expected ${expected}`
    );

/** @type {[string, boolean][]} - the name of a node kind, and its `sp` flag */
const KINDS = [
    ['an AudioWorklet node', false],
    ['a ScriptProcessor node', true]
];

for (const [kind, sp] of KINDS) {
    const monoNode = async (name) => {
        const generator = new FaustMonoDspGenerator();
        await generator.compile(compiler, name, MAPPED, '-ftz 2');
        assert.ok(generator.factory, `${name} has to have compiled`);
        const node = await generator.createNode(
            audioContext(),
            name,
            generator.factory,
            sp,
            BLOCK
        );
        assert.ok(node, 'createNode returned nothing');
        return node;
    };

    test(`${kind} reports a value its accelerometer mapping wrote`, async () => {
        const node = await monoNode('pvacc');
        assert.equal(node.getParamValue('/pvacc/tilt'), 0);
        // x = 5 on an Up curve from -10 through 0 to 10, onto [0, 1]
        node.propagateAcc({ x: 5, y: 0, z: 0 }, false);
        renderNode(node, BLOCK);
        near(node.getParamValue('/pvacc/tilt'), 0.5, kind);
        // By its short name too
        near(node.getParamValue('tilt'), 0.5, `${kind}, short name`);
    });

    test(`${kind} reports a value a MIDI controller wrote`, async () => {
        const node = await monoNode('pvmidi');
        node.midiMessage([0xb0, 7, 127]);
        renderNode(node, BLOCK);
        near(node.getParamValue('/pvmidi/vol'), 1, kind);
    });

    test(`on ${kind}, the latest write wins, whoever made it`, async () => {
        const node = await monoNode('pvlatest');
        node.propagateAcc({ x: 5, y: 0, z: 0 }, false);
        renderNode(node, BLOCK);
        // The page writes after the sensor: its value, at once and after
        node.setParamValue('/pvlatest/tilt', 0.2);
        near(node.getParamValue('/pvlatest/tilt'), 0.2, `${kind}, at once`);
        renderNode(node, BLOCK);
        near(node.getParamValue('/pvlatest/tilt'), 0.2, `${kind}, rendered`);
        // Then the sensor again
        node.propagateAcc({ x: 10, y: 0, z: 0 }, false);
        renderNode(node, BLOCK);
        near(node.getParamValue('/pvlatest/tilt'), 1, `${kind}, sensor again`);
    });

    test(`${kind} forgets a mapped value when its controls are reset`, async () => {
        const node = await monoNode('pvreset');
        node.propagateAcc({ x: 5, y: 0, z: 0 }, false);
        renderNode(node, BLOCK);
        node.instanceResetUserInterface();
        renderNode(node, BLOCK);
        near(node.getParamValue('/pvreset/tilt'), 0, kind);
    });

    test(`${kind}, polyphonic, reports a value its sensor mapping wrote`, async () => {
        const generator = new FaustPolyDspGenerator();
        await generator.compile(compiler, 'pvpoly', MAPPED, '-ftz 2');
        assert.ok(generator.voiceFactory, 'the voices have to have compiled');
        const node = await generator.createNode(
            audioContext(),
            4,
            'pvpoly',
            generator.voiceFactory,
            generator.mixerModule,
            generator.effectFactory,
            sp,
            BLOCK
        );
        assert.ok(node, 'createNode returned nothing');
        node.propagateAcc({ x: 5, y: 0, z: 0 }, false);
        renderNode(node, BLOCK);
        near(node.getParamValue('/pvpoly/tilt'), 0.5, kind);
    });
}
