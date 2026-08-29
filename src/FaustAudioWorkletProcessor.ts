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
     * A timed event with a tie-break for the frame it lands on.
     *
     * `frame` alone does not order two events on the same sample, and a
     * `keyOff` sorting ahead of the `keyOn` that preceded it would leave a
     * voice stuck on. The three sources are ranked the way they ran before
     * events existed: the automation is the state the block starts from,
     * sensors were written next, and messages follow in the order the queue
     * hands them over, which is time order.
     */
    type FaustTimedEventSeq = FaustTimedEvent & { seq: number };

    const kFromAutomation = -2;
    const kFromSensors = -1;

    /**
     * When one control's automation stops being a series of edges and starts
     * being a ramp, and how coarsely a ramp is then followed.
     *
     * Every Faust slider is an a-rate AudioParam, so a single
     * `linearRampToValueAtTime` hands `process` 128 different values for one
     * control. Treating each of them as an edge means 128 one-frame `compute`
     * calls a block, each re-running the DSP's whole control section, and 128
     * messages to the main thread -- for a difference on a slider that nobody
     * can hear. What sample accuracy is for is the edge: a gate, a trigger, a
     * switch, which move once or twice in a block and matter to the sample. So
     * a control that changes more often than this is followed every
     * `kRampStride` changes instead, and always at its last value.
     */
    const kRampChanges = 16;
    const kRampStride = 16;

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

        /**
         * The frames one control's automation changed on, while that is being
         * worked out. Reused for the same reason `fBlockEvents` is.
         */
        protected fChangedFrames: number[] = [];

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
         * Read a message's timestamp as a whole frame on the audio clock.
         *
         * Null when it carries none, which means now.
         *
         * Both routes end in a rounded, finite number. A fraction would reach
         * `renderBlock` as a fractional slice count and a channel pointer
         * halfway through a sample; a NaN or an Infinity is worse, because it
         * compares false against everything, so it would sit at the head of
         * the queue for ever with every later event stuck behind it.
         */
        protected messageFrame(msg: FaustMessageTime): number | null {
            const frame = Number.isFinite(msg.frame as number)
                ? (msg.frame as number)
                : Number.isFinite(msg.time as number)
                  ? (msg.time as number) * sampleRate
                  : null;
            return frame === null ? null : Math.round(frame);
        }

        /**
         * Perform `apply` now, or queue it for the frame the sender asked for.
         *
         * An untimed message is applied on arrival, exactly as it was before
         * this existed: between two blocks, which is the same thing as offset
         * 0 in the one that follows. A throw from one of those escapes the
         * message handler, as it always did, and costs that message.
         *
         * A timed one is different, and has to be caught. It runs from inside
         * `process`, and the Web Audio spec's answer to a `process` that
         * throws is to fire `processorerror` and never call the node again --
         * so one malformed message would silence the device for the rest of
         * its life.
         */
        protected atTime(msg: FaustMessageTime, apply: () => void) {
            const frame = this.messageFrame(msg);
            if (frame === null) {
                apply();
                return;
            }
            const event = {
                frame,
                seq: this.fEventSeq++,
                apply: () => {
                    try {
                        apply();
                    } catch (error) {
                        console.error(
                            `Faust: a message timed for frame ${frame} threw and was dropped`,
                            error
                        );
                    }
                }
            };
            // Insert from the back. A sequencer posts in time order, so the
            // case that matters costs a comparison or two.
            let i = this.fEventQueue.length;
            while (i > 0 && this.fEventQueue[i - 1].frame > frame) i--;
            this.fEventQueue.splice(i, 0, event);
        }

        /**
         * Drop everything still queued.
         *
         * A panic -- all notes off, all sound off -- or the end of the DSP's
         * life has to reach what has not sounded yet as well as what has,
         * otherwise the notes queued behind it play afterwards, over a device
         * that was told to be quiet. Events already collected for the block
         * being rendered have been taken off the queue and still fire; the
         * flush is about the blocks after this one.
         */
        protected flushEvents() {
            this.fEventQueue.length = 0;
        }

        /** Whether a controller number is one of the MIDI panic messages. */
        protected isPanic(ctrl: number) {
            // 120 all sound off, 121 reset all controllers, 123 all notes off.
            return ctrl >= 120 && ctrl <= 123;
        }

        /**
         * One control's automation for the block, as events.
         *
         * A control the block holds through arrives as a single value, and is
         * only worth an event when it differs from what the DSP already has.
         * Otherwise every step in the array is an edge the DSP should see on
         * the frame it happens: reading only `[0]`, as this used to, rounds
         * every `setValueAtTime` up to the block boundary that follows it, and
         * loses a `1 -> 0 -> 1` inside one block entirely, which is a gate
         * that never retriggers.
         *
         * A control that changes more often than `kRampChanges` is not making
         * edges, it is ramping, and is followed at `kRampStride` instead --
         * see the constant for why.
         */
        protected collectAutomation(
            path: string,
            automation: Float32Array,
            events: FaustTimedEventSeq[]
        ) {
            const changes = this.fChangedFrames;
            changes.length = 0;
            let last = this.paramValuesCache[path];
            for (let i = 0; i < automation.length; i++) {
                if (automation[i] === last) continue;
                last = automation[i];
                changes.push(i);
            }
            if (changes.length === 0) return;
            const stride = changes.length > kRampChanges ? kRampStride : 1;
            for (let n = 0; n < changes.length; n += stride) {
                const frame = changes[n];
                events.push(this.paramEvent(path, automation[frame], frame));
            }
            // Wherever the ramp ended up is where the block leaves the control,
            // and the DSP has to be left holding it or the next block's
            // comparison starts from a value that was never written.
            const lastChange = changes.length - 1;
            if (lastChange % stride) {
                const frame = changes[lastChange];
                events.push(this.paramEvent(path, automation[frame], frame));
            }
        }

        protected paramEvent(
            path: string,
            value: number,
            frame: number
        ): FaustTimedEventSeq {
            return {
                frame,
                seq: kFromAutomation,
                apply: () => this.setParamValue(path, value)
            };
        }

        /**
         * Everything due inside the block starting at `start`.
         *
         * Three sources meet here: the automation each `AudioParam` handed
         * over for this block, whatever the sensors have to say, and the port
         * messages that were timestamped for a frame inside it.
         *
         * The result is sorted by frame, and on a tie by where it came from --
         * the order those three ran in before any of this was timed.
         */
        protected collectEvents(
            parameters: { [key: string]: Float32Array },
            start: number
        ) {
            const events = this.fBlockEvents;
            events.length = 0;
            for (const path in parameters) {
                this.collectAutomation(path, parameters[path], events);
            }
            // Sensor writes used to happen after the parameter read and before
            // `compute`, so a control that is both an AudioParam and mapped to
            // an axis took the sensor's value into the block. Keeping them as
            // an event at frame 0, ranked after the automation, keeps that.
            if (this.fCommunicator.getNewAccDataAvailable()) {
                const acc = this.fCommunicator.getAcc();
                if (acc) {
                    this.fCommunicator.setNewAccDataAvailable(false);
                    const { invert, ...data } = acc;
                    events.push({
                        frame: 0,
                        seq: kFromSensors,
                        apply: () => this.propagateAcc(data, invert)
                    });
                }
            }
            if (this.fCommunicator.getNewGyrDataAvailable()) {
                const gyr = this.fCommunicator.getGyr();
                if (gyr) {
                    this.fCommunicator.setNewGyrDataAvailable(false);
                    events.push({
                        frame: 0,
                        seq: kFromSensors,
                        apply: () => this.propagateGyr(gyr)
                    });
                }
            }
            const end = start + kBlockSize;
            let ordinal = 0;
            while (this.fEventQueue.length && this.fEventQueue[0].frame < end) {
                const event = this.fEventQueue.shift() as FaustTimedEventSeq;
                // A message whose block has already gone by is late rather
                // than lost: it happens at the top of this one. Several of
                // them all collapse onto frame 0, so the tie-break has to be
                // the order they come off the queue -- which is time order --
                // and not the order they were posted in, or a schedule that
                // arrived out of order would be replayed out of order.
                event.frame = Math.max(0, event.frame - start);
                event.seq = ordinal++;
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
            return this.fDSPCode.compute(inputs[0], outputs[0], events);
        }

        protected handleMessageAux(e: MessageEvent) {
            // use arrow function for binding
            const msg = e.data;

            switch (msg.type) {
                // Generic MIDI message
                case 'midi': {
                    this.atTime(msg, () => {
                        // A panic arriving as raw bytes means the same thing
                        // as the typed one below.
                        if (
                            msg.data[0] >> 4 === 11 &&
                            this.isPanic(msg.data[1])
                        )
                            this.flushEvents();
                        this.midiMessage(msg.data);
                    });
                    break;
                }
                // Typed MIDI message
                case 'ctrlChange': {
                    this.atTime(msg, () => {
                        if (this.isPanic(msg.data[1])) this.flushEvents();
                        this.ctrlChange(msg.data[0], msg.data[1], msg.data[2]);
                    });
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
                    // Clearing the DSP's state and then playing the notes that
                    // were queued before it would be the state coming back.
                    this.flushEvents();
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
                    // What was scheduled belongs to the stretch that was
                    // stopped; it should not be waiting when the node starts
                    // again.
                    this.flushEvents();
                    this.fDSPCode.stop();
                    break;
                }
                case 'destroy': {
                    this.flushEvents();
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

        // The base switch already routes 'keyOn' and 'keyOff' through
        // `this.keyOn` / `this.keyOff`, which are overridden below, so this is
        // only here to bind `this` for the port listener.
        protected handleMessageAux = (e: MessageEvent) => {
            super.handleMessageAux(e);
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
