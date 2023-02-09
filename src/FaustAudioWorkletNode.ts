import { OutputParamHandler, ComputeHandler, PlotHandler, UIHandler, MetadataHandler, FaustBaseWebAudioDsp, IFaustMonoWebAudioDsp, IFaustPolyWebAudioDsp } from "./FaustWebAudioDsp";
import type { FaustAudioWorkletNodeOptions } from "./FaustAudioWorkletProcessor";
import type { LooseFaustDspFactory, FaustDspMeta, FaustUIInputItem, FaustUIItem } from "./types";

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

    constructor(context: BaseAudioContext, name: string, factory: LooseFaustDspFactory, options: FaustAudioWorkletNodeOptions<Poly>["processorOptions"], nodeOptions: Partial<FaustAudioWorkletNodeOptions> = {}) {

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
            processorOptions: options,
            ...nodeOptions
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
            }
        }
        FaustBaseWebAudioDsp.parseUI(this.fJSONDsp.ui, this.fUICallback);

        // Patch it with additional functions
        this.port.onmessage = (e: MessageEvent) => {
            if (e.data.type === "param" && this.fOutputHandler) {
                this.fOutputHandler(e.data.path, e.data.value);
            } else if (e.data.type === "plot" && this.fPlotHandler) {
                this.fPlotHandler(e.data.value, e.data.index, e.data.events);
            }
        };
    }

    // Public API
    setOutputParamHandler(handler: OutputParamHandler | null) {
        this.fOutputHandler = handler;
    }
    getOutputParamHandler() {
        return this.fOutputHandler;
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

    constructor(context: BaseAudioContext, name: string, factory: LooseFaustDspFactory, sampleSize: number, nodeOptions: Partial<FaustAudioWorkletNodeOptions> = {}) {
        super(context, name, factory, { name, factory, sampleSize }, nodeOptions);
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

    constructor(context: BaseAudioContext,
        name: string,
        voiceFactory: LooseFaustDspFactory,
        mixerModule: WebAssembly.Module,
        voices: number,
        sampleSize: number,
        effectFactory?: LooseFaustDspFactory, nodeOptions: Partial<FaustAudioWorkletNodeOptions> = {}) {

        super(
            context,
            name,
            voiceFactory,
            {
                name,
                voiceFactory,
                mixerModule,
                voices,
                sampleSize,
                effectFactory
            },
            nodeOptions
        );

        this.fJSONEffect = effectFactory ? JSON.parse(effectFactory.json) : null;

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
