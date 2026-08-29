/**
 * An AudioWorkletGlobalScope made of ordinary objects.
 *
 * `getFaustAudioWorkletProcessor` reads `AudioWorkletProcessor`,
 * `registerProcessor`, `sampleRate` and `currentFrame` off the global scope,
 * and nothing else about the browser reaches the code these tests are about:
 * the event queue, the automation walk and the block slicing are arithmetic.
 * So they run in plain Node against a fake scope and a fake DSP, and a failure
 * points at a line rather than at a browser.
 */
import {
    FaustBaseWebAudioDsp,
    getFaustAudioWorkletProcessor
} from '../../dist/esm/index.js';

export const SAMPLE_RATE = 48000;
export const BLOCK = 128;

/** A MessagePort that hands messages straight to whoever is listening. */
export class FakePort {
    constructor() {
        this.posted = [];
        this.listeners = [];
    }
    addEventListener(type, fn) {
        if (type === 'message') this.listeners.push(fn);
    }
    start() {}
    close() {}
    postMessage(data) {
        this.posted.push(data);
    }
    /** Deliver a message as if it had arrived from the main thread. */
    send(data) {
        for (const fn of this.listeners) fn({ data });
    }
}

/**
 * A DSP that records rather than computes.
 *
 * It extends the real base class and renders through the real `renderBlock`,
 * with a `render` that only writes down the slice it was asked for. So a test
 * of the processor is also a test that the events it produced tile the block,
 * and the writes below are the ones the slicing loop actually performed.
 */
export class FakeDsp extends FaustBaseWebAudioDsp {
    constructor() {
        super(4, BLOCK, {});
        this.blocks = [];
        this.slices = [];
        this.writes = [];
        this.notes = [];
        this.midi = [];
    }
    compute(inputs, outputs, events) {
        this.blocks.push(
            (events || []).map((e) => ({ frame: e.frame, seq: e.seq }))
        );
        const parts = [];
        this.renderBlock(events, (offset, count) =>
            parts.push([offset, count])
        );
        this.slices.push(parts);
        return true;
    }
    setParamValue(path, value) {
        this.writes.push({ path, value });
    }
    keyOn(channel, pitch, velocity) {
        this.notes.push({ type: 'keyOn', channel, pitch, velocity });
    }
    keyOff(channel, pitch, velocity) {
        this.notes.push({ type: 'keyOff', channel, pitch, velocity });
    }
    ctrlChange(channel, ctrl, value) {
        this.midi.push({ type: 'ctrlChange', channel, ctrl, value });
    }
    pitchWheel(channel, wheel) {
        this.midi.push({ type: 'pitchWheel', channel, wheel });
    }
    midiMessage(data) {
        this.midi.push({ type: 'midi', data: [...data] });
    }
    start() {}
    stop() {}
    setOutputParamHandler() {}
    setInputParamHandler() {}
    setPlotHandler() {}
    destroy() {}
}

/** No accelerometer, no gyroscope, nothing to report. */
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

/**
 * The controls the fake DSP declares.
 *
 * A button and a slider is enough: `parameterDescriptors` turns both into
 * AudioParams, and the automation walk does not care which is which.
 */
const DSP_META = {
    name: 'probe',
    ui: [
        {
            type: 'vgroup',
            label: 'probe',
            items: [
                { type: 'button', address: '/probe/gate', init: 0 },
                {
                    type: 'hslider',
                    address: '/probe/vol',
                    init: 0.5,
                    min: 0,
                    max: 1
                }
            ]
        }
    ]
};

/**
 * A monophonic processor on a fake scope, with the clock in the caller's hand.
 *
 * `render` advances `currentFrame` by a block, the way the browser does
 * between calls, so a test schedules against the same clock a host would.
 */
export function monoProcessor({ meta = DSP_META } = {}) {
    const port = new FakePort();
    const dsp = new FakeDsp();
    let frame = 0;

    const scope = globalThis;
    scope.sampleRate = SAMPLE_RATE;
    scope.registerProcessor = () => {};
    scope.AudioWorkletProcessor = class {
        constructor() {
            this.port = port;
        }
    };
    Object.defineProperty(scope, 'currentFrame', {
        configurable: true,
        get: () => frame
    });

    const Processor = getFaustAudioWorkletProcessor(
        {
            // `parameterDescriptors` needs the real UI walk; nothing else of
            // the base class is reachable from a processor built on a fake DSP.
            FaustBaseWebAudioDsp,
            FaustMonoWebAudioDsp: function () {
                return dsp;
            },
            FaustWasmInstantiator: { createSyncMonoDSPInstance: () => ({}) },
            FaustAudioWorkletProcessorCommunicator: SilentCommunicator
        },
        {
            processorName: 'probe',
            dspName: 'probe',
            dspMeta: meta,
            poly: false
        },
        false
    );

    const processor = new Processor({
        processorOptions: { name: 'probe', sampleSize: 4, factory: {} }
    });

    const parameters = {};
    for (const { name, defaultValue } of Processor.parameterDescriptors) {
        parameters[name] = new Float32Array([defaultValue]);
    }

    return {
        dsp,
        port,
        processor,
        /** The frame the next `render` will start at. */
        get frame() {
            return frame;
        },
        /** Seconds, on the clock a host schedules an AudioParam against. */
        time: (f) => f / SAMPLE_RATE,
        /**
         * One block. `automation` maps a control path to either a single value
         * the block holds, or the 128 values the browser hands over when it
         * moves inside the block.
         */
        render(automation = {}) {
            const block = { ...parameters };
            for (const [path, value] of Object.entries(automation)) {
                block[path] = Array.isArray(value)
                    ? new Float32Array(value)
                    : new Float32Array([value]);
                parameters[path] = block[path].slice(-1);
            }
            processor.process([[]], [[]], block);
            frame += BLOCK;
            return dsp.blocks[dsp.blocks.length - 1];
        }
    };
}
