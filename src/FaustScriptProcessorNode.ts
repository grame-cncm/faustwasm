import type { ComputeHandler, FaustMonoWebAudioDsp, FaustPolyWebAudioDsp, IFaustMonoWebAudioDsp, IFaustPolyWebAudioDsp, MetadataHandler, OutputParamHandler, PlotHandler } from "./FaustWebAudioDsp";

/**
 * Base class for Monophonic and Polyphonic ScriptProcessorNode
 */
export class FaustScriptProcessorNode<Poly extends boolean = false> extends (globalThis.ScriptProcessorNode || null) {
    protected fDSPCode!: Poly extends true ? FaustPolyWebAudioDsp : FaustMonoWebAudioDsp;

    // Needed for ScriptProcessorNode
    protected fInputs!: Float32Array[];
    protected fOutputs!: Float32Array[];

    init(instance: Poly extends true ? FaustPolyWebAudioDsp : FaustMonoWebAudioDsp) {
        this.fDSPCode = instance;

        this.fInputs = new Array(this.fDSPCode.getNumInputs());
        this.fOutputs = new Array(this.fDSPCode.getNumOutputs());

        // Setup accelerometer and gyroscope handlers
        if (this.hasAccInput) {
            if (window.DeviceMotionEvent) {
                window.addEventListener("devicemotion", ({ accelerationIncludingGravity }: DeviceMotionEvent) => {
                    if (!accelerationIncludingGravity) return;
                    const { x, y, z } = accelerationIncludingGravity;
                    this.propagateAcc({ x, y, z });
                }, true);
            } else {
                // Browser doesn't support DeviceMotionEvent
                console.log("Cannot set accelerometer handler");
            }
        }
        if (this.hasGyrInput) {
            if (window.DeviceMotionEvent) {
                window.addEventListener("deviceorientation", ({ alpha, beta, gamma }: DeviceOrientationEvent) => {
                    this.propagateGyr({ alpha, beta, gamma });
                }, true);
            } else {
                // Browser doesn't support DeviceMotionEvent
                console.log("Cannot set gyroscope handler");
            }
        }
    
        this.onaudioprocess = (e) => {

            // Read inputs
            for (let chan = 0; chan < this.fDSPCode.getNumInputs(); chan++) {
                this.fInputs[chan] = e.inputBuffer.getChannelData(chan);
            }

            // Read outputs
            for (let chan = 0; chan < this.fDSPCode.getNumOutputs(); chan++) {
                this.fOutputs[chan] = e.outputBuffer.getChannelData(chan);
            }

            return this.fDSPCode.compute(this.fInputs, this.fOutputs);
        }

        this.start();
    }
    // Public API
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

    get hasAccInput() { return this.fDSPCode.hasAccInput; }
    propagateAcc(accelerationIncludingGravity: NonNullable<DeviceMotionEvent["accelerationIncludingGravity"]>) {
        this.fDSPCode.propagateAcc(accelerationIncludingGravity);
    }

    get hasGyrInput() { return this.fDSPCode.hasGyrInput; }
    propagateGyr(event: Pick<DeviceOrientationEvent, "alpha" | "beta" | "gamma">) {
        this.fDSPCode.propagateGyr(event);
    }
}

export class FaustMonoScriptProcessorNode extends FaustScriptProcessorNode<false> implements IFaustMonoWebAudioDsp {
}

export class FaustPolyScriptProcessorNode extends FaustScriptProcessorNode<true> implements IFaustPolyWebAudioDsp {
    keyOn(channel: number, pitch: number, velocity: number) { this.fDSPCode.keyOn(channel, pitch, velocity); }
    keyOff(channel: number, pitch: number, velocity: number) { this.fDSPCode.keyOff(channel, pitch, velocity); }
    allNotesOff(hard: boolean) { this.fDSPCode.allNotesOff(hard); }
}
