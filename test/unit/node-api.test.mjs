/**
 * What the node puts on the wire.
 *
 * The node's side is small -- a `time` argument carried into the message --
 * but it is the half a host calls, and dropping the field silently turns a
 * sample-accurate schedule back into "whenever the message lands".
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

const JSON_DSP = JSON.stringify({
    name: 'probe',
    inputs: 0,
    outputs: 1,
    ui: [
        {
            type: 'vgroup',
            label: 'probe',
            items: [
                {
                    type: 'button',
                    address: '/probe/gate',
                    label: 'gate',
                    shortname: 'gate',
                    init: 0
                }
            ]
        }
    ]
});

/** A MessagePort that keeps what was posted to it. */
class FakePort {
    constructor() {
        this.posted = [];
    }
    addEventListener() {}
    start() {}
    close() {}
    postMessage(data) {
        this.posted.push(data);
    }
}

/**
 * `FaustAudioWorkletNode` extends `globalThis.AudioWorkletNode`, which is read
 * when the module is evaluated. So the stand-in has to exist before the
 * import, which means the import has to be dynamic.
 */
class FakeAudioWorkletNode {
    constructor(context) {
        this.context = context;
        this.port = new FakePort();
        this.parameters = new Map();
    }
}
// A stand-in, not an AudioWorkletNode: it carries what the class under
// test reads and nothing else.
globalThis.AudioWorkletNode = /** @type {any} */ (FakeAudioWorkletNode);

const { FaustMonoAudioWorkletNode, FaustPolyAudioWorkletNode } =
    await import('../../dist/esm/index.js');

const context = { sampleRate: 48000, currentTime: 1.5 };

function monoNode() {
    // Loosely typed on the way out: `context`, the AudioParamMap and the
    // MessagePort here are stand-ins carrying only what the node reads, and
    // the tests below reach for `parameters.set` and `port.posted`, which the
    // real declarations do not have.
    return /** @type {any} */ (
        new FaustMonoAudioWorkletNode(/** @type {any} */ (context), {
            processorOptions: {
                name: 'probe',
                sampleSize: 4,
                factory: /** @type {any} */ ({ json: JSON_DSP })
            }
        })
    );
}

function polyNode() {
    // Same stand-ins as the mono side, same reason.
    return /** @type {any} */ (
        new FaustPolyAudioWorkletNode(/** @type {any} */ (context), {
            processorOptions: {
                name: 'probe',
                sampleSize: 4,
                voices: 8,
                voiceFactory: /** @type {any} */ ({ json: JSON_DSP }),
                mixerModule: /** @type {any} */ ({})
            }
        })
    );
}

/** The messages a call posted, ignoring anything the constructor sent. */
function posted(node, run) {
    node.port.posted.length = 0;
    run();
    return node.port.posted;
}

test('keyOn carries the time it was given', () => {
    const node = monoNode();
    const [message] = posted(node, () => node.keyOn(0, 60, 100, 2.25));
    assert.deepEqual(message, {
        type: 'keyOn',
        data: [0, 60, 100],
        time: 2.25
    });
});

test('keyOn without a time carries none', () => {
    const node = monoNode();
    const [message] = posted(node, () => node.keyOn(0, 60, 100));
    assert.equal(message.type, 'keyOn');
    assert.equal(message.time, undefined);
});

test('keyOff, ctrlChange and pitchWheel carry a time too', () => {
    const node = monoNode();
    assert.equal(posted(node, () => node.keyOff(0, 60, 0, 3))[0].time, 3);
    assert.equal(posted(node, () => node.ctrlChange(0, 7, 64, 4))[0].time, 4);
    assert.equal(posted(node, () => node.pitchWheel(0, 8192, 5))[0].time, 5);
});

test('a polyphonic node carries a time on keyOn and keyOff', () => {
    const node = polyNode();
    assert.equal(posted(node, () => node.keyOn(0, 60, 100, 6))[0].time, 6);
    assert.equal(posted(node, () => node.keyOff(0, 60, 0, 7))[0].time, 7);
});

test('midiMessage passes its time down to the note it decodes', () => {
    const node = monoNode();
    const [message] = posted(node, () =>
        node.midiMessage([0x90, 60, 100], 8.5)
    );
    assert.equal(message.type, 'keyOn');
    assert.equal(message.time, 8.5);
});

test('a MIDI message with no typed form keeps its time', () => {
    const node = monoNode();
    // Program change: nothing else handles it, so it crosses as raw bytes.
    const [message] = posted(node, () => node.midiMessage([0xc0, 5, 0], 9.5));
    assert.equal(message.type, 'midi');
    assert.equal(message.time, 9.5);
});

test('setParamValue carries the time, and schedules the AudioParam for it', () => {
    const node = monoNode();
    const scheduled = [];
    node.parameters.set('/probe/gate', {
        value: 0,
        setValueAtTime: (value, time) => scheduled.push({ value, time })
    });
    const [message] = posted(node, () =>
        node.setParamValue('/probe/gate', 1, 10.25)
    );
    assert.deepEqual(message, {
        type: 'param',
        data: { path: '/probe/gate', value: 1 },
        time: 10.25
    });
    assert.deepEqual(scheduled, [{ value: 1, time: 10.25 }]);
});

test('setParamValue without a time still schedules at the context clock', () => {
    const node = monoNode();
    const scheduled = [];
    node.parameters.set('/probe/gate', {
        value: 0,
        setValueAtTime: (value, time) => scheduled.push({ value, time })
    });
    node.setParamValue('/probe/gate', 1);
    assert.deepEqual(scheduled, [{ value: 1, time: context.currentTime }]);
});

test('a rejected time leaves nothing on the wire', () => {
    const node = monoNode();
    node.parameters.set('/probe/gate', {
        value: 0,
        setValueAtTime: (value, time) => {
            // What a real AudioParam does with a negative time
            if (!(time >= 0)) throw new RangeError('time must be non-negative');
        }
    });
    node.port.posted.length = 0;
    assert.throws(() => node.setParamValue('/probe/gate', 1, -1), RangeError);
    assert.deepEqual(
        node.port.posted,
        [],
        'or the DSP holds a value the AudioParam refused'
    );
});
