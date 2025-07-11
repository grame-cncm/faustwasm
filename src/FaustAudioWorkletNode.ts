import { OutputParamHandler, ComputeHandler, PlotHandler, UIHandler, MetadataHandler, FaustBaseWebAudioDsp, IFaustMonoWebAudioDsp, IFaustPolyWebAudioDsp } from "./FaustWebAudioDsp";
import type { FaustAudioWorkletNodeOptions } from "./FaustAudioWorkletProcessor";
import type { LooseFaustDspFactory, FaustDspMeta, FaustUIInputItem, FaustUIItem } from "./types";
import { FaustAudioWorkletNodeCommunicator } from "./FaustAudioWorkletCommunicator";

/**
 * Base class for Monophonic and Polyphonic AudioWorkletNode
 */
export class FaustAudioWorkletNode<Poly extends boolean = false> extends (globalThis.AudioWorkletNode || null) {

    protected fJSONDsp: FaustDspMeta;
    protected fJSON: string;
    protected fInputsItems: string[];
    protected fOutputHandler: OutputParamHandler | null;
    protected fComputeHandler: ComputeHandler | null;
    protected fPlotHandler: PlotHandler | null;
    protected fUICallback: UIHandler;
    protected fDescriptor: FaustUIInputItem[];
    protected fCommunicator: FaustAudioWorkletNodeCommunicator;
    #hasAccInput = false;
    #hasGyrInput = false;

    constructor(context: BaseAudioContext, name: string, factory: LooseFaustDspFactory, options: Partial<FaustAudioWorkletNodeOptions<Poly>> = {}) {

        // Create JSON object
        const JSONObj: FaustDspMeta = JSON.parse(factory.json);

        // Create proxy FaustAudioWorkletProcessor
        super(context, name, {
            numberOfInputs: JSONObj.inputs > 0 ? 1 : 0,
            numberOfOutputs: JSONObj.outputs > 0 ? 1 : 0,
            channelCount: Math.max(1, JSONObj.inputs),
            outputChannelCount: [JSONObj.outputs],
            channelCountMode: "explicit",
            channelInterpretation: "speakers",
            processorOptions: options.processorOptions,
            ...options
        });

        this.fJSONDsp = JSONObj;
        this.fJSON = factory.json;
        this.fOutputHandler = null;
        this.fComputeHandler = null;
        this.fPlotHandler = null;
        this.fDescriptor = [];

        // Parse UI
        this.fInputsItems = [];
        this.fUICallback = (item: FaustUIItem) => {
            if (item.type === "vslider" || item.type === "hslider" || item.type === "button" || item.type === "checkbox" || item.type === "nentry") {
                // Keep inputs adresses
                this.fInputsItems.push(item.address);
                this.fDescriptor.push(item);
                if (!item.meta) return;
                item.meta.forEach((meta) => {
                    const { midi, acc, gyr } = meta;
                    if (acc) this.#hasAccInput = true;
                    if (gyr) this.#hasGyrInput = true;
                });
            }
        }

        FaustBaseWebAudioDsp.parseUI(this.fJSONDsp.ui, this.fUICallback);

        this.fCommunicator = new FaustAudioWorkletNodeCommunicator(this.port);

        // Patch it with additional functions
        this.port.addEventListener("message", this.handleMessageAux);
        this.port.start();
    }

    protected handleMessageAux = (e: MessageEvent) => {
        if (e.data.type === "param" && this.fOutputHandler) {
            this.fOutputHandler(e.data.path, e.data.value);
        } else if (e.data.type === "plot" && this.fPlotHandler) {
            this.fPlotHandler(e.data.value, e.data.index, e.data.events);
        }
    };

    // Accelerometer and gyroscope handlers
    private handleDeviceMotion = ({ accelerationIncludingGravity }: DeviceMotionEvent) => {
        const isAndroid: boolean = /Android/i.test(navigator.userAgent);
        if (!accelerationIncludingGravity) return;
        const { x, y, z } = accelerationIncludingGravity;
        this.propagateAcc({ x, y, z }, isAndroid);
    };

    private handleDeviceOrientation = ({ alpha, beta, gamma }: DeviceOrientationEvent) => {
        this.propagateGyr({ alpha, beta, gamma });
    };

    // Public API

    /** Setup accelerometer and gyroscope handlers */
    async startSensors() {
        if (this.hasAccInput) {
            if (window.DeviceMotionEvent) {
                // iOS 13+ requires a user gesture to enable DeviceMotionEvent, to be done in the main thread
                window.addEventListener("devicemotion", this.handleDeviceMotion, true);
            } else {
                // Browser doesn't support DeviceMotionEvent
                console.log("Cannot set the accelerometer handler.");
            }
        }
        if (this.hasGyrInput) {
            if (window.DeviceMotionEvent) {
                // iOS 13+ requires a user gesture to enable DeviceMotionEvent, to be done in the main thread
                window.addEventListener("deviceorientation", this.handleDeviceOrientation, true);
            } else {
                // Browser doesn't support DeviceMotionEvent
                console.log("Cannot set the gyroscope handler.");
            }
        }
    }

    stopSensors() {
        if (this.hasAccInput) {
            window.removeEventListener("devicemotion", this.handleDeviceMotion, true);
        }
        if (this.hasGyrInput) {
            window.removeEventListener("deviceorientation", this.handleDeviceOrientation, true);
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
        } else {
            console.warn("No OutputParamHandler set for this Faust node.");
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
            this.port.postMessage({ type: "setPlotHandler", data: true });
        } else {
            this.port.postMessage({ type: "setPlotHandler", data: false });
        }
    }
    getPlotHandler(): PlotHandler | null {
        return this.fPlotHandler;
    }

    setupWamEventHandler() {
        this.port.postMessage({ type: "setupWamEventHandler" });
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
            this.fJSONDsp.meta.forEach(meta => handler(Object.keys(meta)[0], meta[Object.keys(meta)[0]]));
        }
    }

    midiMessage(data: number[] | Uint8Array): void {
        const cmd = data[0] >> 4;
        const channel = data[0] & 0xf;
        const data1 = data[1];
        const data2 = data[2];
        if (cmd === 11) this.ctrlChange(channel, data1, data2);
        else if (cmd === 14) this.pitchWheel(channel, data2 * 128.0 + data1);
        if (cmd === 8 || (cmd === 9 && data2 === 0)) this.keyOff(channel, data1, data2);
        else if (cmd === 9) this.keyOn(channel, data1, data2);
        else this.port.postMessage({ type: "midi", data: data });
    }

    ctrlChange(channel: number, ctrl: number, value: number) {
        const e = { type: "ctrlChange", data: [channel, ctrl, value] };
        this.port.postMessage(e);
    }
    pitchWheel(channel: number, wheel: number) {
        const e = { type: "pitchWheel", data: [channel, wheel] };
        this.port.postMessage(e);
    }
    keyOn(channel: number, pitch: number, velocity: number) {
        const e = { type: "keyOn", data: [channel, pitch, velocity] };
        this.port.postMessage(e);
    }
    keyOff(channel: number, pitch: number, velocity: number) {
        const e = { type: "keyOff", data: [channel, pitch, velocity] };
        this.port.postMessage(e);
    }

    get hasAccInput() { return this.#hasAccInput; }

    propagateAcc(accelerationIncludingGravity: NonNullable<DeviceMotionEvent["accelerationIncludingGravity"]>, invert: boolean = false) {
        if (!accelerationIncludingGravity) return;
        const { x, y, z } = accelerationIncludingGravity;
        this.fCommunicator.setAcc({ x: x!, y: y!, z: z! }, invert);
    }

    get hasGyrInput() { return this.#hasGyrInput; }

    propagateGyr(event: Pick<DeviceOrientationEvent, "alpha" | "beta" | "gamma">) {
        if (!event) return;
        const { alpha, beta, gamma } = event;
        this.fCommunicator.setGyr({ alpha: alpha!, beta: beta!, gamma: gamma! });
    }

    setParamValue(path: string, value: number) {
        const e = { type: "param", data: { path, value } };
        this.port.postMessage(e);
        // Set value on AudioParam (but this is not used on Processor side for now)
        const param = this.parameters.get(path);
        if (param) param.setValueAtTime(value, this.context.currentTime);

    }
    getParamValue(path: string) {
        // Get value of AudioParam
        const param = this.parameters.get(path);
        return (param) ? param.value : 0;
    }

    getParams() { return this.fInputsItems; }
    getMeta() { return this.fJSONDsp; }
    getJSON() { return JSON.stringify(this.getMeta()); }
    getUI() { return this.fJSONDsp.ui; }
    getDescriptors() { return this.fDescriptor; }

    start() {
        this.port.postMessage({ type: "start" });
    }

    stop() {
        this.port.postMessage({ type: "stop" });
    }

    destroy() {
        this.port.postMessage({ type: "destroy" });
        this.port.close();
    }
}

/**
 * Monophonic AudioWorkletNode
 */
export class FaustMonoAudioWorkletNode extends FaustAudioWorkletNode<false> implements IFaustMonoWebAudioDsp {

    onprocessorerror = (e: Event) => {
        // console.error("Error from " + this.fJSONDsp.name + " FaustMonoAudioWorkletNode");
        throw e;
    }

    constructor(context: BaseAudioContext, options: Partial<FaustAudioWorkletNodeOptions<false>> & Pick<FaustAudioWorkletNodeOptions<false>, "processorOptions">) {
        super(context, options.processorOptions.name, options.processorOptions.factory, options);
    }
}

/**
 * Polyphonic AudioWorkletNode
 */
export class FaustPolyAudioWorkletNode extends FaustAudioWorkletNode<true> implements IFaustPolyWebAudioDsp {

    private fJSONEffect: FaustDspMeta | null;

    onprocessorerror = (e: Event) => {
        // console.error("Error from " + this.fJSONDsp.name + " FaustPolyAudioWorkletNode");
        throw e;
    }

    constructor(context: BaseAudioContext, options: Partial<FaustAudioWorkletNodeOptions<true>> & Pick<FaustAudioWorkletNodeOptions<true>, "processorOptions">) {

        super(
            context,
            options.processorOptions.name,
            options.processorOptions.voiceFactory,
            options
        );

        this.fJSONEffect = options.processorOptions.effectFactory ? JSON.parse(options.processorOptions.effectFactory.json) : null;

        if (this.fJSONEffect) {
            FaustBaseWebAudioDsp.parseUI(this.fJSONEffect.ui, this.fUICallback);
        }
    }

    // Public API
    keyOn(channel: number, pitch: number, velocity: number) {
        const e = { type: "keyOn", data: [channel, pitch, velocity] };
        this.port.postMessage(e);
    }

    keyOff(channel: number, pitch: number, velocity: number) {
        const e = { type: "keyOff", data: [channel, pitch, velocity] };
        this.port.postMessage(e);
    }

    allNotesOff(hard: boolean) {
        const e = { type: "ctrlChange", data: [0, 123, 0] };
        this.port.postMessage(e);
    }

    getMeta() {
        const o = this.fJSONDsp;
        const e = this.fJSONEffect;
        const r = { ...o };
        if (e) {
            r.ui = [{
                type: "tgroup", label: "Sequencer", items: [
                    { type: "vgroup", label: "Instrument", items: o.ui },
                    { type: "vgroup", label: "Effect", items: e.ui }
                ]
            }];
        } else {
            r.ui = [{
                type: "tgroup", label: "Polyphonic", items: [
                    { type: "vgroup", label: "Voices", items: o.ui }
                ]
            }];
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
