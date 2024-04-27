/**
 * The Faust wasm instance interface.
 */
export interface IFaustDspInstance {
    /**
     * The dsp computation, to be called with successive input/output audio buffers.
     *
     * @param $dsp - the DSP pointer
     * @param count - the audio buffer size in frames
     * @param $inputs - the input audio buffer as in index in wasm memory
     * @param $output - the output audio buffer as in index in wasm memory
     */
    compute($dsp: number, count: number, $inputs: number, $output: number): void;

    /**
     * Give the number of inputs of a Faust wasm instance.
     * 
     * @param $dsp - the DSP pointer
     */
    getNumInputs($dsp: number): number;

    /**
     * Give the number of outputs of a Faust wasm instance.
     * 
     * @param $dsp - the DSP pointer
     */
    getNumOutputs($dsp: number): number;

    /**
     * Give a parameter current value.
     * 
     * @param $dsp - the DSP pointer
     * @param index - the parameter index
     * @return the parameter value
     */
    getParamValue($dsp: number, index: number): number;

    /**
     * Give the Faust wasm instance sample rate.
     * 
     * @param $dsp - the DSP pointer
     * @return the sample rate
     */
    getSampleRate($dsp: number): number;

    /**
     * Global init, calls the following methods:
     * - static class 'classInit': static tables initialization
     * - 'instanceInit': constants and instance state initialization
     *
     * @param $dsp - the DSP pointer
     * @param sampleRate - the sampling rate in Hertz
     */
    init($dsp: number, sampleRate: number): void;

    /** Init instance state (delay lines...).
     * 
     * @param $dsp - the DSP pointer
     */
    instanceClear($dsp: number): void;

    /** Init instance constant state.
     * 
     * @param $dsp - the DSP pointer
     * @param sampleRate - the sampling rate in Hertz
     */
    instanceConstants($dsp: number, sampleRate: number): void;

    /** Init instance state.
     * 
     * @param $dsp - the DSP pointer
     * @param sampleRate - the sampling rate in Hertz
     */
    instanceInit($dsp: number, sampleRate: number): void;

    /** Init default control parameters values.
     * 
     * @param $dsp - the DSP pointer
     */
    instanceResetUserInterface($dsp: number): void;

    /**
     * Set a parameter current value.
     * 
     * @param $dsp - the DSP pointer
     * @param index - the parameter index
     * @param value - the parameter value
     */
    setParamValue($dsp: number, index: number, value: number): void;
}

/**
 * Mixer used in polyphonic mode.
 */
export interface IFaustMixerInstance {
    clearOutput(bufferSize: number, chans: number, $outputs: number): void;
    mixCheckVoice(bufferSize: number, chans: number, $inputs: number, $outputs: number): number;
    fadeOut(bufferSize: number, chans: number, $outputs: number): void;
}

/**
 * Monophonic instance.
 */
export interface FaustMonoDspInstance {
    memory: WebAssembly.Memory;
    api: IFaustDspInstance;
    json: string;
}

/**
 * Polyphonic instance.
 */
export interface FaustPolyDspInstance {
    memory: WebAssembly.Memory;
    voices: number;
    voiceAPI: IFaustDspInstance;
    effectAPI?: IFaustDspInstance;
    mixerAPI: IFaustMixerInstance;
    voiceJSON: string;
    effectJSON?: string;
}

export class FaustDspInstance implements IFaustDspInstance {
    private readonly fExports: IFaustDspInstance;

    constructor(exports: IFaustDspInstance) { this.fExports = exports; }

    compute($dsp: number, count: number, $input: number, $output: number) { this.fExports.compute($dsp, count, $input, $output); }
    getNumInputs($dsp: number) { return this.fExports.getNumInputs($dsp); }
    getNumOutputs($dsp: number) { return this.fExports.getNumOutputs($dsp); }
    getParamValue($dsp: number, index: number) { return this.fExports.getParamValue($dsp, index); }
    getSampleRate($dsp: number) { return this.fExports.getSampleRate($dsp); }
    init($dsp: number, sampleRate: number) { this.fExports.init($dsp, sampleRate); }
    instanceClear($dsp: number) { this.fExports.instanceClear($dsp); }
    instanceConstants($dsp: number, sampleRate: number) { this.fExports.instanceConstants($dsp, sampleRate); }
    instanceInit($dsp: number, sampleRate: number) { this.fExports.instanceInit($dsp, sampleRate); }
    instanceResetUserInterface($dsp: number) { this.fExports.instanceResetUserInterface($dsp); }
    setParamValue($dsp: number, index: number, value: number) { this.fExports.setParamValue($dsp, index, value); }
}
