import {
    InputParamHandler,
    OutputParamHandler,
    ComputeHandler,
    PlotHandler,
    UIHandler,
    MetadataHandler,
    FaustBaseWebAudioDsp,
    IFaustMonoWebAudioDsp,
    IFaustPolyWebAudioDsp
} from './FaustWebAudioDsp';
import type { FaustAudioWorkletNodeOptions } from './FaustAudioWorkletProcessor';
import type {
    LooseFaustDspFactory,
    FaustDspMeta,
    FaustUIInputItem,
    FaustUIItem
} from './types';
import { FaustAudioWorkletNodeCommunicator } from './FaustAudioWorkletCommunicator';

/**
 * Base class for Monophonic and Polyphonic AudioWorkletNode
 */
export class FaustAudioWorkletNode<
    Poly extends boolean = false
> extends (globalThis.AudioWorkletNode || null) {
    protected fJSONDsp: FaustDspMeta;
    protected fJSON: string;
    protected fInputsItems: string[];
    protected fOutputHandler: OutputParamHandler | null;
    protected fInputHandler: InputParamHandler | null;
    protected fComputeHandler: ComputeHandler | null;
    protected fPlotHandler: PlotHandler | null;
    protected fUICallback: UIHandler;
    protected fDescriptor: FaustUIInputItem[];
    protected fCommunicator: FaustAudioWorkletNodeCommunicator;
    protected fParamAliases: Record<string, string>;
    #hasAccInput = false;
    #hasGyrInput = false;

    constructor(
        context: BaseAudioContext,
        name: string,
        factory: LooseFaustDspFactory,
        options: Partial<FaustAudioWorkletNodeOptions<Poly>> = {}
    ) {
        // Create JSON object
        const JSONObj: FaustDspMeta = JSON.parse(factory.json);

        // Create proxy FaustAudioWorkletProcessor
        super(context, name, {
            numberOfInputs: JSONObj.inputs > 0 ? 1 : 0,
            numberOfOutputs: JSONObj.outputs > 0 ? 1 : 0,
            channelCount: Math.max(1, JSONObj.inputs),
            outputChannelCount: [JSONObj.outputs],
            channelCountMode: 'explicit',
            channelInterpretation: 'speakers',
            processorOptions: options.processorOptions,
            ...options
        });

        this.fJSONDsp = JSONObj;
        this.fJSON = factory.json;
        this.fOutputHandler = null;
        this.fInputHandler = null;
        this.fComputeHandler = null;
        this.fPlotHandler = null;
        this.fDescriptor = [];
        this.fParamAliases = {};

        // Parse UI
        this.fInputsItems = [];
        this.fUICallback = (item: FaustUIItem) => {
            if (
                item.type === 'vslider' ||
                item.type === 'hslider' ||
                item.type === 'button' ||
                item.type === 'checkbox' ||
                item.type === 'nentry'
            ) {
                // Keep inputs adresses
                this.fInputsItems.push(item.address);
                this.fDescriptor.push(item);
                const registerAlias = (alias: string) => {
                    if (!this.fParamAliases[alias]) {
                        this.fParamAliases[alias] = item.address;
                    }
                };
                registerAlias(item.shortname);
                registerAlias(item.label);
                if (!item.meta) return;
                item.meta.forEach((meta) => {
                    const { midi, acc, gyr } = meta;
                    if (acc) this.#hasAccInput = true;
                    if (gyr) this.#hasGyrInput = true;
                });
            }
        };

        FaustBaseWebAudioDsp.parseUI(this.fJSONDsp.ui, this.fUICallback);

        this.fCommunicator = new FaustAudioWorkletNodeCommunicator(this.port);

        // Patch it with additional functions
        this.port.addEventListener('message', this.handleMessageAux);
        this.port.start();
    }

    protected handleMessageAux = (e: MessageEvent) => {
        if (e.data.type === 'out-param' && this.fOutputHandler) {
            this.fOutputHandler(e.data.path, e.data.value);
        } else if (e.data.type === 'in-param' && this.fInputHandler) {
            this.fInputHandler(e.data.path, e.data.value);
        } else if (e.data.type === 'plot' && this.fPlotHandler) {
            this.fPlotHandler(e.data.value, e.data.index, e.data.events);
        }
    };

    // Accelerometer and gyroscope handlers
    private handleDeviceMotion = ({
        accelerationIncludingGravity
    }: DeviceMotionEvent) => {
        const isAndroid: boolean = /Android/i.test(navigator.userAgent);
        if (!accelerationIncludingGravity) return;
        const { x, y, z } = accelerationIncludingGravity;
        this.propagateAcc({ x, y, z }, isAndroid);
    };

    private handleDeviceOrientation = ({
        alpha,
        beta,
        gamma
    }: DeviceOrientationEvent) => {
        this.propagateGyr({ alpha, beta, gamma });
    };

    // Public API

    /** Setup accelerometer and gyroscope handlers */
    async startSensors() {
        if (this.hasAccInput) {
            if (window.DeviceMotionEvent) {
                // iOS 13+ requires a user gesture to enable DeviceMotionEvent, to be done in the main thread
                window.addEventListener(
                    'devicemotion',
                    this.handleDeviceMotion,
                    true
                );
            } else {
                // Browser doesn't support DeviceMotionEvent
                console.log('Cannot set the accelerometer handler.');
            }
        }
        if (this.hasGyrInput) {
            if (window.DeviceMotionEvent) {
                // iOS 13+ requires a user gesture to enable DeviceMotionEvent, to be done in the main thread
                window.addEventListener(
                    'deviceorientation',
                    this.handleDeviceOrientation,
                    true
                );
            } else {
                // Browser doesn't support DeviceMotionEvent
                console.log('Cannot set the gyroscope handler.');
            }
        }
    }

    stopSensors() {
        if (this.hasAccInput) {
            window.removeEventListener(
                'devicemotion',
                this.handleDeviceMotion,
                true
            );
        }
        if (this.hasGyrInput) {
            window.removeEventListener(
                'deviceorientation',
                this.handleDeviceOrientation,
                true
            );
        }
    }

    setOutputParamHandler(handler: OutputParamHandler | null) {
        this.fOutputHandler = handler;
    }
    getOutputParamHandler() {
        return this.fOutputHandler;
    }
    callOutputParamHandler(path: string, value: number) {
        if (this.fOutputHandler) {
            this.fOutputHandler(path, value);
        }
    }

    setInputParamHandler(handler: InputParamHandler | null) {
        this.fInputHandler = handler;
    }
    getInputParamHandler() {
        return this.fInputHandler;
    }
    callInputParamHandler(path: string, value: number) {
        if (this.fInputHandler) {
            this.fInputHandler(path, value);
        }
    }

    setComputeHandler(handler: ComputeHandler | null) {
        this.fComputeHandler = handler;
    }
    getComputeHandler(): ComputeHandler | null {
        return this.fComputeHandler;
    }

    setPlotHandler(handler: PlotHandler | null) {
        this.fPlotHandler = handler;
        // Set PlotHandler on processor side
        if (this.fPlotHandler) {
            this.port.postMessage({ type: 'setPlotHandler', data: true });
        } else {
            this.port.postMessage({ type: 'setPlotHandler', data: false });
        }
    }
    getPlotHandler(): PlotHandler | null {
        return this.fPlotHandler;
    }

    setupWamEventHandler() {
        this.port.postMessage({ type: 'setupWamEventHandler' });
    }

    getNumInputs() {
        return this.fJSONDsp.inputs;
    }
    getNumOutputs() {
        return this.fJSONDsp.outputs;
    }

    // Implemented in subclasses
    compute(inputs: Float32Array[], outputs: Float32Array[]) {
        return false;
    }

    metadata(handler: MetadataHandler) {
        if (this.fJSONDsp.meta) {
            this.fJSONDsp.meta.forEach((meta) =>
                handler(Object.keys(meta)[0], meta[Object.keys(meta)[0]])
            );
        }
    }

    /**
     * `time` is AudioContext seconds, the clock `AudioParam` methods take.
     *
     * Given one, the processor holds the message until the block that contains
     * that instant and applies it on the sample rather than at the top of
     * whichever block the message happened to arrive in. Left out, the message
     * is applied on arrival, as it always was.
     *
     * A time that has already gone by is late rather than refused: the message
     * happens at the top of the next block. `setParamValue` is the exception,
     * because it writes an `AudioParam` too and `setValueAtTime` throws on a
     * negative time -- there the caller hears about it.
     */
    midiMessage(data: number[] | Uint8Array, time?: number): void {
        const cmd = data[0] >> 4;
        const channel = data[0] & 0xf;
        const data1 = data[1];
        const data2 = data[2];
        if (cmd === 11) this.ctrlChange(channel, data1, data2, time);
        else if (cmd === 14)
            this.pitchWheel(channel, data2 * 128.0 + data1, time);
        if (cmd === 8 || (cmd === 9 && data2 === 0))
            this.keyOff(channel, data1, data2, time);
        else if (cmd === 9) this.keyOn(channel, data1, data2, time);
        else this.port.postMessage({ type: 'midi', data: data, time });
    }

    ctrlChange(channel: number, ctrl: number, value: number, time?: number) {
        const e = { type: 'ctrlChange', data: [channel, ctrl, value], time };
        this.port.postMessage(e);
    }
    pitchWheel(channel: number, wheel: number, time?: number) {
        const e = { type: 'pitchWheel', data: [channel, wheel], time };
        this.port.postMessage(e);
    }
    keyOn(channel: number, pitch: number, velocity: number, time?: number) {
        const e = { type: 'keyOn', data: [channel, pitch, velocity], time };
        this.port.postMessage(e);
    }
    keyOff(channel: number, pitch: number, velocity: number, time?: number) {
        const e = { type: 'keyOff', data: [channel, pitch, velocity], time };
        this.port.postMessage(e);
    }

    get hasAccInput() {
        return this.#hasAccInput;
    }

    propagateAcc(
        accelerationIncludingGravity: NonNullable<
            DeviceMotionEvent['accelerationIncludingGravity']
        >,
        invert: boolean = false
    ) {
        if (!accelerationIncludingGravity) return;
        const { x, y, z } = accelerationIncludingGravity;
        this.fCommunicator.setAcc({ x: x!, y: y!, z: z! }, invert);
    }

    get hasGyrInput() {
        return this.#hasGyrInput;
    }

    propagateGyr(
        event: Pick<DeviceOrientationEvent, 'alpha' | 'beta' | 'gamma'>
    ) {
        if (!event) return;
        const { alpha, beta, gamma } = event;
        this.fCommunicator.setGyr({
            alpha: alpha!,
            beta: beta!,
            gamma: gamma!
        });
    }

    /**
     * `time` is AudioContext seconds; see `midiMessage`.
     *
     * Unlike the notes, a negative `time` throws rather than arriving late,
     * and nothing is sent: it is `AudioParam.setValueAtTime` that refuses it,
     * and that call is made first for exactly that reason.
     */
    setParamValue(path: string, value: number, time?: number) {
        const resolved = this.fParamAliases[path] || path;
        // The AudioParam goes first, because it is the half that can refuse:
        // `setValueAtTime` throws on a negative time and on a NaN. Posting the
        // message before finding that out would leave the DSP holding a value
        // the AudioParam never took, with the caller holding an exception and
        // no way to know the write had already gone.
        //
        // Keeping the two in step is the point of writing both: `getParamValue`
        // and any automation scheduled afterwards start from what was written,
        // and the processor now reads that automation per sample, so the two
        // routes agree on the value and on the frame. Whichever the DSP sees
        // second is a write of what it already holds.
        const param = this.parameters.get(resolved);
        if (param)
            param.setValueAtTime(value, time ?? this.context.currentTime);
        this.port.postMessage({
            type: 'param',
            data: { path: resolved, value },
            time
        });
    }
    getParamValue(path: string) {
        // Get value of AudioParam
        const resolved = this.fParamAliases[path] || path;
        const param = this.parameters.get(resolved);
        return param ? param.value : 0;
    }

    getParams() {
        return this.fInputsItems;
    }
    getMeta() {
        return this.fJSONDsp;
    }
    getJSON() {
        return JSON.stringify(this.getMeta());
    }
    getUI() {
        return this.fJSONDsp.ui;
    }
    getDescriptors() {
        return this.fDescriptor;
    }

    init() {
        this.port.postMessage({ type: 'init' });
    }

    instanceInit() {
        this.port.postMessage({ type: 'instanceInit' });
    }

    instanceClear() {
        this.port.postMessage({ type: 'instanceClear' });
    }

    instanceConstants() {
        this.port.postMessage({ type: 'instanceConstants' });
    }

    instanceResetUserInterface() {
        this.port.postMessage({ type: 'instanceResetUserInterface' });
    }

    start() {
        this.port.postMessage({ type: 'start' });
    }

    stop() {
        this.port.postMessage({ type: 'stop' });
    }

    destroy() {
        this.port.postMessage({ type: 'destroy' });
        this.port.close();
    }
}

/**
 * Monophonic AudioWorkletNode
 */
export class FaustMonoAudioWorkletNode
    extends FaustAudioWorkletNode<false>
    implements IFaustMonoWebAudioDsp
{
    onprocessorerror = (e: Event) => {
        // console.error("Error from " + this.fJSONDsp.name + " FaustMonoAudioWorkletNode");
        throw e;
    };

    constructor(
        context: BaseAudioContext,
        options: Partial<FaustAudioWorkletNodeOptions<false>> &
            Pick<FaustAudioWorkletNodeOptions<false>, 'processorOptions'>
    ) {
        super(
            context,
            options.processorOptions.name,
            options.processorOptions.factory,
            options
        );
    }
}

/**
 * Polyphonic AudioWorkletNode
 */
export class FaustPolyAudioWorkletNode
    extends FaustAudioWorkletNode<true>
    implements IFaustPolyWebAudioDsp
{
    private fJSONEffect: FaustDspMeta | null;

    onprocessorerror = (e: Event) => {
        // console.error("Error from " + this.fJSONDsp.name + " FaustPolyAudioWorkletNode");
        throw e;
    };

    constructor(
        context: BaseAudioContext,
        options: Partial<FaustAudioWorkletNodeOptions<true>> &
            Pick<FaustAudioWorkletNodeOptions<true>, 'processorOptions'>
    ) {
        super(
            context,
            options.processorOptions.name,
            options.processorOptions.voiceFactory,
            options
        );

        this.fJSONEffect = options.processorOptions.effectFactory
            ? JSON.parse(options.processorOptions.effectFactory.json)
            : null;

        if (this.fJSONEffect) {
            FaustBaseWebAudioDsp.parseUI(this.fJSONEffect.ui, this.fUICallback);
        }
    }

    // Public API
    // `keyOn` and `keyOff` are inherited: the base posts the same message, and
    // the processor routes it to the polyphonic DSP.

    allNotesOff(hard: boolean) {
        const e = { type: 'ctrlChange', data: [0, 123, 0] };
        this.port.postMessage(e);
    }

    getMeta() {
        const o = this.fJSONDsp;
        const e = this.fJSONEffect;
        const r = { ...o };
        if (e) {
            r.ui = [
                {
                    type: 'tgroup',
                    label: 'Sequencer',
                    items: [
                        { type: 'vgroup', label: 'Instrument', items: o.ui },
                        { type: 'vgroup', label: 'Effect', items: e.ui }
                    ]
                }
            ];
        } else {
            r.ui = [
                {
                    type: 'tgroup',
                    label: 'Polyphonic',
                    items: [{ type: 'vgroup', label: 'Voices', items: o.ui }]
                }
            ];
        }
        return r as FaustDspMeta;
    }

    getJSON() {
        return JSON.stringify(this.getMeta());
    }

    getUI() {
        return this.getMeta().ui;
    }
}
