import type FaustWasmInstantiator from "./FaustWasmInstantiator";
import type { FaustBaseWebAudioDsp, FaustWebAudioDspVoice, FaustMonoWebAudioDsp, FaustPolyWebAudioDsp } from "./FaustWebAudioDsp";
import type { AudioParamDescriptor, AudioWorkletGlobalScope, LooseFaustDspFactory, FaustDspMeta, FaustUIItem } from "./types";

/**
 * Injected in the string to be compiled on AudioWorkletProcessor side
 */
export interface FaustData {
    dspName: string;
    dspMeta: FaustDspMeta;
    poly: boolean;
    effectMeta?: FaustDspMeta;
};
export interface FaustAudioWorkletProcessorDependencies<Poly extends boolean = false> {
    FaustBaseWebAudioDsp: typeof FaustBaseWebAudioDsp;
    FaustMonoWebAudioDsp: Poly extends true ? undefined : typeof FaustMonoWebAudioDsp;
    FaustPolyWebAudioDsp: Poly extends true ? typeof FaustPolyWebAudioDsp : undefined;
    FaustWebAudioDspVoice: Poly extends true ? undefined : typeof FaustWebAudioDspVoice;
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
const getFaustAudioWorkletProcessor = <Poly extends boolean = false>(dependencies: FaustAudioWorkletProcessorDependencies<Poly>, faustData: FaustData) => {
    const { registerProcessor, AudioWorkletProcessor, sampleRate } = globalThis as unknown as AudioWorkletGlobalScope;

    const {
        FaustBaseWebAudioDsp,
        FaustWasmInstantiator
    } = dependencies;
    
    const {
        dspName,
        dspMeta,
        effectMeta,
        poly
    } = faustData;

    /**
     * Base class for Monophonic and Polyphonic AudioWorkletProcessor
     */
    class FaustAudioWorkletProcessor<Poly extends boolean = false> extends AudioWorkletProcessor {

        // Use ! syntax when the field is not defined in the constructor
        protected fDSPCode!: Poly extends true ? FaustPolyWebAudioDsp : FaustMonoWebAudioDsp;

        constructor(options: FaustAudioWorkletNodeOptions<Poly>) {
            super(options);

            // Setup port message handling
            this.port.onmessage = (e: MessageEvent) => { this.handleMessageAux(e); }
        }

        static get parameterDescriptors() {
            const params = [] as AudioParamDescriptor[];
            // Analyse voice JSON to generate AudioParam parameters
            const callback = (item: FaustUIItem) => {
                if (item.type === "vslider" || item.type === "hslider" || item.type === "nentry") {
                    params.push({ name: item.address, defaultValue: item.init || 0, minValue: item.min || 0, maxValue: item.max || 0 });
                } else if (item.type === "button" || item.type === "checkbox") {
                    params.push({ name: item.address, defaultValue: item.init || 0, minValue: 0, maxValue: 1 });
                }
            }
            FaustBaseWebAudioDsp.parseUI(dspMeta.ui, callback);
            // Analyse effect JSON to generate AudioParam parameters
            if (effectMeta) FaustBaseWebAudioDsp.parseUI(effectMeta.ui, callback);
            return params;
        }

        process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: { [key: string]: Float32Array }) {

            /*
            // Update controls (possibly needed for sample accurate control), deactivated for now
            for (const path in parameters) {
                const paramArray = parameters[path];
                this.fDSPCode.setParamValue(path, paramArray[0]);
            }
            */

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
                        this.fDSPCode.setPlotHandler((output, index, events) => this.port.postMessage({ type: "plot", value: output, index: index, events: events }));
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
            const { FaustMonoWebAudioDsp: FaustWebAudioMonoDSP } = dependencies as FaustAudioWorkletProcessorDependencies<false>;
            const { factory, sampleSize } = options.processorOptions;

            const instance = FaustWasmInstantiator.createSyncMonoDSPInstance(factory);
            // Create Monophonic DSP
            this.fDSPCode = new FaustWebAudioMonoDSP(instance, sampleRate, sampleSize, 128);

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
            const { FaustPolyWebAudioDsp: FaustWebAudioPolyDSP } = dependencies as FaustAudioWorkletProcessorDependencies<true>;

            const { voiceFactory, mixerModule, voices, effectFactory, sampleSize } = options.processorOptions;

            const instance = FaustWasmInstantiator.createSyncPolyDSPInstance(voiceFactory, mixerModule, voices, effectFactory);
            // Create Polyphonic DSP
            this.fDSPCode = new FaustWebAudioPolyDSP(instance, sampleRate, sampleSize, 128);

            // Setup port message handling
            this.port.onmessage = (e: MessageEvent) => { this.handleMessageAux(e); }

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

    try {
        // Synchronously compile and instantiate the wasm module
        if (poly) {
            registerProcessor(dspName || "mydsp_poly", FaustPolyAudioWorkletProcessor);
        } else {
            registerProcessor(dspName || "mydsp", FaustMonoAudioWorkletProcessor);
        }
    } catch (error) {
        console.warn(error);
    }
}

export default getFaustAudioWorkletProcessor;
