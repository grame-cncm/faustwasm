import type { FaustDspMeta } from "./types";

export const midiToFreq = (note: number) => 440.0 * 2 ** ((note - 69) / 12);
export const remap = (v: number, mn0: number, mx0: number, mn1: number, mx1: number) => (v - mn0) / (mx0 - mn0) * (mx1 - mn1) + mn1;
export const findPath = (o: any, p: string) => {
    if (typeof o !== "object") return false;
    if (o.address) {
        return (o.address === p);
    }
    for (const k in o) {
        if (findPath(o[k], p)) return true;
    }
    return false;
};

export const createWasmImport = (voices: number, memory: WebAssembly.Memory) => ({
    env: {
        memory: voices ? memory : undefined, memoryBase: 0, tableBase: 0,
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
});
export const createWasmMemory = (voicesIn: number, dspMeta: FaustDspMeta, effectMeta: FaustDspMeta, bufferSize: number) => {
    // Hack : at least 4 voices (to avoid weird wasm memory bug?)
    const voices = Math.max(4, voicesIn);
    // Memory allocator
    const ptrSize = 4;
    const sampleSize = 4;
    const pow2limit = (x: number) => {
        let n = 65536; // Minimum = 64 kB
        while (n < x) { n *= 2; }
        return n;
    };
    const effectSize = effectMeta ? effectMeta.size : 0;
    let memorySize = pow2limit(
        effectSize
        + dspMeta.size * voices
        + (dspMeta.inputs + dspMeta.outputs * 2)
        * (ptrSize + bufferSize * sampleSize)
    ) / 65536;
    memorySize = Math.max(2, memorySize); // As least 2
    return new WebAssembly.Memory({ initial: memorySize, maximum: memorySize });
};
