import { ComputeHandler, FaustBaseWebAudioDsp, FaustMonoWebAudioDsp, FaustPolyWebAudioDsp, IFaustBaseWebAudioDsp, IFaustMonoWebAudioDsp, IFaustPolyWebAudioDsp, MetadataHandler, OutputParamHandler, PlotHandler } from "./FaustWebAudioDsp";
import { AudioParamDescriptor, FaustUIItem } from "./types";

/**
 *  For offline rendering.
 */
export interface IFaustOfflineProcessor extends IFaustBaseWebAudioDsp {
    render(inputs?: Float32Array[], length?: number, onUpdate?: (sample: number) => any): Float32Array[];
}

export interface IFaustMonoOfflineProcessor extends IFaustOfflineProcessor, IFaustMonoWebAudioDsp {}
export interface IFaustPolyOfflineProcessor extends IFaustOfflineProcessor, IFaustPolyWebAudioDsp {}

export class FaustOfflineProcessor<Poly extends boolean = false> {
    protected fDSPCode!: Poly extends true ? FaustPolyWebAudioDsp : FaustMonoWebAudioDsp;

    protected fBufferSize: number;
    protected fInputs: Float32Array[];
    protected fOutputs: Float32Array[];

    constructor(instance: Poly extends true ? FaustPolyWebAudioDsp : FaustMonoWebAudioDsp, bufferSize: number) {
        this.fDSPCode = instance;
        this.fBufferSize = bufferSize;
        this.fInputs = new Array(this.fDSPCode.getNumInputs()).fill(null).map(() => new Float32Array(bufferSize));
        this.fOutputs = new Array(this.fDSPCode.getNumOutputs()).fill(null).map(() => new Float32Array(bufferSize));
    }

    // Public API

    getParameterDescriptors() {
        const params = [] as AudioParamDescriptor[];
        // Analyse voice JSON to generate AudioParam parameters
        const callback = (item: FaustUIItem) => {
            let param: AudioParamDescriptor | null = null;
            const polyKeywords = ["/gate", "/freq", "/gain", "/key", "/vel", "/velocity"];
            const isPolyReserved = "address" in item && !!polyKeywords.find(k => item.address.endsWith(k));
            if (this.fDSPCode instanceof FaustMonoWebAudioDsp || !isPolyReserved) {
                if (item.type === "vslider" || item.type === "hslider" || item.type === "nentry") {
                    param = { name: item.address, defaultValue: item.init || 0, minValue: item.min || 0, maxValue: item.max || 0 };
                } else if (item.type === "button" || item.type === "checkbox") {
                    param = { name: item.address, defaultValue: item.init || 0, minValue: 0, maxValue: 1 };
                }
            }
            if (param) params.push(param);
        }
        FaustBaseWebAudioDsp.parseUI(this.fDSPCode.getUI(), callback);
        return params;
    }
    compute(input: Float32Array[], output: Float32Array[]) { return this.fDSPCode.compute(input, output); }

    setOutputParamHandler(handler: OutputParamHandler) { this.fDSPCode.setOutputParamHandler(handler); }
    getOutputParamHandler() { return this.fDSPCode.getOutputParamHandler(); }

    setComputeHandler(handler: ComputeHandler) { this.fDSPCode.setComputeHandler(handler); }
    getComputeHandler() { return this.fDSPCode.getComputeHandler(); }

    setPlotHandler(handler: PlotHandler) { this.fDSPCode.setPlotHandler(handler); }
    getPlotHandler() { return this.fDSPCode.getPlotHandler(); }

    getNumInputs() { return this.fDSPCode.getNumInputs(); }
    getNumOutputs() { return this.fDSPCode.getNumOutputs(); }

    metadata(handler: MetadataHandler) { }

    midiMessage(data: number[] | Uint8Array) { this.fDSPCode.midiMessage(data); }

    ctrlChange(chan: number, ctrl: number, value: number) { this.fDSPCode.ctrlChange(chan, ctrl, value); }
    pitchWheel(chan: number, value: number) { this.fDSPCode.pitchWheel(chan, value); }

    setParamValue(path: string, value: number) { this.fDSPCode.setParamValue(path, value); }
    getParamValue(path: string) { return this.fDSPCode.getParamValue(path); }
    getParams() { return this.fDSPCode.getParams(); }

    getMeta() { return this.fDSPCode.getMeta(); }
    getJSON() { return this.fDSPCode.getJSON(); }
    getDescriptors() { return this.fDSPCode.getDescriptors(); }
    getUI() { return this.fDSPCode.getUI(); }

    start() { this.fDSPCode.start(); }
    stop() { this.fDSPCode.stop(); }

    destroy() { this.fDSPCode.destroy(); }

    /**
     * Render frames in an array.
     *
     * @param inputs - input signal
     * @param length - the number of frames to render (default: bufferSize)
     * @param onUpdate - a callback after each buffer calculated, with an argument "current sample"
     * @return an array of Float32Array with the rendered frames
     */
    render(inputs: Float32Array[] = [], length = this.fBufferSize, onUpdate?: (sample: number) => any): Float32Array[] {
        let l = 0;
        const outputs = new Array(this.fDSPCode.getNumOutputs()).fill(null).map(() => new Float32Array(length));
        // The node has to be started before rendering
        this.fDSPCode.start();
        while (l < length) {
            const sliceLength = Math.min(length - l, this.fBufferSize);
            for (let i = 0; i < this.fDSPCode.getNumInputs(); i++) {
                let input: Float32Array;
                if (inputs[i]) {
                    if (inputs[i].length <= l) {
                        input = new Float32Array(sliceLength);
                    } else if (inputs[i].length > l + sliceLength) {
                        input = inputs[i].subarray(l, l + sliceLength);
                    } else {
                        input = inputs[i].subarray(l, inputs[i].length);
                    }
                } else {
                    input = new Float32Array(sliceLength);
                }
                this.fInputs[i] = input;
            }
            this.fDSPCode.compute(this.fInputs, this.fOutputs);
            for (let i = 0; i < this.fDSPCode.getNumOutputs(); i++) {
                const output = this.fOutputs[i];
                if (sliceLength < this.fBufferSize) {
                    outputs[i].set(output.subarray(0, sliceLength), l);
                } else {
                    outputs[i].set(output, l);
                }
            }
            l += this.fBufferSize;
            onUpdate?.(l);
        }
        // The node can be stopped after rendering
        this.fDSPCode.stop();
        return outputs;
    }
}

export class FaustMonoOfflineProcessor extends FaustOfflineProcessor<false> implements IFaustMonoWebAudioDsp {
}

export class FaustPolyOfflineProcessor extends FaustOfflineProcessor<true> implements IFaustPolyWebAudioDsp {
    keyOn(channel: number, pitch: number, velocity: number) { this.fDSPCode.keyOn(channel, pitch, velocity); }
    keyOff(channel: number, pitch: number, velocity: number) { this.fDSPCode.keyOff(channel, pitch, velocity); }
    allNotesOff(hard: boolean) { this.fDSPCode.allNotesOff(hard); }
}

export default FaustOfflineProcessor;
