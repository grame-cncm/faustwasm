import type { FaustAudioWorkletProcessorCommunicator } from './FaustAudioWorkletCommunicator';
import type FaustWasmInstantiator from './FaustWasmInstantiator';
import type {
    FaustBaseWebAudioDsp,
    FaustTimedEvent,
    FaustWebAudioDspVoice,
    FaustMonoWebAudioDsp,
    FaustPolyWebAudioDsp
} from './FaustWebAudioDsp';
import type {
    AudioParamDescriptor,
    AudioWorkletGlobalScope,
    LooseFaustDspFactory,
    FaustDspMeta,
    FaustUIItem
} from './types';
import type {
    AudioWorkletGlobalScope as WamAudioWorkletGlobalScope,
    WamParamMgrSDKBaseModuleScope
} from '@webaudiomodules/sdk-parammgr';

/**
 * When a port message should take effect.
 *
 * Both fields name the same clock, the one an `AudioParam` is scheduled
 * against: `time` in AudioContext seconds, `frame` in samples for a sender
 * that already counts that way. A message carrying neither happens on arrival,
 * which is what every caller got before this existed.
 */
export interface FaustMessageTime {
    /** AudioContext seconds, as passed to `AudioParam.setValueAtTime` */
    time?: number;
    /** The same instant in samples since the context started */
    frame?: number;
}

/**
 * Injected in the string to be compiled on AudioWorkletProcessor side
 */
export interface FaustData {
    processorName: string;
    dspName: string;
    dspMeta: FaustDspMeta;
    poly: boolean;
    effectMeta?: FaustDspMeta;
}
export interface FaustAudioWorkletProcessorDependencies<
    Poly extends boolean = false
> {
    FaustBaseWebAudioDsp: typeof FaustBaseWebAudioDsp;
    FaustMonoWebAudioDsp: Poly extends true
        ? undefined
        : typeof FaustMonoWebAudioDsp;
    FaustPolyWebAudioDsp: Poly extends true
        ? typeof FaustPolyWebAudioDsp
        : undefined;
    FaustWebAudioDspVoice: Poly extends true
        ? typeof FaustWebAudioDspVoice
        : undefined;
    FaustWasmInstantiator: typeof FaustWasmInstantiator;
    FaustAudioWorkletProcessorCommunicator: typeof FaustAudioWorkletProcessorCommunicator;
}
export interface FaustAudioWorkletNodeOptions<
    Poly extends boolean = false
> extends AudioWorkletNodeOptions {
    processorOptions: Poly extends true
        ? FaustPolyAudioWorkletProcessorOptions
        : FaustMonoAudioWorkletProcessorOptions;
}
export interface FaustMonoAudioWorkletNodeOptions extends AudioWorkletNodeOptions {
    processorOptions: FaustMonoAudioWorkletProcessorOptions;
}
export interface FaustPolyAudioWorkletNodeOptions extends AudioWorkletNodeOptions {
    processorOptions: FaustPolyAudioWorkletProcessorOptions;
}
export interface FaustAudioWorkletProcessorOptions {
    name: string;
    sampleSize: number;
    // for WAMs
    moduleId?: string;
    instanceId?: string;
}
export interface FaustMonoAudioWorkletProcessorOptions extends FaustAudioWorkletProcessorOptions {
    factory: LooseFaustDspFactory;
}
export interface FaustPolyAudioWorkletProcessorOptions extends FaustAudioWorkletProcessorOptions {
    voiceFactory: LooseFaustDspFactory;
    mixerModule: WebAssembly.Module;
    voices: number;
    effectFactory?: LooseFaustDspFactory;
}

// Dynamic AudioWorkletProcessor code generator
const getFaustAudioWorkletProcessor = <Poly extends boolean = false>(
    dependencies: FaustAudioWorkletProcessorDependencies<Poly>,
    faustData: FaustData,
    register = true
): typeof AudioWorkletProcessor => {
    const { registerProcessor, AudioWorkletProcessor, sampleRate } =
        globalThis as unknown as AudioWorkletGlobalScope;

    // `currentFrame` is the audio clock in samples. It advances by a block
    // between calls to `process`, so unlike `sampleRate` it has to be read at
    // call time rather than destructured once.
    const audioClock = globalThis as unknown as AudioWorkletGlobalScope;

    // The render quantum, fixed by the Web Audio API and by the buffer size
    // the DSPs below are constructed with.
    const kBlockSize = 128;

    /**
     * A timed event with the order it was created in.
     *
     * `frame` alone does not order two events on the same sample, and a
     * `keyOff` sorting ahead of the `keyOn` that preceded it would leave a
     * voice stuck on. Automation carries -1 so it always goes first: it is the
     * state the block starts from.
     */
    type FaustTimedEventSeq = FaustTimedEvent & { seq: number };

    const {
        FaustBaseWebAudioDsp,
        FaustWasmInstantiator,
        FaustAudioWorkletProcessorCommunicator
    } = dependencies;

    const { processorName, dspName, dspMeta, effectMeta, poly } = faustData;

    // Analyse voice JSON to generate AudioParam parameters
    const analysePolyParameters = (
        item: FaustUIItem
    ): AudioParamDescriptor | null => {
        const polyKeywords = [
            '/gate',
            '/freq',
            '/gain',
            '/key',
            '/vel',
            '/velocity'
        ];
        const isPolyReserved =
            'address' in item &&
            !!polyKeywords.find((k) => item.address.endsWith(k));
        if (poly && isPolyReserved) return null;
        if (
            item.type === 'vslider' ||
            item.type === 'hslider' ||
            item.type === 'nentry'
        ) {
            return {
                name: item.address,
                defaultValue: item.init || 0,
                minValue: item.min || 0,
                maxValue: item.max || 0
            };
        } else if (item.type === 'button' || item.type === 'checkbox') {
            return {
                name: item.address,
                defaultValue: item.init || 0,
                minValue: 0,
                maxValue: 1
            };
        }
        return null;
    };

    /**
     * Base class for Monophonic and Polyphonic AudioWorkletProcessor
     */
    abstract class FaustAudioWorkletProcessor<
        Poly extends boolean = false
    > extends AudioWorkletProcessor {
        // Use ! syntax when the field is not defined in the constructor
        protected fDSPCode!: Poly extends true
            ? FaustPolyWebAudioDsp
            : FaustMonoWebAudioDsp;

        protected paramValuesCache: Record<string, number> = {};

        /**
         * Port messages waiting for the block they were timestamped for.
         *
         * Kept sorted by frame and then by arrival, so two events landing on
         * the same sample happen in the order they were posted. `process`
         * drains everything up to the end of the block it is about to render;
         * anything further out waits for its own block.
         */
        protected fEventQueue: FaustTimedEventSeq[] = [];
        protected fEventSeq = 0;

        /**
         * The events of the block about to be rendered.
         *
         * One array, refilled: `process` runs on the audio thread, and on a
         * quiet block this is the only allocation it would otherwise make.
         */
        protected fBlockEvents: FaustTimedEventSeq[] = [];

        protected wamInfo?: { moduleId: string; instanceId: string };
        protected fCommunicator: FaustAudioWorkletProcessorCommunicator;

        constructor(options: FaustAudioWorkletNodeOptions<Poly>) {
            super(options);

            // Setup port message handling
            this.fCommunicator = new FaustAudioWorkletProcessorCommunicator(
                this.port
            );

            const { parameterDescriptors } = this
                .constructor as typeof AudioWorkletProcessor;
            parameterDescriptors.forEach((pd) => {
                this.paramValuesCache[pd.name] = pd.defaultValue || 0;
            });

            const { moduleId, instanceId } = options.processorOptions;
            if (!moduleId || !instanceId) return;
            this.wamInfo = { moduleId, instanceId };
        }

        static get parameterDescriptors() {
            const params = [] as AudioParamDescriptor[];
            // A path may appear once across the voice and the effect together.
            // `AudioWorkletGlobalScope.registerProcessor` rejects a duplicate
            // descriptor name, and its own message names neither the side the
            // path came from nor the fact that the two DSPs are what collided,
            // so the duplicate is caught here and reported with both.
            //
            // Deduplicating instead would compile but not work:
            // `FaustPolyWebAudioDsp.setParamValue` routes a path to the effect
            // *or* to the voices, never both, so a shared control would drive
            // one side and silently leave the other at its default. A DSP that
            // needs one value on both sides has to declare it twice, under two
            // paths, and the host must write both.
            const origin = new Map<string, string>();
            const collect = (side: string) => (item: FaustUIItem) => {
                const param = analysePolyParameters(item);
                if (!param) return;
                const previous = origin.get(param.name);
                if (previous === side) {
                    throw new Error(
                        `Faust: control "${param.name}" is declared twice in the ${side}. ` +
                            `Two widgets resolved to the same path, so one of them would be ` +
                            `unreachable. Give them distinct labels or groups.`
                    );
                }
                if (previous !== undefined) {
                    throw new Error(
                        `Faust: control "${param.name}" is declared both in the ${previous} and in the ${side}. ` +
                            `A polyphonic DSP cannot share a control path between \`process\` and \`effect\`: ` +
                            `setParamValue routes a path to one side only, so the other would keep its default. ` +
                            `Declare it under a distinct path on each side and have the host write both.`
                    );
                }
                origin.set(param.name, side);
                params.push(param);
            };
            // Analyse voice JSON to generate AudioParam parameters
            FaustBaseWebAudioDsp.parseUI(dspMeta.ui, collect('voice'));
            // Analyse effect JSON to generate AudioParam parameters
            if (effectMeta)
                FaustBaseWebAudioDsp.parseUI(effectMeta.ui, collect('effect'));
            return params;
        }

        setupWamEventHandler() {
            if (!this.wamInfo) return;
            const { moduleId, instanceId } = this.wamInfo;
            const { webAudioModules } =
                globalThis as unknown as WamAudioWorkletGlobalScope;
            const ModuleScope = webAudioModules.getModuleScope(
                moduleId
            ) as WamParamMgrSDKBaseModuleScope;
            const paramMgrProcessor =
                ModuleScope?.paramMgrProcessors?.[instanceId];
            if (!paramMgrProcessor) return;
            if (paramMgrProcessor.handleEvent) return;
            paramMgrProcessor.handleEvent = (event) => {
                if (event.type === 'wam-midi')
                    this.midiMessage(event.data.bytes);
            };
        }

        /**
         * Read a message's timestamp as a frame on the audio clock.
         *
         * Null when it carries none, which means now.
         */
        protected messageFrame(msg: FaustMessageTime): number | null {
            if (typeof msg.frame === 'number') return msg.frame;
            if (typeof msg.time === 'number')
                return Math.round(msg.time * sampleRate);
            return null;
        }

        /**
         * Perform `apply` now, or queue it for the frame the sender asked for.
         *
         * An untimed message is applied on arrival, exactly as it was before
         * this existed: between two blocks, which is the same thing as offset
         * 0 in the one that follows.
         */
        protected atTime(msg: FaustMessageTime, apply: () => void) {
            const frame = this.messageFrame(msg);
            if (frame === null) {
                apply();
                return;
            }
            const event = { frame, seq: this.fEventSeq++, apply };
            // Insert from the back. A sequencer posts in time order, so the
            // case that matters costs a comparison or two.
            let i = this.fEventQueue.length;
            while (i > 0 && this.fEventQueue[i - 1].frame > frame) i--;
            this.fEventQueue.splice(i, 0, event);
        }

        /**
         * Everything due inside the block starting at `start`.
         *
         * Two sources meet here. An `AudioParam` hands `process` its whole
         * automation for the block -- 128 values when the control moves inside
         * it, one when it holds -- and every step in that array is an edge the
         * DSP should see on the frame it happens. Reading only `[0]`, as this
         * used to, rounds every `setValueAtTime` up to the block boundary that
         * follows it, and loses a `1 -> 0 -> 1` inside one block entirely,
         * which is a gate that never retriggers. Port messages carry their own
         * timestamp and wait in the queue until the block that contains them.
         *
         * The result is sorted by frame; on a tie the automation goes first,
         * and messages follow in the order they were posted.
         */
        protected collectEvents(
            parameters: { [key: string]: Float32Array },
            start: number
        ) {
            const events = this.fBlockEvents;
            events.length = 0;
            for (const path in parameters) {
                const automation = parameters[path];
                // A control the block holds through arrives as a single value,
                // and is only worth an event when it differs from what the DSP
                // already has.
                let last = this.paramValuesCache[path];
                for (let i = 0; i < automation.length; i++) {
                    const value = automation[i];
                    if (value === last) continue;
                    last = value;
                    events.push({
                        frame: i,
                        seq: -1,
                        apply: () => this.setParamValue(path, value)
                    });
                }
            }
            const end = start + kBlockSize;
            while (this.fEventQueue.length && this.fEventQueue[0].frame < end) {
                const event = this.fEventQueue.shift() as FaustTimedEventSeq;
                // A message whose block has already gone by is late rather
                // than lost: it happens at the top of this one.
                event.frame = Math.max(0, event.frame - start);
                events.push(event);
            }
            if (events.length > 1) {
                events.sort((a, b) => a.frame - b.frame || a.seq - b.seq);
            }
            return events;
        }

        process(
            inputs: Float32Array[][],
            outputs: Float32Array[][],
            parameters: { [key: string]: Float32Array }
        ) {
            // Update controls, on the frame each change was scheduled for
            const events = this.collectEvents(
                parameters,
                audioClock.currentFrame
            );
            if (this.fCommunicator.getNewAccDataAvailable()) {
                const acc = this.fCommunicator.getAcc();
                if (acc) {
                    this.fCommunicator.setNewAccDataAvailable(false);
                    const { invert, ...data } = acc;
                    this.propagateAcc(data, invert);
                }
            }
            if (this.fCommunicator.getNewGyrDataAvailable()) {
                const gyr = this.fCommunicator.getGyr();
                if (gyr) {
                    this.fCommunicator.setNewGyrDataAvailable(false);
                    this.propagateGyr(gyr);
                }
            }

            return this.fDSPCode.compute(inputs[0], outputs[0], events);
        }

        protected handleMessageAux(e: MessageEvent) {
            // use arrow function for binding
            const msg = e.data;

            switch (msg.type) {
                // Generic MIDI message
                case 'midi': {
                    this.atTime(msg, () => this.midiMessage(msg.data));
                    break;
                }
                // Typed MIDI message
                case 'ctrlChange': {
                    this.atTime(msg, () =>
                        this.ctrlChange(msg.data[0], msg.data[1], msg.data[2])
                    );
                    break;
                }
                case 'pitchWheel': {
                    this.atTime(msg, () =>
                        this.pitchWheel(msg.data[0], msg.data[1])
                    );
                    break;
                }
                case 'keyOn': {
                    this.atTime(msg, () =>
                        this.keyOn(msg.data[0], msg.data[1], msg.data[2])
                    );
                    break;
                }
                case 'keyOff': {
                    this.atTime(msg, () =>
                        this.keyOff(msg.data[0], msg.data[1], msg.data[2])
                    );
                    break;
                }
                // Generic data message
                case 'param': {
                    this.atTime(msg, () =>
                        this.setParamValue(msg.data.path, msg.data.value)
                    );
                    break;
                }
                // Plot handler set on demand
                case 'setPlotHandler': {
                    if (msg.data) {
                        this.fDSPCode.setPlotHandler((output, index, events) =>
                            this.port.postMessage({
                                type: 'plot',
                                value: output,
                                index,
                                events
                            })
                        );
                    } else {
                        this.fDSPCode.setPlotHandler(null);
                    }
                    break;
                }
                case 'setupWamEventHandler': {
                    this.setupWamEventHandler();
                    break;
                }
                case 'init': {
                    this.fDSPCode.init();
                    break;
                }
                case 'instanceInit': {
                    this.fDSPCode.instanceInit();
                    break;
                }
                case 'instanceClear': {
                    this.fDSPCode.instanceClear();
                    break;
                }
                case 'instanceConstants': {
                    this.fDSPCode.instanceConstants();
                    break;
                }
                case 'instanceResetUserInterface': {
                    this.fDSPCode.instanceResetUserInterface();
                    break;
                }
                case 'start': {
                    this.fDSPCode.start();
                    break;
                }
                case 'stop': {
                    this.fDSPCode.stop();
                    break;
                }
                case 'destroy': {
                    this.port.close();
                    this.fDSPCode.destroy();
                    break;
                }
                default:
                    break;
            }
        }

        protected setParamValue(path: string, value: number) {
            this.fDSPCode.setParamValue(path, value);
            this.paramValuesCache[path] = value;
        }

        protected midiMessage(data: number[] | Uint8Array) {
            this.fDSPCode.midiMessage(data);
        }

        protected ctrlChange(channel: number, ctrl: number, value: number) {
            this.fDSPCode.ctrlChange(channel, ctrl, value);
        }

        protected pitchWheel(channel: number, wheel: number) {
            this.fDSPCode.pitchWheel(channel, wheel);
        }

        protected keyOn(channel: number, pitch: number, velocity: number) {
            this.fDSPCode.keyOn(channel, pitch, velocity);
        }

        protected keyOff(channel: number, pitch: number, velocity: number) {
            this.fDSPCode.keyOff(channel, pitch, velocity);
        }

        protected propagateAcc(
            accelerationIncludingGravity: NonNullable<
                DeviceMotionEvent['accelerationIncludingGravity']
            >,
            invert: boolean = false
        ) {
            this.fDSPCode.propagateAcc(accelerationIncludingGravity, invert);
        }

        protected propagateGyr(
            event: Pick<DeviceOrientationEvent, 'alpha' | 'beta' | 'gamma'>
        ) {
            this.fDSPCode.propagateGyr(event);
        }
    }

    /**
     * Monophonic AudioWorkletProcessor
     */
    class FaustMonoAudioWorkletProcessor extends FaustAudioWorkletProcessor<false> {
        constructor(options: FaustAudioWorkletNodeOptions) {
            super(options);
            const { FaustMonoWebAudioDsp } =
                dependencies as FaustAudioWorkletProcessorDependencies<false>;
            const { factory, sampleSize } = options.processorOptions;

            const instance =
                FaustWasmInstantiator.createSyncMonoDSPInstance(factory);

            // Create Monophonic DSP
            this.fDSPCode = new FaustMonoWebAudioDsp(
                instance,
                sampleRate,
                sampleSize,
                128,
                factory.soundfiles
            );

            // Setup port message handling
            this.port.addEventListener('message', this.handleMessageAux);
            this.port.start();

            // Setup output handler
            this.fDSPCode.setOutputParamHandler((path, value) =>
                this.port.postMessage({ path, value, type: 'out-param' })
            );
            this.fDSPCode.setInputParamHandler((path, value) =>
                this.port.postMessage({ path, value, type: 'in-param' })
            );

            this.fDSPCode.start();
        }

        protected handleMessageAux = (e: MessageEvent) => {
            // use arrow function for binding
            super.handleMessageAux(e);
        };
    }

    /**
     * Polyphonic AudioWorkletProcessor
     */
    class FaustPolyAudioWorkletProcessor extends FaustAudioWorkletProcessor<true> {
        constructor(options: FaustPolyAudioWorkletNodeOptions) {
            super(options);
            const { FaustPolyWebAudioDsp } =
                dependencies as FaustAudioWorkletProcessorDependencies<true>;

            const {
                voiceFactory,
                mixerModule,
                voices,
                effectFactory,
                sampleSize
            } = options.processorOptions;

            const instance = FaustWasmInstantiator.createSyncPolyDSPInstance(
                voiceFactory,
                mixerModule,
                voices,
                effectFactory
            );

            const soundfiles = {
                ...effectFactory?.soundfiles,
                ...voiceFactory.soundfiles
            };
            // Create Polyphonic DSP
            this.fDSPCode = new FaustPolyWebAudioDsp(
                instance,
                sampleRate,
                sampleSize,
                128,
                soundfiles
            );

            // Setup port message handling
            this.port.addEventListener('message', this.handleMessageAux);
            this.port.start();

            // Setup output handler
            this.fDSPCode.setOutputParamHandler((path, value) =>
                this.port.postMessage({ path, value, type: 'out-param' })
            );
            this.fDSPCode.setInputParamHandler((path, value) =>
                this.port.postMessage({ path, value, type: 'in-param' })
            );

            this.fDSPCode.start();
        }

        protected midiMessage(data: number[] | Uint8Array) {
            const cmd = data[0] >> 4;
            const channel = data[0] & 0xf;
            const data1 = data[1];
            const data2 = data[2];
            if (cmd === 8 || (cmd === 9 && data2 === 0))
                this.keyOff(channel, data1, data2);
            else if (cmd === 9) this.keyOn(channel, data1, data2);
            else super.midiMessage(data);
        }

        protected handleMessageAux = (e: MessageEvent) => {
            // use arrow function for binding
            const msg = e.data;
            switch (msg.type) {
                case 'keyOn':
                    this.atTime(msg, () =>
                        this.keyOn(msg.data[0], msg.data[1], msg.data[2])
                    );
                    break;
                case 'keyOff':
                    this.atTime(msg, () =>
                        this.keyOff(msg.data[0], msg.data[1], msg.data[2])
                    );
                    break;
                default:
                    super.handleMessageAux(e);
                    break;
            }
        };

        // Public API
        keyOn(channel: number, pitch: number, velocity: number) {
            this.fDSPCode.keyOn(channel, pitch, velocity);
        }

        keyOff(channel: number, pitch: number, velocity: number) {
            this.fDSPCode.keyOff(channel, pitch, velocity);
        }

        allNotesOff(hard: boolean) {
            this.fDSPCode.allNotesOff(hard);
        }
    }

    const Processor = poly
        ? FaustPolyAudioWorkletProcessor
        : FaustMonoAudioWorkletProcessor;
    if (register) {
        const name = processorName || dspName || (poly ? 'mydsp_poly' : 'mydsp');
        // Registering the same processor twice in one AudioWorkletGlobalScope
        // is benign — a host may add the module more than once for a given
        // context — so that case stays tolerated, tracked on the scope itself
        // rather than by matching a browser-specific error message.
        //
        // Anything else must propagate. `registerProcessor` is what gives the
        // processor its name: swallowing a failure leaves `addModule` resolving
        // successfully and the caller believing registration worked, so the
        // problem only resurfaces later as
        // "the node name '<name>' is not defined in AudioWorkletGlobalScope"
        // from the AudioWorkletNode constructor — a symptom several steps
        // removed from the cause, pointing at the name rather than at whatever
        // actually made registration fail.
        const scope = globalThis as unknown as {
            __faustRegisteredProcessors?: Set<string>;
        };
        if (!scope.__faustRegisteredProcessors) {
            scope.__faustRegisteredProcessors = new Set<string>();
        }
        if (!scope.__faustRegisteredProcessors.has(name)) {
            registerProcessor(name, Processor);
            scope.__faustRegisteredProcessors.add(name);
        }
    }

    return poly
        ? FaustPolyAudioWorkletProcessor
        : FaustMonoAudioWorkletProcessor;
};

export default getFaustAudioWorkletProcessor;
