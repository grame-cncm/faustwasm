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
 * Both fields are on the audio clock, the one `AudioParam` is scheduled
 * against: `time` in AudioContext seconds, `frame` in samples for a sender
 * that already counts in samples. Neither field means "on arrival".
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

    // `currentFrame` is the audio clock in samples. It advances every
    // `process` call, so it must be read then, not destructured once.
    const audioClock = globalThis as unknown as AudioWorkletGlobalScope;

    // The render quantum, fixed by the Web Audio API and matching the buffer
    // size the DSPs below are constructed with.
    const kBlockSize = 128;

    /**
     * A timed event, plus a tie-break for events sharing a frame.
     *
     * Frame alone leaves two events on the same sample unordered, and a
     * `keyOff` sorting ahead of its own `keyOn` leaves a voice stuck on. The
     * ranking is the order these three ran in before any of them were timed:
     * automation first, as the state the block starts from, then sensors, then
     * messages in the order the queue hands them over.
     */
    type FaustTimedEventSeq = FaustTimedEvent & { seq: number };

    const kFromAutomation = -2;
    const kFromSensors = -1;

    /** Stands in for the `apply` of a cancelled event. */
    const kCancelled = () => {};

    /**
     * Where a control stops looking like a series of edges and starts looking
     * like a ramp, and how coarsely a ramp is then followed.
     *
     * Every Faust slider is an a-rate AudioParam, so one
     * `linearRampToValueAtTime` gives `process` 128 distinct values for a
     * single control. Honouring each would mean 128 one-frame `compute` calls
     * per block, each re-running the DSP's control section, plus 128
     * `in-param` messages to the main thread.
     *
     * Sample accuracy is for edges -- gates, triggers, switches -- which move
     * once or twice a block. A control that changes more often than
     * `kRampChanges` is followed every `kRampStride` changes instead, plus the
     * value it ends the block on.
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
         * Sorted by frame, then by arrival. `process` drains everything up to
         * the end of the block it is about to render; the rest waits.
         */
        protected fEventQueue: FaustTimedEventSeq[] = [];
        protected fEventSeq = 0;

        /**
         * The events of the block about to be rendered.
         *
         * Refilled rather than reallocated, so a quiet block allocates
         * nothing.
         */
        protected fBlockEvents: FaustTimedEventSeq[] = [];

        /**
         * Scratch space for the frames one control's automation changed on.
         * Reused for the same reason as `fBlockEvents`.
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
         * Null if it carries none, meaning now.
         *
         * Both routes round, and both reject anything non-finite. A fraction
         * would become a fractional slice count and a channel pointer partway
         * through a sample. A NaN compares false against every frame, so a
         * queued one would stay at the head of the queue and block every event
         * behind it.
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
         * Apply `apply` now, or queue it for the frame the sender asked for.
         *
         * Untimed messages are applied on arrival, between two blocks, which
         * is equivalent to frame 0 of the next one. A throw from one of those
         * escapes the port handler and costs that message, as it always did.
         *
         * Timed ones have to catch. They run from inside `process`, and the
         * Web Audio spec's response to a `process` that throws is to fire
         * `processorerror` and stop calling the node -- so one bad message
         * would silence the device permanently.
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
            // Insert from the back: a sequencer posts in time order, so the
            // common case is a comparison or two.
            let i = this.fEventQueue.length;
            while (i > 0 && this.fEventQueue[i - 1].frame > frame) i--;
            this.fEventQueue.splice(i, 0, event);
        }

        /**
         * Cancel everything scheduled and not yet performed.
         *
         * A panic, or the end of the DSP's life, has to reach the notes that
         * have not sounded yet as well as the ones that have -- otherwise they
         * play afterwards, over a device that was told to be quiet.
         *
         * That means the queue and the rest of the block being rendered, whose
         * events have already left the queue. Messages only: automation and
         * sensor writes are the state of the controls through the block, and
         * an all-notes-off should not stop a filter sweep.
         */
        protected flushEvents() {
            this.fEventQueue.length = 0;
            for (const event of this.fBlockEvents) {
                if (event.seq >= 0) event.apply = kCancelled;
            }
        }

        /**
         * Whether a controller number silences the instrument.
         *
         * Exactly the two `FaustPolyWebAudioDsp.ctrlChange` treats as
         * all-notes-off. Not 121, which resets controllers without ending a
         * note, and not 122, which is a keyboard's local control.
         */
        protected isPanic(ctrl: number) {
            return ctrl === 120 || ctrl === 123;
        }

        /**
         * One control's automation for the block, as events.
         *
         * A control that holds arrives as a single value, worth an event only
         * if it differs from what the DSP has. A control that moves arrives as
         * 128, and each change is an edge due on its own frame.
         *
         * Reading only `[0]`, as this used to, pushes every `setValueAtTime`
         * out to the next block boundary and misses a `1 -> 0 -> 1` inside one
         * block completely -- a gate that never retriggers.
         *
         * Above `kRampChanges` the control is ramping rather than stepping,
         * and is followed at `kRampStride`. See the constants.
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
            // Always write the value the block ends on, or the next block
            // compares against a value the DSP was never given.
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
         * Three sources: the automation each `AudioParam` handed over, any new
         * sensor readings, and the port messages timestamped for a frame
         * inside the block.
         *
         * Sorted by frame, and on a tie by source -- see `FaustTimedEventSeq`.
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
            // Sensor writes used to run after the parameter read and before
            // `compute`, so a control that is both an AudioParam and mapped to
            // an axis took the sensor's value. An event at frame 0 ranked
            // after the automation preserves that.
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
                // A message whose block has passed is late, not lost: it
                // happens at the top of this one. Several of them collapse
                // onto frame 0 together, so the tie-break is the order they
                // come off the queue, which is time order. Posting order would
                // replay an out-of-order schedule out of order.
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
            // Controls, each on the frame it was scheduled for
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
                        // A panic as raw bytes, same as the typed case below
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
                    // Notes queued before the clear would put back the state
                    // it just cleared.
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
                    // What was scheduled belongs to the stretch being
                    // stopped, and should not still be waiting on restart.
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
        // `this.keyOn` / `this.keyOff`, overridden below. This exists only to
        // bind `this` for the port listener.
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
