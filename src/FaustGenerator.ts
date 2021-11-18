import FaustDspInstance, { FaustMonoDspInstance, FaustPolyDspInstance, IFaustDspInstance, IFaustMixerInstance } from "./FaustDspInstance";
import { FaustDspFactory, FaustDspMeta } from "./types";

class FaustGenerator {
    private static createWasmImport(memory?: WebAssembly.Memory) {
        return {
            env: {
                memory: memory || new WebAssembly.Memory({ initial: 100 }),
                memoryBase: 0,
                tableBase: 0,
                // Integer version
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
    private static createWasmMemory(voicesIn: number, sampleSize: number, dspMeta: FaustDspMeta, effectMeta: FaustDspMeta, bufferSize: number) {
        // Hack : at least 4 voices (to avoid weird wasm memory bug?)
        const voices = Math.max(4, voicesIn);
        // Memory allocator
        const ptrSize = sampleSize; // Done on wast/wasm backend side
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
        memorySize = Math.max(2, memorySize); // At least 2
        return new WebAssembly.Memory({ initial: memorySize, maximum: memorySize });
    };
    private static createMonoDSPInstanceAux(instance: WebAssembly.Instance, factory: FaustDspFactory) {
        const functions = instance.exports as IFaustDspInstance & WebAssembly.Exports;
        const api = new FaustDspInstance(functions);
        const memory: any = instance.exports.memory;
        return { memory: memory, api: api, json: factory.json } as FaustMonoDspInstance;
    }
    private static createMemoryAux(voices: number, voiceFactory: FaustDspFactory, effectFactory?: FaustDspFactory) {
        // Parse JSON to get 'size' and 'inputs/outputs' infos
        const voiceMeta: FaustDspMeta = JSON.parse(voiceFactory.json);
        const effectMeta: FaustDspMeta = (effectFactory && effectFactory.json) ? JSON.parse(effectFactory.json) : null;
        const sampleSize = voiceMeta.compile_options.match("-double") ? 8 : 4;
        // Memory will be shared by voice, mixer and (possibly) effect instances
        return this.createWasmMemory(voices, sampleSize, voiceMeta, effectMeta, 8192);
    }
    private static createMixerAux(mixerModule: WebAssembly.Module, memory: WebAssembly.Memory) {
        // Create mixer instance
        const mixerImport = {
            imports: { print: console.log },
            memory: { memory }
        };
        const mixerInstance = new WebAssembly.Instance(mixerModule, mixerImport);
        const mixerFunctions = mixerInstance.exports as IFaustMixerInstance & WebAssembly.Exports;
        return mixerFunctions;
    }
    // Public API
    static async loadDSPFactory(wasmPath: string, jsonPath: string) {
        const wasmFile = await fetch(wasmPath);
        if (!wasmFile.ok) {
            console.error(`=> exception raised while running loadDSPFactory, file not found: ${wasmPath}`);
            return null;
        }
        try {
            const wasmBuffer = await wasmFile.arrayBuffer();
            const module = await WebAssembly.compile(wasmBuffer);
            const jsonFile = await fetch(jsonPath);
            const json = await jsonFile.text();
            const meta: FaustDspMeta = JSON.parse(json);
            const cOptions = meta.compile_options;
            const poly = cOptions.indexOf('wasm-e') !== -1;
            return { cfactory: 0, code: new Uint8Array(wasmBuffer), module, json, poly } as FaustDspFactory;
        } catch (e) {
            console.error(`=> exception raised while running loadDSPFactory: ${e}`);
            return null;
        }
    }
    
    static async loadDSPMixer(mixerPath: string, fs?: typeof FS) {
        try {
            let mixerBuffer = null;
            if (fs) {
                mixerBuffer = fs.readFile(mixerPath, { encoding: "binary" });
            } else {
                const mixerFile = await fetch(mixerPath);
                mixerBuffer = await mixerFile.arrayBuffer();
            }
            // Compile mixer
            return WebAssembly.compile(mixerBuffer);
        } catch (e) {
            console.error(`=> exception raised while running loadMixer: ${e}`);
            return null;
        }
    }
    
    static async createAsyncMonoDSPInstance(factory: FaustDspFactory) {
        const instance = await WebAssembly.instantiate(factory.module, this.createWasmImport());
        return this.createMonoDSPInstanceAux(instance, factory);
    }
    
    static createSyncMonoDSPInstance(factory: FaustDspFactory) {
        const instance = new WebAssembly.Instance(factory.module, this.createWasmImport());
        return this.createMonoDSPInstanceAux(instance, factory);
    }
    
    static async createAsyncPolyDSPInstance(voiceFactory: FaustDspFactory, mixerModule: WebAssembly.Module, voices: number, effectFactory?: FaustDspFactory): Promise<FaustPolyDspInstance> {
        const memory = this.createMemoryAux(voices, voiceFactory, effectFactory);
        // Create voice 
        const voiceInstance = await WebAssembly.instantiate(voiceFactory.module, this.createWasmImport(memory));
        const voiceFunctions = voiceInstance.exports as IFaustDspInstance & WebAssembly.Exports;
        const voiceAPI = new FaustDspInstance(voiceFunctions);
        // Create mixer
        const mixerAPI = this.createMixerAux(mixerModule, memory);
    
        // Possibly create effect instance 
        if (effectFactory) {
            const effectInstance = await WebAssembly.instantiate(effectFactory.module, this.createWasmImport(memory));
            const effectFunctions = effectInstance.exports as IFaustDspInstance & WebAssembly.Exports;
            const effectAPI = new FaustDspInstance(effectFunctions);
            return {
                memory,
                voices,
                voiceAPI,
                effectAPI,
                mixerAPI,
                voiceJSON: voiceFactory.json,
                effectJSON: effectFactory.json
            };
        } else {
            return {
                memory,
                voices,
                voiceAPI,
                mixerAPI,
                voiceJSON: voiceFactory.json
            };
        }
    }
    
    static createSyncPolyDSPInstance(voiceFactory: FaustDspFactory, mixerModule: WebAssembly.Module, voices: number, effectFactory?: FaustDspFactory): FaustPolyDspInstance {
        const memory = this.createMemoryAux(voices, voiceFactory, effectFactory);
        // Create voice 
        const voiceInstance = new WebAssembly.Instance(voiceFactory.module, this.createWasmImport(memory));
        const voiceFunctions = voiceInstance.exports as IFaustDspInstance & WebAssembly.Exports;
        const voiceAPI = new FaustDspInstance(voiceFunctions);
        // Create mixer
        const mixerAPI = this.createMixerAux(mixerModule, memory);
    
        // Possibly create effect instance 
        if (effectFactory) {
            const effectInstance = new WebAssembly.Instance(effectFactory.module, this.createWasmImport(memory));
            const effectFunctions = effectInstance.exports as IFaustDspInstance & WebAssembly.Exports;
            const effectAPI = new FaustDspInstance(effectFunctions);
            return {
                memory: memory,
                voices: voices,
                voiceAPI: voiceAPI,
                effectAPI: effectAPI,
                mixerAPI: mixerAPI,
                voiceJSON: voiceFactory.json,
                effectJSON: effectFactory.json
            };
        } else {
            return {
                memory: memory,
                voices: voices,
                voiceAPI: voiceAPI,
                mixerAPI: mixerAPI,
                voiceJSON: voiceFactory.json
            };
        }
    }
}

export default FaustGenerator;
