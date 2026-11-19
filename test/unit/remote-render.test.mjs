/**
 * Remote control of real nodes, heard in their render.
 *
 * `remote-host.test.mjs` checks the session against a fake node. Here the host
 * is put on nodes made by `createNode` -- both kinds, through the Web Audio
 * fake of `web-audio.mjs`, as `node-render.test.mjs` does -- so what is
 * asserted is the sound: a button pressed on the remote control opens the
 * envelope, an accelerometer reading sent from it moves the DSP exactly as the
 * same reading given to the node locally does, a bargraph computed by the DSP
 * comes back to the remote control, and a note left held by a remote control
 * that vanished dies away.
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

// Before the bundle is imported: the node classes extend these globals
installWebAudio(SAMPLE_RATE);

const {
    instantiateFaustModuleFromFile,
    LibFaust,
    FaustCompiler,
    FaustMonoDspGenerator,
    FaustPolyDspGenerator
} = await import('../../dist/esm/index.js');
const { FaustRemoteHost, FaustRemoteDsp, createLoopbackTransports } =
    await import('../../dist/remote/index.js');

/**
 * Silent until the gate opens or the device tilts; the bargraph shows what
 * holds the envelope open, so its value is known exactly.
 */
const CONTROLLED = `import("stdfaust.lib");
tilt = hslider("tilt [acc: 0 0 -10 0 10]", 0, 0, 1, 0.01);
open = button("gate") + tilt;
process = os.osc(hslider("freq", 440, 20, 3000, 1)) * open * 0.5
        : attach(_, open : hbargraph("level", 0, 2));`;

/** An instrument for the polyphonic node. */
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
});

beforeEach(resetClock);

/** @returns {any} */
const audioContext = () => new FakeAudioContext(SAMPLE_RATE);

/** Let the in-memory transport deliver. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const isAudible = (rendered) =>
    rendered.some((channel) => channel.some((sample) => sample !== 0));

/**
 * A host on a node, and a remote control connected to it. Rate limits are
 * real-time and renders are not, so they are lifted.
 */
const remoteControl = async (node) => {
    const host = new FaustRemoteHost(node, { outputRate: 1e6 });
    const [hostEnd, remoteEnd] = createLoopbackTransports();
    host.accept(hostEnd);
    const dsp = await FaustRemoteDsp.connect(remoteEnd, {
        pingInterval: 0,
        gestureEnd: 0
    });
    return { host, dsp, remoteEnd };
};

/** @type {[string, boolean][]} - the name of a node kind, and its `sp` flag */
const KINDS = [
    ['an AudioWorklet node', false],
    ['a ScriptProcessor node', true]
];

for (const [kind, sp] of KINDS) {
    const monoNode = async (name) => {
        const generator = new FaustMonoDspGenerator();
        await generator.compile(compiler, name, CONTROLLED, '-ftz 2');
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

    test(`a button pressed remotely opens ${kind}, and its bargraph comes back`, async () => {
        const node = await monoNode('remotegate');
        const { host, dsp } = await remoteControl(node);
        /** @type {number[]} */
        const levels = [];
        dsp.setOutputParamHandler((path, value) => {
            if (path === '/remotegate/level') levels.push(value);
        });

        assert.equal(isAudible(renderNode(node, FRAMES)), false, 'gate shut');
        dsp.setParamValue('gate', 1);
        await settle();
        assert.equal(isAudible(renderNode(node, FRAMES)), true, 'gate open');
        await settle();
        assert.equal(levels.at(-1), 1, `levels ${levels}`);
        assert.equal(dsp.getOutputValue('/remotegate/level'), 1);

        dsp.close();
        host.close();
    });

    test(`an accelerometer reading sent remotely moves ${kind} as a local one does`, async () => {
        const local = await monoNode('remoteacc');
        const remote = await monoNode('remoteacc');
        const { host, dsp } = await remoteControl(remote);
        assert.equal(dsp.hasAccInput, true);

        const reading = { x: 5, y: 0, z: 0 };
        local.propagateAcc(reading, false);
        dsp.propagateAcc(reading, false);
        await settle();
        const heardLocally = renderNode(local, FRAMES);
        const heardRemotely = renderNode(remote, FRAMES);
        assert.equal(isAudible(heardLocally), true, 'the tilt has to open it');
        assert.deepEqual(
            Array.from(heardRemotely[0]),
            Array.from(heardLocally[0])
        );

        dsp.close();
        host.close();
    });

    test(`a change made on ${kind} itself reaches the remote control`, async () => {
        const node = await monoNode('remotesync');
        const { host, dsp } = await remoteControl(node);
        /** @type {[string, number][]} */
        const seen = [];
        dsp.setInputParamHandler((path, value) => seen.push([path, value]));

        node.setParamValue('/remotesync/freq', 1000);
        renderNode(node, BLOCK);
        await settle();
        assert.deepEqual(seen.at(-1), ['/remotesync/freq', 1000]);
        assert.equal(dsp.getParamValue('freq'), 1000);

        dsp.close();
        host.close();
    });

    test(`[remote:off] from the Faust source keeps a control of ${kind} from remote controls`, async () => {
        const generator = new FaustMonoDspGenerator();
        await generator.compile(
            compiler,
            'remotelocked',
            `import("stdfaust.lib");
process = os.osc(hslider("freq [remote:off]", 440, 20, 3000, 1)) * button("gate");`,
            '-ftz 2'
        );
        assert.ok(generator.factory, 'remotelocked has to have compiled');
        const node = await generator.createNode(
            audioContext(),
            'remotelocked',
            generator.factory,
            sp,
            BLOCK
        );
        assert.ok(node, 'createNode returned nothing');
        const { host, dsp } = await remoteControl(node);
        /** @type {[string, number][]} */
        const seen = [];
        dsp.setInputParamHandler((path, value) => seen.push([path, value]));
        await settle();
        seen.length = 0;

        dsp.setParamValue('freq', 1000);
        dsp.setParamValue('gate', 1);
        await settle();
        renderNode(node, BLOCK);
        // The gate went through, the frequency did not, and came back
        assert.equal(node.getParamValue('/remotelocked/gate'), 1);
        assert.equal(node.getParamValue('/remotelocked/freq'), 440);
        assert.deepEqual(seen[0], ['/remotelocked/freq', 440]);

        dsp.close();
        host.close();
    });

        test(`a note held by a vanished remote control dies away on ${kind}`, async () => {
        const generator = new FaustPolyDspGenerator();
        await generator.compile(compiler, 'remotepoly', INSTRUMENT, '-ftz 2');
        assert.ok(generator.voiceFactory, 'the voices have to have compiled');
        const node = await generator.createNode(
            audioContext(),
            VOICES,
            'remotepoly',
            generator.voiceFactory,
            generator.mixerModule,
            generator.effectFactory,
            sp,
            BLOCK
        );
        assert.ok(node, 'createNode returned nothing');
        const { host, dsp, remoteEnd } = await remoteControl(node);

        dsp.keyOn(0, 69, 127);
        await settle();
        assert.equal(isAudible(renderNode(node, FRAMES)), true, 'the note');
        assert.equal(node.getNumActiveVoices(), 1);

        // The connection drops: no goodbye, no note off from the phone
        remoteEnd.close();
        await settle();
        // INSTRUMENT releases in 0.2 s; one second frees the voice
        renderNode(node, BLOCK * Math.ceil(SAMPLE_RATE / BLOCK));
        assert.equal(node.getNumActiveVoices(), 0, 'the note was released');
        assert.equal(dsp.state, 'closed');

        host.close();
    });
}
