/**
 * A Web Audio API made of ordinary objects.
 *
 * `test/unit/harness.mjs` fakes the AudioWorklet *global scope*, which is
 * enough to drive a processor. This one fakes the other half: the main-thread
 * API `FaustDspGenerator.createNode` calls into -- an AudioContext, its
 * `audioWorklet.addModule`, `createScriptProcessor`, `AudioWorkletNode`,
 * `ScriptProcessorNode` and `AudioParam`. With both halves in one process a
 * node can be created the way a page creates it and then rendered, so a test
 * can ask the question a page asks: does sound come out?
 *
 * Nothing here models the graph. There are no connections, no destination and
 * no scheduler: `renderNode` calls the node's own render entry point (a
 * processor's `process`, a ScriptProcessor's `onaudioprocess`) block by block,
 * which is what the browser does to a connected node and all that separates a
 * node from its samples.
 *
 * The clock is shared and manual. `currentFrame` on the worklet scope and
 * `currentTime` on a context read the same counter, which only `renderNode`
 * advances, so a time passed to `setParamValue` means the same instant on both
 * sides -- as it does in a browser, and as a test needs it to if it is to
 * schedule anything.
 */
import { resolveObjectURL } from 'node:buffer';

/** The render quantum, fixed by the Web Audio API. */
export const BLOCK = 128;

/** The audio clock, in frames since the fake context started. */
const clock = { frame: 0 };

/** Put the clock back to zero, so one test cannot age another's schedule. */
export const resetClock = () => {
    clock.frame = 0;
};

/** A MessagePort that hands messages straight to its peer. */
class FakePort {
    constructor() {
        this.peer = null;
        this.listeners = [];
        this.closed = false;
    }
    addEventListener(type, fn) {
        if (type === 'message') this.listeners.push(fn);
    }
    removeEventListener(type, fn) {
        if (type !== 'message') return;
        this.listeners = this.listeners.filter((listener) => listener !== fn);
    }
    start() {}
    close() {
        this.closed = true;
    }
    postMessage(data) {
        if (this.closed) return;
        // Synchronous where a real port is asynchronous. Both preserve the
        // order messages were sent in, and the audio thread is not running
        // concurrently here, so the difference is not observable from a test
        // that renders between the messages it sends.
        for (const fn of this.peer.listeners) fn({ data });
    }
}

/** Two ports, each delivering to the other. */
const portPair = () => {
    const a = new FakePort();
    const b = new FakePort();
    a.peer = b;
    b.peer = a;
    return [a, b];
};

/**
 * An AudioParam with `setValueAtTime` and nothing else.
 *
 * That is the only method `FaustAudioWorkletNode.setParamValue` calls, and
 * ramps would not be exercised: every Faust control is written as a step. The
 * per-sample values a block sees are derived from the schedule, so a value set
 * for an instant inside a block lands on that sample and the processor's
 * automation walk sees the same edge a browser would give it.
 */
class FakeAudioParam {
    constructor(defaultValue, sampleRate) {
        this.defaultValue = defaultValue;
        this.sampleRate = sampleRate;
        /** @type {{ time: number, value: number }[]} sorted by time */
        this.events = [];
    }
    setValueAtTime(value, time) {
        // What a real AudioParam rejects, and what `setParamValue` leans on to
        // refuse a negative time before it posts anything.
        if (!Number.isFinite(time) || time < 0) {
            throw new RangeError(`invalid time ${time}`);
        }
        this.events.push({ time, value });
        this.events.sort((a, b) => a.time - b.time);
        return this;
    }
    valueAt(time) {
        let value = this.defaultValue;
        for (const event of this.events) {
            if (event.time > time) break;
            value = event.value;
        }
        return value;
    }
    get value() {
        return this.valueAt(clock.frame / this.sampleRate);
    }
    /**
     * The values one block sees, in the shape the browser hands `process`:
     * a single value while the control holds still, 128 while it moves.
     *
     * @param {number} frame - the first frame of the block
     * @returns {Float32Array}
     */
    blockValues(frame) {
        const values = new Float32Array(BLOCK);
        for (let i = 0; i < BLOCK; i += 1) {
            values[i] = this.valueAt((frame + i) / this.sampleRate);
        }
        return values.every((value) => value === values[0])
            ? values.subarray(0, 1)
            : values;
    }
}

/** The processor classes `registerProcessor` has been given, by name. */
const processors = new Map();

/**
 * The port a processor about to be constructed will find on itself.
 *
 * A real `AudioWorkletProcessor` is handed its end of the pair by the runtime
 * before its constructor runs; the fake node below puts it here first.
 */
let pendingPort = null;

/** The base class a generated processor extends. */
class FakeAudioWorkletProcessor {
    constructor() {
        this.port = pendingPort;
    }
}

/**
 * The base class `FaustAudioWorkletNode` extends.
 *
 * Constructing one instantiates the registered processor in this same
 * process and wires the two ports together, so everything the node sends --
 * parameters, notes, MIDI, the lot -- reaches the real processor.
 */
class FakeAudioWorkletNode {
    constructor(context, name, options = {}) {
        const Processor = processors.get(name);
        if (!Processor) {
            // The browser's wording, since `createNode` catches this and
            // rewrites it into advice about the worklet console.
            throw new Error(
                `the node name '${name}' is not defined in AudioWorkletGlobalScope`
            );
        }
        this.context = context;
        this.numberOfInputs = options.numberOfInputs ?? 1;
        this.numberOfOutputs = options.numberOfOutputs ?? 1;
        this.channelCount = options.channelCount ?? 2;
        this.outputChannelCount = options.outputChannelCount ?? [2];

        const [nodePort, processorPort] = portPair();
        this.port = nodePort;

        this.parameters = new Map(
            Processor.parameterDescriptors.map((descriptor) => [
                descriptor.name,
                new FakeAudioParam(
                    descriptor.defaultValue ?? 0,
                    context.sampleRate
                )
            ])
        );

        pendingPort = processorPort;
        try {
            this.processor = new Processor(options);
        } finally {
            pendingPort = null;
        }
    }
    connect() {
        return this;
    }
    disconnect() {}
}

/** The base class `FaustScriptProcessorNode` extends. */
class FakeScriptProcessorNode {
    constructor(bufferSize, inputChannels, outputChannels) {
        // Own properties, not prototype members: `createNode` swaps this
        // object's prototype for the Faust class, and only own properties
        // survive that.
        this.bufferSize = bufferSize;
        this.numberOfInputChannels = inputChannels;
        this.numberOfOutputChannels = outputChannels;
        this.onaudioprocess = null;
        this.connect = () => this;
        this.disconnect = () => {};
    }
}

/**
 * Install the globals the node classes read when the bundle is evaluated.
 *
 * `FaustAudioWorkletNode` and `FaustScriptProcessorNode` extend
 * `globalThis.AudioWorkletNode` and `globalThis.ScriptProcessorNode` at module
 * evaluation time, so this has to run before the bundle is imported -- which
 * is why a test that uses it imports `dist/esm` dynamically.
 *
 * @param {number} sampleRate
 */
export const installWebAudio = (sampleRate) => {
    globalThis.sampleRate = sampleRate;
    globalThis.AudioWorkletProcessor = /** @type {any} */ (
        FakeAudioWorkletProcessor
    );
    globalThis.AudioWorkletNode = /** @type {any} */ (FakeAudioWorkletNode);
    globalThis.ScriptProcessorNode = /** @type {any} */ (
        FakeScriptProcessorNode
    );
    globalThis.registerProcessor = (name, Processor) => {
        processors.set(name, Processor);
    };
    Object.defineProperty(globalThis, 'currentFrame', {
        configurable: true,
        get: () => clock.frame
    });
    Object.defineProperty(globalThis, 'currentTime', {
        configurable: true,
        get: () => clock.frame / sampleRate
    });
};

/** An AudioContext with the three members `createNode` uses. */
export class FakeAudioContext {
    constructor(sampleRate) {
        this.sampleRate = sampleRate;
        this.audioWorklet = {
            /**
             * Run a module in this process instead of in a worklet thread.
             *
             * The URL is the blob `createNode` built out of the class sources
             * it serialised, so this is the generated processor code itself,
             * evaluated as a script -- the step that turns a class body with a
             * missing dependency into a failure. Wrapped in a function so its
             * top-level declarations stay local and a second module can be
             * added without colliding with the first.
             */
            addModule: async (url) => {
                const blob = resolveObjectURL(url);
                if (!blob) throw new Error(`cannot resolve ${url}`);
                new Function(await blob.text())();
            }
        };
    }
    get currentTime() {
        return clock.frame / this.sampleRate;
    }
    createScriptProcessor(bufferSize, inputChannels, outputChannels) {
        return new FakeScriptProcessorNode(
            bufferSize,
            inputChannels,
            outputChannels
        );
    }
}

/** Fresh output channels for one block. */
const blockOutputs = (channels, length) =>
    Array.from({ length: channels }, () => new Float32Array(length));

/**
 * Render `frames` samples out of a node, block by block.
 *
 * Works for either kind of node: an AudioWorklet node is driven through its
 * processor's `process`, a ScriptProcessor node through the
 * `onaudioprocess` handler `setupNode` installed, each in blocks of the size
 * the browser would use. The clock advances between blocks, so a node's own
 * `context.currentTime` moves as it renders.
 *
 * @param {any} node
 * @param {number} frames - a whole number of blocks
 * @param {Float32Array[]} [inputs] - the whole input signal, per channel
 * @returns {Float32Array[]} the rendered output, per channel
 */
export const renderNode = (node, frames, inputs = []) => {
    const outputs = node.getNumOutputs();
    const rendered = blockOutputs(outputs, frames);
    const size = node.onaudioprocess ? node.bufferSize : BLOCK;

    for (let at = 0; at < frames; at += size) {
        const blockIn = inputs.map((channel) =>
            channel.subarray(at, at + size)
        );
        const blockOut = blockOutputs(outputs, size);

        if (node.onaudioprocess) {
            // What a ScriptProcessorNode hands its callback: two AudioBuffers,
            // reachable only through `getChannelData`.
            node.onaudioprocess({
                inputBuffer: { getChannelData: (chan) => blockIn[chan] },
                outputBuffer: { getChannelData: (chan) => blockOut[chan] }
            });
        } else {
            const parameters = {};
            for (const [name, param] of node.parameters) {
                parameters[name] = param.blockValues(clock.frame);
            }
            node.processor.process([blockIn], [blockOut], parameters);
        }

        blockOut.forEach((channel, i) => rendered[i].set(channel, at));
        clock.frame += size;
    }
    return rendered;
};
