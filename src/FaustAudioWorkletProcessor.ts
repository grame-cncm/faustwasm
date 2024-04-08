import type FaustWasmInstantiator from "./FaustWasmInstantiator";
import type { FaustBaseWebAudioDsp, FaustWebAudioDspVoice, FaustMonoWebAudioDsp, FaustPolyWebAudioDsp } from "./FaustWebAudioDsp";
import type { AudioParamDescriptor, AudioWorkletGlobalScope, LooseFaustDspFactory, FaustDspMeta, FaustUIItem, AudioWorkletProcessor } from "./types";

/**
 * Injected in the string to be compiled on AudioWorkletProcessor side
 */
export interface FaustData {
    processorName: string;
    dspName: string;
    dspMeta: FaustDspMeta;
    poly: boolean;
    effectMeta?: FaustDspMeta;
};
export interface FaustAudioWorkletProcessorDependencies<Poly extends boolean = false> {
    FaustBaseWebAudioDsp: typeof FaustBaseWebAudioDsp;
    FaustMonoWebAudioDsp: Poly extends true ? undefined : typeof FaustMonoWebAudioDsp;
    FaustPolyWebAudioDsp: Poly extends true ? typeof FaustPolyWebAudioDsp : undefined;
    FaustWebAudioDspVoice: Poly extends true ? typeof FaustWebAudioDspVoice : undefined;
    FaustWasmInstantiator: typeof FaustWasmInstantiator;
}
export interface FaustAudioWorkletNodeOptions<Poly extends boolean = false> extends AudioWorkletNodeOptions {
    processorOptions: Poly extends true ? FaustPolyAudioWorkletProcessorOptions : FaustMonoAudioWorkletProcessorOptions;
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
const getFaustAudioWorkletProcessor = <Poly extends boolean = false>(dependencies: FaustAudioWorkletProcessorDependencies<Poly>, faustData: FaustData, register = true): typeof AudioWorkletProcessor => {
    const { registerProcessor, AudioWorkletProcessor, sampleRate } = globalThis as unknown as AudioWorkletGlobalScope;

    const {
        FaustBaseWebAudioDsp,
        FaustWasmInstantiator
    } = dependencies;

    const {
        processorName,
        dspName,
        dspMeta,
        effectMeta,
        poly
    } = faustData;

    // Analyse voice JSON to generate AudioParam parameters
    const analysePolyParameters = (item: FaustUIItem): AudioParamDescriptor | null => {
        const polyKeywords = ["/gate", "/freq", "/gain", "/key", "/vel", "/velocity"];
        const isPolyReserved = "address" in item && !!polyKeywords.find(k => item.address.endsWith(k));
        if (poly && isPolyReserved) return null;
        if (item.type === "vslider" || item.type === "hslider" || item.type === "nentry") {
            return { name: item.address, defaultValue: item.init || 0, minValue: item.min || 0, maxValue: item.max || 0 };
        } else if (item.type === "button" || item.type === "checkbox") {
            return { name: item.address, defaultValue: item.init || 0, minValue: 0, maxValue: 1 };
        }
        return null;
    }

    /**
     * Base class for Monophonic and Polyphonic AudioWorkletProcessor
     */
    class FaustAudioWorkletProcessor<Poly extends boolean = false> extends AudioWorkletProcessor {

        // Use ! syntax when the field is not defined in the constructor
        protected fDSPCode!: Poly extends true ? FaustPolyWebAudioDsp : FaustMonoWebAudioDsp;

        protected paramValuesCache: Record<string, number> = {};

        constructor(options: FaustAudioWorkletNodeOptions<Poly>) {
            super(options);

            // Setup port message handling
            this.port.onmessage = (e: MessageEvent) => this.handleMessageAux(e);

            const { parameterDescriptors } = (this.constructor as typeof AudioWorkletProcessor);
            parameterDescriptors.forEach((pd) => {
                this.paramValuesCache[pd.name] = pd.defaultValue || 0;
            })
        }

        static get parameterDescriptors() {
            const params = [] as AudioParamDescriptor[];
            // Analyse voice JSON to generate AudioParam parameters
            const callback = (item: FaustUIItem) => {
                const param = analysePolyParameters(item);
                if (param) params.push(param);
            }
            FaustBaseWebAudioDsp.parseUI(dspMeta.ui, callback);
            // Analyse effect JSON to generate AudioParam parameters
            if (effectMeta) FaustBaseWebAudioDsp.parseUI(effectMeta.ui, callback);
            return params;
        }

        process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: { [key: string]: Float32Array }) {

            // Update controls (possibly needed for sample accurate control)
            for (const path in parameters) {
                const [paramValue] = parameters[path];
                if (paramValue !== this.paramValuesCache[path]) {
                    this.fDSPCode.setParamValue(path, paramValue);
                    this.paramValuesCache[path] = paramValue;
                }
            }

            return this.fDSPCode.compute(inputs[0], outputs[0]);
        }

        protected handleMessageAux(e: MessageEvent) { // use arrow function for binding
            const msg = e.data;

            switch (msg.type) {
                // Generic MIDI message
                case "midi": this.midiMessage(msg.data); break;
                // Typed MIDI message
                case "ctrlChange": this.ctrlChange(msg.data[0], msg.data[1], msg.data[2]); break;
                case "pitchWheel": this.pitchWheel(msg.data[0], msg.data[1]); break;
                // Generic data message
                case "param": this.setParamValue(msg.data.path, msg.data.value); break;
                // Plot handler set on demand
                case "setPlotHandler": {
                    if (msg.data) {
                        this.fDSPCode.setPlotHandler((output, index, events) => this.port.postMessage({ type: "plot", value: output, index, events }));
                    } else {
                        this.fDSPCode.setPlotHandler(null);
                    }
                    break;
                }
                case "start": {
                    this.fDSPCode.start();
                    break;
                }
                case "stop": {
                    this.fDSPCode.stop();
                    break;
                }
                case "destroy": {
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
    }

    /**
     * Monophonic AudioWorkletProcessor
     */
    class FaustMonoAudioWorkletProcessor extends FaustAudioWorkletProcessor<false> {

        constructor(options: FaustAudioWorkletNodeOptions) {
            super(options);
            const { FaustMonoWebAudioDsp } = dependencies as FaustAudioWorkletProcessorDependencies<false>;
            const { factory, sampleSize } = options.processorOptions;

            const instance = FaustWasmInstantiator.createSyncMonoDSPInstance(factory);

            // Create Monophonic DSP
            this.fDSPCode = new FaustMonoWebAudioDsp(instance, sampleRate, sampleSize, 128);

            // Check for soundfile support
            if (this.fDSPCode.hasSoundfiles()) {
                console.error("FaustAudioWorkletProcessor: Soundfile support is not implemented yet, switch to ScriptProcessorNode for now");
                return;
            }

            // Setup output handler
            this.fDSPCode.setOutputParamHandler((path, value) => this.port.postMessage({ path, value, type: "param" }));

            this.fDSPCode.start();
        }
    }

    /**
     * Polyphonic AudioWorkletProcessor
     */
    class FaustPolyAudioWorkletProcessor extends FaustAudioWorkletProcessor<true> {

        constructor(options: FaustPolyAudioWorkletNodeOptions) {
            super(options);
            const { FaustPolyWebAudioDsp } = dependencies as FaustAudioWorkletProcessorDependencies<true>;

            const { voiceFactory, mixerModule, voices, effectFactory, sampleSize } = options.processorOptions;

            const instance = FaustWasmInstantiator.createSyncPolyDSPInstance(voiceFactory, mixerModule, voices, effectFactory);

            // Create Polyphonic DSP
            this.fDSPCode = new FaustPolyWebAudioDsp(instance, sampleRate, sampleSize, 128);

            // Check for soundfile support
            if (this.fDSPCode.hasSoundfiles()) {
                console.error("FaustAudioWorkletProcessor: Soundfile support is not implemented yet, switch to ScriptProcessorNode for now");
                return;
            }

            // Setup port message handling
            this.port.onmessage = (e: MessageEvent) => this.handleMessageAux(e);

            // Setup output handler
            this.fDSPCode.setOutputParamHandler((path, value) => this.port.postMessage({ path, value, type: "param" }));

            this.fDSPCode.start();
        }

        protected midiMessage(data: number[] | Uint8Array) {
            const cmd = data[0] >> 4;
            const channel = data[0] & 0xf;
            const data1 = data[1];
            const data2 = data[2];
            if (cmd === 8 || (cmd === 9 && data2 === 0)) this.keyOff(channel, data1, data2);
            else if (cmd === 9) this.keyOn(channel, data1, data2);
            else super.midiMessage(data);
        }

        protected handleMessageAux = (e: MessageEvent) => { // use arrow function for binding
            const msg = e.data;
            switch (msg.type) {
                case "keyOn": this.keyOn(msg.data[0], msg.data[1], msg.data[2]); break;
                case "keyOff": this.keyOff(msg.data[0], msg.data[1], msg.data[2]); break;
                default:
                    super.handleMessageAux(e);
                    break;
            }
        }

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

    const Processor = poly ? FaustPolyAudioWorkletProcessor : FaustMonoAudioWorkletProcessor;
    if (register) {
        try {
            registerProcessor(processorName || dspName || (poly ? "mydsp_poly" : "mydsp"), Processor);
        } catch (error) {
            console.warn(error);
        }
    }

    return poly ? FaustPolyAudioWorkletProcessor : FaustMonoAudioWorkletProcessor;
}

export default getFaustAudioWorkletProcessor;
