import type { FaustMonoDspInstance } from "./FaustDspInstance";
import type FaustWasmInstantiator from "./FaustWasmInstantiator";
import type { FaustBaseWebAudioDsp, FaustMonoWebAudioDsp, PlotHandler } from "./FaustWebAudioDsp";
import type { AudioParamDescriptor, AudioWorkletGlobalScope, LooseFaustDspFactory, FaustDspMeta, FaustUIItem, InterfaceFFT, TWindowFunction, Writeable, TypedArray, FFTUtils } from "./types";

export interface FaustFFTOptionsData {
    fftSize: number;
    fftOverlap: number;
    noIFFT: boolean;
    /** Index number of the default window function, leave undefined or -1 for rectangular (no windowing) */
    defaultWindowFunction: number;
}

/**
 * Injected in the string to be compiled on AudioWorkletProcessor side
 */
export interface FaustFFTData {
    processorName: string;
    dspName: string;
    dspMeta: FaustDspMeta;
    fftOptions?: Partial<FaustFFTOptionsData>;
};
export interface FaustFFTAudioWorkletProcessorDependencies {
    FaustBaseWebAudioDsp: typeof FaustBaseWebAudioDsp;
    FaustMonoWebAudioDsp: typeof FaustMonoWebAudioDsp;
    FaustWasmInstantiator: typeof FaustWasmInstantiator;
    FFTUtils: typeof FFTUtils;
}
export interface FaustFFTAudioWorkletNodeOptions extends AudioWorkletNodeOptions {
    processorOptions: FaustFFTAudioWorkletProcessorOptions;
}
export interface FaustFFTAudioWorkletProcessorOptions {
    name: string;
    sampleSize: number;
    factory: LooseFaustDspFactory;
}


// Dynamic AudioWorkletProcessor code generator
const getFaustFFTAudioWorkletProcessor = (dependencies: FaustFFTAudioWorkletProcessorDependencies, faustData: FaustFFTData, register = true): typeof AudioWorkletProcessor => {
    const { registerProcessor, AudioWorkletProcessor, sampleRate } = globalThis as unknown as AudioWorkletGlobalScope;

    const {
        FaustBaseWebAudioDsp,
        FaustWasmInstantiator,
        FaustMonoWebAudioDsp,
        FFTUtils
    } = dependencies;
    
    const {
        processorName,
        dspName,
        dspMeta,
        fftOptions
    } = faustData;

    const {
        windowFunctions,
        getFFT,
        fftToSignal,
        signalToFFT,
        signalToNoFFT
    } = FFTUtils;

    /**
     * Ceil a number to multiple of another
     */
    const ceil = (x: number, to: number): number => (Math.abs(to) < 1 ? Math.ceil(x * (1 / to)) / (1 / to) : Math.ceil(x / to) * to);

    /**
     * Mod support wrapping with negative numbers
     */
    const mod = (x: number, y: number): number => (x % y + y) % y;

    const apply = (array: Writeable<ArrayLike<number>>, windowFunction: TWindowFunction) => {
        for (let i = 0; i < array.length; i++) {
            array[i] *= windowFunction(i, array.length);
        }
    };

    const fftParamKeywords = ["/fftSize", "/fftHopSize", "/fftOverlap", "/windowFunction", "/noIFFT"];

    /**
     * Copy buffer to another, support negative offset index
     */
    const setTypedArray = <T extends TypedArray = TypedArray>(to: T, from: T, offsetTo = 0, offsetFrom = 0) => {
        const toLength = to.length;
        const fromLength = from.length;
        const spillLength = Math.min(toLength, fromLength);
        let spilled = 0;
        let $to = mod(offsetTo, toLength) || 0;
        let $from = mod(offsetFrom, fromLength) || 0;
        while (spilled < spillLength) {
            const $spillLength = Math.min(spillLength - spilled, toLength - $to, fromLength - $from);
            const $fromEnd = $from + $spillLength;
            if ($from === 0 && $fromEnd === fromLength) to.set(from, $to);
            else to.set(from.subarray($from, $fromEnd), $to);
            $to = ($to + $spillLength) % toLength;
            $from = $fromEnd % fromLength;
            spilled += $spillLength;
        }
        return $to;
    };

    // Analyse JSON to generate AudioParam parameters
    const analyseParameters = (item: FaustUIItem): AudioParamDescriptor | null => {
        const isFFTReserved = "address" in item && !!fftParamKeywords.find(k => item.address.endsWith(k));
        if (isFFTReserved) return null;
        if (item.type === "vslider" || item.type === "hslider" || item.type === "nentry") {
            return { name: item.address, defaultValue: item.init || 0, minValue: item.min || 0, maxValue: item.max || 0 };
        } else if (item.type === "button" || item.type === "checkbox") {
            return { name: item.address, defaultValue: item.init || 0, minValue: 0, maxValue: 1 };
        }
        return null;
    }
    /**
     * Class for Faust FFT AudioWorkletProcessor
     */
    class FaustFFTAudioWorkletProcessor extends AudioWorkletProcessor {

        protected fDSPCode: FaustMonoWebAudioDsp;

        protected paramValuesCache: Record<string, number> = {};

        private dspInstance!: FaustMonoDspInstance;
        private sampleSize!: number;

        private destroyed = false;
        /** Pointer of next start sample to write of the FFT input window */
        private $inputWrite = 0;
        /** Pointer of next start sample to read of the FFT input window */
        private $inputRead = 0;
        /** Pointer of next start sample to write of the FFT output window */
        private $outputWrite = 0;
        /** Pointer of next start sample to read of the FFT output window */
        private $outputRead = 0;
        /** Not perform in IFFT when reconstruct the audio signal */
        private noIFFT = false;
        /** audio data from input, array of channels */
        private readonly fftInput: Float32Array[] = [];
        /** audio data for output, array of channels */
        private readonly fftOutput: Float32Array[] = [];
        /** Generated from the current window function */
        private window: Float32Array;
        /** Generated from the current window's rolling sum square */
        private windowSumSquare: Float32Array;
        
        /** FFT constructor */
        private FFT: typeof InterfaceFFT;
        /** Real FFT interface */
        private rfft: InterfaceFFT;
        /** Faust param name of fftHopSize */
        private fftHopSizeParam: string | undefined;
        /** FFT Overlaps, 1 means no overlap */
        private fftOverlap = 0;
        private fftHopSize = 0;
        private fftSize = 0;
        private fftBufferSize = 0;
        private fftProcessorZeros: Float32Array;
        private noIFFTBuffer: Float32Array;

        private fPlotHandler: PlotHandler | null = null;
        private fCachedEvents: { type: string; data: any }[] = [];
        private fBufferNum = 0;
        private soundfiles: LooseFaustDspFactory["soundfiles"] = {};
        get fftProcessorBufferSize() {
            return this.fftSize / 2 + 1;
        }
        private windowFunction: TWindowFunction | null = null;

        constructor(options: FaustFFTAudioWorkletNodeOptions) {
            super(options);

            // Setup port message handling
            this.port.onmessage = (e: MessageEvent) => this.handleMessageAux(e);
            
            const { parameterDescriptors } = (this.constructor as typeof AudioWorkletProcessor);
            parameterDescriptors.forEach((pd) => {
                this.paramValuesCache[pd.name] = pd.defaultValue || 0;
            })

            const { factory, sampleSize } = options.processorOptions;

            this.dspInstance = FaustWasmInstantiator.createSyncMonoDSPInstance(factory);
            this.sampleSize = sampleSize;
            this.soundfiles = factory.soundfiles;

            // Init the FFT constructor and the Faust FFT Processor
            this.initFFT();
        }

        async initFFT(): Promise<true> {
            // Use injected function to instantiate the FFT constructor
            this.FFT = await getFFT();
            // Init Faust FFT Processor
            await this.createFFTProcessor();
            return true;
        }

        static get parameterDescriptors() {
            const params = [] as AudioParamDescriptor[];
            // Analyse voice JSON to generate AudioParam parameters
            const callback = (item: FaustUIItem) => {
                const param = analyseParameters(item);
                if (param) params.push(param);
            }
            FaustBaseWebAudioDsp.parseUI(dspMeta.ui, callback);
            // Add to Faust parameters, FFT specified parameters
            return [
                ...params,
                {
                    defaultValue: fftOptions?.fftSize || 1024,
                    maxValue: 2 ** 32,
                    minValue: 2,
                    name: "fftSize"
                }, {
                    defaultValue: fftOptions?.fftOverlap || 2,
                    maxValue: 32,
                    minValue: 1,
                    name: "fftOverlap"
                }, {
                    defaultValue: typeof fftOptions?.defaultWindowFunction === "number" ? fftOptions.defaultWindowFunction + 1 : 0,
                    maxValue: windowFunctions?.length || 0,
                    minValue: 0,
                    name: "windowFunction"
                }, {
                    defaultValue: +!!fftOptions?.noIFFT || 0,
                    maxValue: 1,
                    minValue: 0,
                    name: "noIFFT"
                }
            ];
        }

        processFFT() {
            // Get the number of samples that need to proceed, from the input r/w pointers
            let samplesForFFT = mod(this.$inputWrite - this.$inputRead, this.fftBufferSize) || this.fftBufferSize;
            // Start process, until no more enough samples
            while (samplesForFFT >= this.fftSize) {
                let fftProcessorOutputs: Float32Array[] = [];
                // Faust processing, use a callback to avoid extra data copy
                this.fDSPCode.compute((inputs) => {
                    // for each audio input channel, three Faust FFT input buffers can be generated (real, imag, FFT bin index)
                    for (let i = 0; i < Math.min(this.fftInput.length, Math.ceil(inputs.length / 3)); i++) {
                        // FFT forward, use a callback to avoid extra data copy
                        const ffted = this.rfft.forward((fftBuffer) => {
                            setTypedArray(fftBuffer, this.fftInput[i], 0, this.$inputRead);
                            // Windowing the input
                            for (let j = 0; j < fftBuffer.length; j++) {
                                fftBuffer[j] *= this.window[j];
                            }
                            // data for FFT (fftBuffer) is prepared
                        });
                        // write FFTed spectral data to three Faust FFT input buffers (real, imag, FFT bin index)
                        fftToSignal(ffted, inputs[i * 3], inputs[i * 3 + 1], inputs[i * 3 + 2]);
                        // Faust inputs are prepared
                    }
                    // If the Faust DSP has more inputs, fill them (zeros or real/imag, fill FFT bin indexes)
                    for (let i = this.fftInput.length * 3; i < inputs.length; i++) {
                        if (i % 3 === 2) inputs[i].forEach((v, j) => inputs[i][j] = j);
                        else inputs[i].fill(0);
                    }
                }, (outputs) => {
                    // Get the Faust DSP outputs
                    fftProcessorOutputs = outputs as Float32Array[];
                });

                // Advance FFT input read pointers
                this.$inputRead += this.fftHopSize;
                this.$inputRead %= this.fftBufferSize;

                samplesForFFT -= this.fftHopSize;

                // Do inverse FFT on the processed data by Faust DSP, and write the reconstructed signal to the output buffer
                for (let i = 0; i < this.fftOutput.length; i++) {
                    let iffted: Float32Array;
                    // If noIFFT option in enabled, then no need to do inverse IFFT, use the injected function to convert
                    if (this.noIFFT) {
                        iffted = this.noIFFTBuffer;
                        signalToNoFFT(fftProcessorOutputs[i * 2] || this.fftProcessorZeros, fftProcessorOutputs[i * 2 + 1] || this.fftProcessorZeros, iffted);
                    } else {
                        // FFT inverse, use a callback to avoid extra data copy
                        iffted = this.rfft.inverse((ifftBuffer) => {
                            // Convert the Faust DSP output (real/imag plans) to an array for inverse FFT
                            signalToFFT(fftProcessorOutputs[i * 2] || this.fftProcessorZeros, fftProcessorOutputs[i * 2 + 1] || this.fftProcessorZeros, ifftBuffer);
                            // ifftBuffer is prepared
                        });
                    }
                    // Windowing the output
                    for (let j = 0; j < iffted.length; j++) {
                        iffted[j] *= this.window[j];
                    }
                    // Overlap-add, preparing the windowSumSquare array for reverse the windowing effect when output the audio
                    let $: number;
                    // First part, add the part that is overlaped with the previous window
                    for (let j = 0; j < iffted.length - this.fftHopSize; j++) {
                        $ = mod(this.$outputWrite + j, this.fftBufferSize);
                        this.fftOutput[i][$] += iffted[j];
                        if (i === 0) this.windowSumSquare[$] += this.noIFFT ? this.window[j] : this.window[j] ** 2;
                    }
                    // Second part, write directly to the output buffer
                    for (let j = iffted.length - this.fftHopSize; j < iffted.length; j++) {
                        $ = mod(this.$outputWrite + j, this.fftBufferSize);
                        this.fftOutput[i][$] = iffted[j];
                        if (i === 0) this.windowSumSquare[$] = this.noIFFT ? this.window[j] : this.window[j] ** 2;
                    }
                }
                // Advance FFT output write pointers
                this.$outputWrite += this.fftHopSize;
                this.$outputWrite %= this.fftBufferSize;
            }
        }

        process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: { [key: string]: Float32Array }) {

            if (this.destroyed) return false;
            if (!this.FFT) return true;
            const input = inputs[0];
            const output = outputs[0];
            const inputChannels = input?.length || 0;
            const outputChannels = output?.length || 0;
            // if (input.length === 0) return true;
    
            const bufferSize = input?.length ? Math.max(...input.map(c => c.length)) || 128 : 128;
    
            // Reset FFT and related buffers if necessary (checks in the resetFFT method)
            this.noIFFT = !!parameters.noIFFT[0];
            this.resetFFT(~~parameters.fftSize[0], ~~parameters.fftOverlap[0], ~~parameters.windowFunction[0], inputChannels, outputChannels, bufferSize);
    
            if (!this.fDSPCode) return true;
    
            for (const path in parameters) {
                if (!!fftParamKeywords.find(k => `/${path}`.endsWith(k))) continue;
                const [paramValue] = parameters[path];
                if (paramValue !== this.paramValuesCache[path]) {
                    this.fDSPCode.setParamValue(path, paramValue);
                    this.paramValuesCache[path] = paramValue;
                }
            }

            // Write audio input into fftInput buffer, advance pointers
            if (input?.length) {
                let $inputWrite = 0;
                for (let i = 0; i < input.length; i++) {
                    const inputWindow = this.fftInput[i];
                    const channel = input[i].length ? input[i] : new Float32Array(bufferSize);
                    $inputWrite = setTypedArray(inputWindow, channel, this.$inputWrite);
                }
                this.$inputWrite = $inputWrite;
            } else {
                this.$inputWrite += bufferSize;
                this.$inputWrite %= this.fftBufferSize;
            }
    
            // Do FFT if necessary
            this.processFFT();
    
            // Read from fftOutput buffer for audio output, applying windowSumSquare to reverse the doubled windowing effect
            for (let i = 0; i < output.length; i++) {
                setTypedArray(output[i], this.fftOutput[i], 0, this.$outputRead);
                // let a = 0;
                let div = 0;
                for (let j = 0; j < bufferSize; j++) {
                    div = this.windowSumSquare[mod(this.$outputRead + j, this.fftBufferSize)];
                    output[i][j] /= div < 1e-8 ? 1 : div;
                }
            }
            // Advance pointers
            this.$outputRead += bufferSize;
            this.$outputRead %= this.fftBufferSize;

            // plot
            if (this.fPlotHandler) {
                this.port.postMessage({ type: "plot", value: output, index: this.fBufferNum++, events: this.fCachedEvents });
                this.fCachedEvents = [];
            }
            return true;
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
                        this.fPlotHandler = (output, index, events) => {
                            if (events) this.fCachedEvents.push(...events);
                        };
                    } else {
                        this.fPlotHandler = null;
                    }
                    this.fDSPCode?.setPlotHandler(this.fPlotHandler);
                    break;
                }
                case "start": {
                    this.fDSPCode?.start();
                    break;
                }
                case "stop": {
                    this.fDSPCode?.stop();
                    break;
                }
                case "destroy": {
                    this.port.close();
                    this.destroy();
                    break;
                }
                default:
                    break;
            }
        }

        protected setParamValue(path: string, value: number) {
            this.fDSPCode?.setParamValue(path, value);
            this.paramValuesCache[path] = value;
        }

        protected midiMessage(data: number[] | Uint8Array) {
            this.fDSPCode?.midiMessage(data);
        }

        protected ctrlChange(channel: number, ctrl: number, value: number) {
            this.fDSPCode?.ctrlChange(channel, ctrl, value);
        }

        protected pitchWheel(channel: number, wheel: number) {
            this.fDSPCode?.pitchWheel(channel, wheel);
        }

        resetFFT(sizeIn: number, overlapIn: number, windowFunctionIn: number, inputChannels: number, outputChannels: number, bufferSize: number) {
            const fftSize = ~~ceil(Math.max(2, sizeIn || 1024), 2);
            const fftOverlap = ~~Math.min(fftSize, Math.max(1, overlapIn));
            const fftHopSize = ~~Math.max(1, fftSize / fftOverlap);
            const latency = fftSize - Math.min(fftHopSize, bufferSize);
            let windowFunction: TWindowFunction | null = null;
            
            // set the window function from the injected list
            if (windowFunctionIn !== 0) {
                windowFunction = typeof windowFunctions === "object" ? windowFunctions[~~windowFunctionIn - 1] || null : null;
            }
            const fftSizeChanged = fftSize !== this.fftSize;

            const fftOverlapChanged = fftOverlap !== this.fftOverlap;
            // Reset FFT vars if the size is changed
            if (fftSizeChanged || fftOverlapChanged) {
                this.fftSize = fftSize;
                this.fftOverlap = fftOverlap;
                this.fftHopSize = fftHopSize;
                this.$inputWrite = 0;
                this.$inputRead = 0;
                this.$outputWrite = 0;
                this.$outputRead = -latency;
                this.fftBufferSize = Math.max(fftSize * 2 - this.fftHopSize, bufferSize * 2);
                if (!fftSizeChanged && this.fftHopSizeParam) this.fDSPCode?.setParamValue(this.fftHopSizeParam, this.fftHopSize);
            }

            // Reset the FFT interface and the Faust Processor
            if (fftSizeChanged) {
                this.rfft?.dispose();
                this.rfft = new this.FFT(fftSize);
                this.noIFFTBuffer = new Float32Array(this.fftSize);
                this.createFFTProcessor();
            }
            
            // Calculate a window from the window function, prepare the windowSumSquare buffer 
            if (fftSizeChanged || fftOverlapChanged || windowFunction !== this.windowFunction) {
                this.windowFunction = windowFunction;
                this.window = new Float32Array(fftSize);
                this.window.fill(1);
                if (windowFunction) apply(this.window, windowFunction);
                this.windowSumSquare = new Float32Array(this.fftBufferSize);
            }

            // Reset FFT I/O buffers if necessary
            if (this.fftInput.length > inputChannels) {
                this.fftInput.splice(inputChannels);
            }
            if (this.fftOutput.length > outputChannels) {
                this.fftOutput.splice(outputChannels);
            }
            if (fftSizeChanged || fftOverlapChanged) {
                for (let i = 0; i < inputChannels; i++) {
                    this.fftInput[i] = new Float32Array(this.fftBufferSize);
                }
                for (let i = 0; i < outputChannels; i++) {
                    this.fftOutput[i] = new Float32Array(this.fftBufferSize);
                }
            } else {
                if (this.fftInput.length < inputChannels) {
                    for (let i = this.fftInput.length; i < inputChannels; i++) {
                        this.fftInput[i] = new Float32Array(this.fftBufferSize);
                    }
                }
                if (this.fftOutput.length < outputChannels) {
                    for (let i = this.fftOutput.length; i < outputChannels; i++) {
                        this.fftOutput[i] = new Float32Array(this.fftBufferSize);
                    }
                }
            }
        }
        async createFFTProcessor() {
            this.fDSPCode?.stop();
            this.fDSPCode?.destroy();

            // Create Monophonic DSP
            this.fDSPCode = new FaustMonoWebAudioDsp(this.dspInstance, sampleRate, this.sampleSize, this.fftProcessorBufferSize, this.soundfiles);

            // Setup output handler
            this.fDSPCode.setOutputParamHandler((path, value) => this.port.postMessage({ path, value, type: "param" }));
            this.fDSPCode.setPlotHandler(this.fPlotHandler);
            const params = this.fDSPCode.getParams();
            this.fDSPCode.start();
            // Write the cached parameters
            for (const path in this.paramValuesCache) {
                if (!!fftParamKeywords.find(k => `/${path}`.endsWith(k))) continue;
                this.fDSPCode.setParamValue(path, this.paramValuesCache[path])
            }
            // Write the FFT reverved parameters
            const fftSizeParam = params.find(s => s.endsWith("/fftSize"));
            if (fftSizeParam) this.fDSPCode.setParamValue(fftSizeParam, this.fftSize);
            this.fftHopSizeParam = params.find(s => s.endsWith("/fftHopSize"));
            if (this.fftHopSizeParam) this.fDSPCode.setParamValue(this.fftHopSizeParam, this.fftHopSize);
            // Prepare a array of zeros for furthur usage
            this.fftProcessorZeros = new Float32Array(this.fftProcessorBufferSize);
        }
        destroy() {
            this.fDSPCode?.stop();
            this.fDSPCode?.destroy();
            this.rfft?.dispose();
            this.destroyed = true;
        }

    }

    const Processor = FaustFFTAudioWorkletProcessor;
    if (register) {
        try {
            registerProcessor(processorName || dspName || "myfftdsp", Processor);
        } catch (error) {
            console.warn(error);
        }
    }

    return FaustFFTAudioWorkletProcessor;

};

export default getFaustFFTAudioWorkletProcessor;
