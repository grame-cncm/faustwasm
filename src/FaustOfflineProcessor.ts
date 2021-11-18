import { IFaustMonoWebAudioDsp } from "./FaustWebAudioDsp";

/**
 *  For offline rendering.
 */
export interface IFaustOfflineProcessor {
    /**
     * Render frames in an array.
     *
     * @param inputs - input signal
     * @param length - the number of frames to render (default: bufferSize)
     * @param onUpdate - a callback after each buffer calculated, with an argument "current sample"
     * @return an array of Float32Array with the rendered frames
     */
    render(inputs?: Float32Array[], length?: number, onUpdate?: (sample: number) => any): Float32Array[];
}

class FaustOfflineProcessor implements IFaustOfflineProcessor {

    private fDSPCode: IFaustMonoWebAudioDsp;
    private fBufferSize: number;
    private fInputs: Float32Array[];
    private fOutputs: Float32Array[];

    constructor(instance: IFaustMonoWebAudioDsp, bufferSize: number) {
        this.fDSPCode = instance;
        this.fBufferSize = bufferSize;
        this.fInputs = new Array(this.fDSPCode.getNumInputs()).fill(null).map(() => new Float32Array(bufferSize));
        this.fOutputs = new Array(this.fDSPCode.getNumOutputs()).fill(null).map(() => new Float32Array(bufferSize));
    }

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

export default FaustOfflineProcessor;
