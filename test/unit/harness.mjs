/**
 * An AudioWorkletGlobalScope made of ordinary objects.
 *
 * `getFaustAudioWorkletProcessor` reads `AudioWorkletProcessor`,
 * `registerProcessor`, `sampleRate` and `currentFrame` off the global scope,
 * and needs nothing else from the browser. The event queue, the automation
 * walk and the block slicing are arithmetic, so they run here in plain Node
 * against a fake scope and a fake DSP.
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
 * A DSP that records instead of computing.
 *
 * It extends the real base class and goes through the real `renderBlock`, with
 * a `render` that just notes the slice it was given. So a processor test also
 * checks that the events it produced tile the block, and the writes below are
 * the ones the slicing loop really performed.
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

/**
 * The controls the fake DSP declares.
 *
 * A button and a slider are enough: `parameterDescriptors` turns both into
 * AudioParams, and the automation walk treats them alike.
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
 * A monophonic processor on the fake scope, with the clock under test control.
 *
 * `render` advances `currentFrame` by a block, as the browser does between
 * calls, so tests schedule against the same clock a host would.
 */
export function monoProcessor({ meta = DSP_META, wamInfo = false } = {}) {
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
            // `parameterDescriptors` needs the real UI walk. Nothing else of
            // the base class is reachable from a processor on a fake DSP.
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
        processorOptions: {
            name: 'probe',
            sampleSize: 4,
            factory: {},
            // Only a processor told which WAM instance it belongs to will look
            // for a param manager at all.
            ...(wamInfo ? { moduleId: 'module', instanceId: 'instance' } : {})
        }
    });

    const parameters = {};
    for (const { name, defaultValue } of Processor.parameterDescriptors) {
        parameters[name] = new Float32Array([defaultValue]);
    }

    /**
     * A WAM param manager for this processor to find.
     *
     * `setupWamEventHandler` looks the processor up through the global
     * `webAudioModules` registry and installs itself as the handler, so a test
     * of that path has to put a registry there first.
     */
    const wam = { handleEvent: null };
    scope.webAudioModules = {
        getModuleScope: () => ({ paramMgrProcessors: { instance: wam } })
    };

    return {
        dsp,
        port,
        processor,
        wam,
        /** The frame the next `render` will start at. */
        get frame() {
            return frame;
        },
        /** Seconds, on the clock a host schedules an AudioParam against. */
        time: (f) => f / SAMPLE_RATE,
        /**
         * Render one block. `automation` maps a control path to either the
         * single value the block holds, or the 128 values the browser sends
         * when the control moves inside the block.
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
