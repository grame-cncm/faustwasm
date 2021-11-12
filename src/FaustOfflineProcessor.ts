import FaustDsp from "./FaustDsp";
import { FaustDspMeta, FaustWebAssemblyExports } from "./types";

class FaustOfflineProcessor {
    private bufferSize: number;
    private sampleRate: number;
    private dspMeta: FaustDspMeta;
    private $ins: number;
    private $outs: number;
    private dspInChannnels: Float32Array[];
    private dspOutChannnels: Float32Array[];
    private numIn: number;
    private numOut: number;
    private ptrSize: number;
    private sampleSize: number;
    private $audioHeap: number;
    private $$audioHeapInputs: number;
    private $$audioHeapOutputs: number;
    private $audioHeapInputs: number;
    private $audioHeapOutputs: number;
    private $dsp: number;
    private factory: FaustWebAssemblyExports;
    private HEAP: ArrayBuffer;
    private HEAP32: Int32Array;
    private HEAPF32: Float32Array;
    private output: Float32Array[];

    static get importObject() {
        return {
            env: {
                memory: undefined as WebAssembly.Memory, memoryBase: 0, tableBase: 0,
                _abs: Math.abs,
                // Float version
                _acosf: Math.acos, _asinf: Math.asin, _atanf: Math.atan, _atan2f: Math.atan2,
                _ceilf: Math.ceil, _cosf: Math.cos, _expf: Math.exp, _floorf: Math.floor,
                _fmodf: (x: number, y: number) => x % y,
                _logf: Math.log, _log10f: Math.log10, _max_f: Math.max, _min_f: Math.min,
                _remainderf: (x: number, y: number) => x - Math.round(x / y) * y,
                _powf: Math.pow, _roundf: Math.fround, _sinf: Math.sin, _sqrtf: Math.sqrt, _tanf: Math.tan,
                _acoshf: Math.acosh, _asinhf: Math.asinh, _atanhf: Math.atanh,
                _coshf: Math.cosh, _sinhf: Math.sinh, _tanhf: Math.tanh,
                _isnanf: Number.isNaN, _isinff: (x: number) => !isFinite(x),
                _copysignf: (x: number, y: number) => (Math.sign(x) === Math.sign(y) ? x : -x),

                // Double version
                _acos: Math.acos, _asin: Math.asin, _atan: Math.atan, _atan2: Math.atan2,
                _ceil: Math.ceil, _cos: Math.cos, _exp: Math.exp, _floor: Math.floor,
                _fmod: (x: number, y: number) => x % y,
                _log: Math.log, _log10: Math.log10, _max_: Math.max, _min_: Math.min,
                _remainder: (x: number, y: number) => x - Math.round(x / y) * y,
                _pow: Math.pow, _round: Math.fround, _sin: Math.sin, _sqrt: Math.sqrt, _tan: Math.tan,
                _acosh: Math.acosh, _asinh: Math.asinh, _atanh: Math.atanh,
                _cosh: Math.cosh, _sinh: Math.sinh, _tanh: Math.tanh,
                _isnan: Number.isNaN, _isinf: (x: number) => !isFinite(x),
                _copysign: (x: number, y: number) => (Math.sign(x) === Math.sign(y) ? x : -x),

                table: new WebAssembly.Table({ initial: 0, element: "anyfunc" })
            }
        };
    }
    async init(options: { dsp?: FaustDsp; bufferSize?: number; sampleRate?: number }) {
        const { dsp } = options;
        if (!dsp) throw new Error("No Dsp input");
        if (this.factory) throw new Error("Processor already initiated.");

        this.dspMeta = dsp.mainMeta;

        this.$ins = null;
        this.$outs = null;

        this.dspInChannnels = [];
        this.dspOutChannnels = [];

        this.numIn = this.dspMeta.inputs;
        this.numOut = this.dspMeta.outputs;

        // Memory allocator
        this.ptrSize = 4;
        this.sampleSize = 4;

        // Create the WASM instance
        const dspInstance = await WebAssembly.instantiate(dsp.mainModule, FaustOfflineProcessor.importObject);
        this.factory = dspInstance.exports as FaustWebAssemblyExports;
        this.HEAP = this.factory.memory.buffer;
        this.HEAP32 = new Int32Array(this.HEAP);
        this.HEAPF32 = new Float32Array(this.HEAP);

        this.bufferSize = options?.bufferSize || 1024;
        this.output = new Array(this.numOut).fill(null).map(() => new Float32Array(this.bufferSize));

        this.sampleRate = options?.sampleRate || 48000;

        // DSP is placed first with index 0. Audio buffer start at the end of DSP.
        this.$audioHeap = this.dspMeta.size;

        // Setup pointers offset
        this.$$audioHeapInputs = this.$audioHeap;
        this.$$audioHeapOutputs = this.$$audioHeapInputs + this.numIn * this.ptrSize;

        // Setup buffer offset
        this.$audioHeapInputs = this.$$audioHeapOutputs + (this.numOut * this.ptrSize);
        this.$audioHeapOutputs = this.$audioHeapInputs + (this.numIn * this.bufferSize * this.sampleSize);
        // Start of DSP memory : Mono DSP is placed first with index 0
        this.$dsp = 0;

        if (this.numIn > 0) {
            this.$ins = this.$$audioHeapInputs;
            for (let i = 0; i < this.numIn; i++) {
                this.HEAP32[(this.$ins >> 2) + i] = this.$audioHeapInputs + this.bufferSize * this.sampleSize * i;
            }
            // Prepare Ins buffer tables
            const dspInChans = this.HEAP32.subarray(this.$ins >> 2, (this.$ins + this.numIn * this.ptrSize) >> 2);
            for (let i = 0; i < this.numIn; i++) {
                this.dspInChannnels[i] = this.HEAPF32.subarray(dspInChans[i] >> 2, (dspInChans[i] + this.bufferSize * this.sampleSize) >> 2);
            }
        }
        if (this.numOut > 0) {
            this.$outs = this.$$audioHeapOutputs;
            for (let i = 0; i < this.numOut; i++) {
                this.HEAP32[(this.$outs >> 2) + i] = this.$audioHeapOutputs + this.bufferSize * this.sampleSize * i;
            }
            // Prepare Out buffer tables
            const dspOutChans = this.HEAP32.subarray(this.$outs >> 2, (this.$outs + this.numOut * this.ptrSize) >> 2);
            for (let i = 0; i < this.numOut; i++) {
                this.dspOutChannnels[i] = this.HEAPF32.subarray(dspOutChans[i] >> 2, (dspOutChans[i] + this.bufferSize * this.sampleSize) >> 2);
            }
        }
        // Init DSP
        this.factory.init(this.$dsp, this.sampleRate);
    }
    compute(inputs: Float32Array[] = []) {
        if (!this.factory) return this.output;
        for (let i = 0; i < this.numIn; i++) {
            this.dspInChannnels[i].fill(0);
            if (inputs[i]) this.dspInChannnels[i].set(inputs[i]);
        }
        this.factory.compute(this.$dsp, this.bufferSize, this.$ins, this.$outs); // Compute
        // Copy outputs
        if (this.output !== undefined) {
            for (let i = 0; i < this.numOut; i++) {
                this.output[i].set(this.dspOutChannnels[i]);
            }
        }
        return this.output;
    }
    generate(inputs: Float32Array[] = [], length = this.bufferSize) {
        let l = 0;
        const outputs = new Array(this.numOut).fill(null).map(() => new Float32Array(length));
        while (l < length) {
            const sliceLength = Math.min(length - l, this.bufferSize);
            const inputsCompute: Float32Array[] = [];
            for (let i = 0; i < this.numIn; i++) {
                let input: Float32Array;
                if (inputs[i]) {
                    if (inputs[i].length > l + sliceLength) {
                        input = inputs[i].subarray(l, l + sliceLength);
                    } else {
                        input = inputs[i].subarray(l, inputs[i].length);
                    }
                }
                inputsCompute[i] = input;
            }
            const outputsComputed = this.compute(inputsCompute);
            for (let i = 0; i < this.numOut; i++) {
                const output = outputsComputed[i];
                if (sliceLength < this.bufferSize) {
                    outputs[i].set(output.subarray(0, sliceLength), l);
                } else {
                    outputs[i].set(output, l);
                }
            }
            l += this.bufferSize;
        }
        return outputs;
    }
}

export default FaustOfflineProcessor;
