import type { FaustMonoDspInstance } from "./FaustDspInstance";
import type FaustWasmInstantiator from "./FaustWasmInstantiator";
import type { FaustBaseWebAudioDsp, FaustMonoWebAudioDsp } from "./FaustWebAudioDsp";
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
        FFTUtils
    } = dependencies;
    
    const {
        processorName,
        dspName,
        dspMeta,
        fftOptions
    } = faustData;
    const windowFunctions = FFTUtils.windowFunctions;
    const getFFT = FFTUtils.getFFT;
    const fftToSignal = FFTUtils.fftToSignal;
    const signalToFFT = FFTUtils.signalToFFT;
    const signalToNoFFT = FFTUtils.signalToNoFFT;

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

        private dspInstance: FaustMonoDspInstance;
        private sampleSize: number;

        private destroyed = false;
        /** Pointer of next start sample to write of the input window */
        private $inputWrite = 0;
        /** Pointer of next start sample to read of the input window */
        private $inputRead = 0;
        /** Pointer of next start sample to write of the output window */
        private $outputWrite = 0;
        /** Pointer of next start sample to read of the output window */
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
        
        private FFT: typeof InterfaceFFT;
        private rfft: InterfaceFFT;
        private fftHopSizeParam: string | undefined;
        private fftOverlap = 0;
        private fftHopSize = 0;
        private fftSize = 0;
        private fftBufferSize = 0;
        get fftBins() {
            return this.fftSize / 2;
        }
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
            const { FaustMonoWebAudioDsp } = dependencies as FaustFFTAudioWorkletProcessorDependencies;
            const { factory, sampleSize } = options.processorOptions;

            this.dspInstance = FaustWasmInstantiator.createSyncMonoDSPInstance(factory);
            this.sampleSize = sampleSize;

            this.initFFT();
        }

        async initFFT(): Promise<true> {
            this.FFT = await getFFT();
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
            let samplesForFFT = mod(this.$inputWrite - this.$inputRead, this.fftBufferSize) || this.fftBufferSize;
            while (samplesForFFT >= this.fftSize) {
                const fftProcessorInputs = [];
                const fftProcessorOutputs = new Array(this.fDSPCode.getNumOutputs()).fill(null).map(() => new Float32Array(this.fftProcessorBufferSize));
                for (let i = 0; i < this.fftInput.length; i++) {
                    const fftBuffer = new Float32Array(this.fftSize);
                    setTypedArray(fftBuffer, this.fftInput[i], 0, this.$inputRead);
                    for (let j = 0; j < fftBuffer.length; j++) {
                        fftBuffer[j] *= this.window[j];
                    }
                    const ffted = this.rfft.forward(fftBuffer);
                    fftProcessorInputs.push(...fftToSignal(ffted));
                }
                for (let i = 0; i < this.fDSPCode.getNumInputs(); i++) {
                    if (!fftProcessorInputs[i]) {
                        fftProcessorInputs[i] = new Float32Array(this.fftProcessorBufferSize);
                        if (i % 3 === 2) fftProcessorInputs[i] = fftProcessorInputs[i].map((v, j) => j + 1);
                    }
                }
                this.$inputRead += this.fftHopSize;
                this.$inputRead %= this.fftBufferSize;
                samplesForFFT -= this.fftHopSize;
                this.fDSPCode.compute(fftProcessorInputs.slice(0, this.fDSPCode.getNumInputs()), fftProcessorOutputs);
                for (let i = 0; i < this.fftOutput.length; i++) {
                    let iffted: Float32Array;
                    if (this.noIFFT) {
                        iffted = signalToNoFFT(fftProcessorOutputs[i * 2] || new Float32Array(this.fftProcessorBufferSize), fftProcessorOutputs[i * 2 + 1] || new Float32Array(this.fftProcessorBufferSize));
                    } else {
                        const ifftBuffer = signalToFFT(fftProcessorOutputs[i * 2] || new Float32Array(this.fftProcessorBufferSize), fftProcessorOutputs[i * 2 + 1] || new Float32Array(this.fftProcessorBufferSize));
                        iffted = this.rfft.inverse(ifftBuffer);
                    }
                    for (let j = 0; j < iffted.length; j++) {
                        iffted[j] *= this.window[j];
                    }
                    let $: number;
                    for (let j = 0; j < iffted.length - this.fftHopSize; j++) {
                        $ = mod(this.$outputWrite + j, this.fftBufferSize);
                        this.fftOutput[i][$] += iffted[j];
                        if (i === 0) this.windowSumSquare[$] += this.noIFFT ? this.window[j] : this.window[j] ** 2;
                    }
                    for (let j = iffted.length - this.fftHopSize; j < iffted.length; j++) {
                        $ = mod(this.$outputWrite + j, this.fftBufferSize);
                        this.fftOutput[i][$] = iffted[j];
                        if (i === 0) this.windowSumSquare[$] = this.noIFFT ? this.window[j] : this.window[j] ** 2;
                    }
                }
                this.$outputWrite += this.fftHopSize;
                this.$outputWrite %= this.fftBufferSize;
            }
        }
        process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: { [key: string]: Float32Array }) {

            if (this.destroyed) return false;
            if (!this.FFT) return true;
            const input = inputs[0];
            const output = outputs[0];
            const inputChannels = input.length;
            const outputChannels = output.length;
            // if (input.length === 0) return true;
    
            const bufferSize = input.length ? Math.max(...input.map(c => c.length)) || 128 : 128;
    
            this.noIFFT = !!parameters.noIFFT[0];
            this.resetFFT(~~parameters.fftSize[0], ~~parameters.fftOverlap[0], ~~parameters.windowFunction[0], inputChannels, outputChannels, bufferSize);
    
            if (!this.fDSPCode) return true;
    
            for (const path in parameters) {
                if (!!fftParamKeywords.find(k => path.endsWith(k))) continue;
                const [paramValue] = parameters[path];
                if (paramValue !== this.paramValuesCache[path]) {
                    this.fDSPCode.setParamValue(path, paramValue);
                    this.paramValuesCache[path] = paramValue;
                }
            }

            if (input.length) {
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
    
            this.processFFT();
    
            for (let i = 0; i < output.length; i++) {
                setTypedArray(output[i], this.fftOutput[i], 0, this.$outputRead);
                // let a = 0;
                let div = 0;
                for (let j = 0; j < bufferSize; j++) {
                    div = this.windowSumSquare[mod(this.$outputRead + j, this.fftBufferSize)];
                    output[i][j] /= div < Number.EPSILON ? 1 : div;
                    // a = output[i][j];
                    // b = this.windowSumSquare[mod(this.$outputRead + j, this.fftBufferSize)];
                    // output[i][j] = Math.abs(a - b) < Number.EPSILON ? Math.sign(a * b) : b < Number.EPSILON ? Math.sign(a * b) : a / b;
                }
            }
            this.$outputRead += bufferSize;
            this.$outputRead %= this.fftBufferSize;
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
                        this.fDSPCode?.setPlotHandler((output, index, events) => this.port.postMessage({ type: "plot", value: output, index: index, events: events }));
                    } else {
                        this.fDSPCode?.setPlotHandler(null);
                    }
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
            if (windowFunctionIn !== 0) {
                windowFunction = typeof windowFunctions === "object" ? windowFunctions[~~windowFunctionIn - 1] || null : null;
            }
            const fftSizeChanged = fftSize !== this.fftSize;
            if (fftSizeChanged || fftOverlap !== this.fftOverlap) {
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
            if (fftSizeChanged) {
                this.rfft?.dispose();
                this.rfft = new this.FFT(fftSize);
                this.createFFTProcessor();
            }
            if (fftSizeChanged || windowFunction !== this.windowFunction) {
                this.windowFunction = windowFunction;
                this.window = new Float32Array(fftSize);
                this.window.fill(1);
                if (windowFunction) apply(this.window, windowFunction);
                this.windowSumSquare = new Float32Array(this.fftBufferSize);
            }
            if (this.fftInput.length > inputChannels) {
                this.fftInput.splice(inputChannels);
            }
            if (this.fftOutput.length > outputChannels) {
                this.fftOutput.splice(outputChannels);
            }
            if (fftSizeChanged) {
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

            const { FaustMonoWebAudioDsp } = dependencies as FaustFFTAudioWorkletProcessorDependencies;

            // Create Monophonic DSP
            this.fDSPCode = new FaustMonoWebAudioDsp(this.dspInstance, sampleRate, this.sampleSize, this.fftProcessorBufferSize);

            // Setup output handler
            this.fDSPCode.setOutputParamHandler((path, value) => this.port.postMessage({ path, value, type: "param" }));
            const params = this.fDSPCode.getParams();
            this.fDSPCode.start();
            const fftSizeParam = params.find(s => s.endsWith("/fftSize"));
            if (fftSizeParam) this.fDSPCode.setParamValue(fftSizeParam, this.fftSize);
            this.fftHopSizeParam = params.find(s => s.endsWith("/fftHopSize"));
            if (this.fftHopSizeParam) this.fDSPCode.setParamValue(this.fftHopSizeParam, this.fftHopSize);

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
