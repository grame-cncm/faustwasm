import { FaustDspInstance, FaustMonoDspInstance, FaustPolyDspInstance, IFaustDspInstance, IFaustMixerInstance } from "./FaustDspInstance";
import type { FaustDspFactory, FaustDspMeta, LooseFaustDspFactory } from "./types";

class FaustWasmInstantiator {
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
                _powf: Math.pow, _roundf: Math.round, _sinf: Math.sin, _sqrtf: Math.sqrt, _tanf: Math.tan,
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
                _pow: Math.pow, _round: Math.round, _sin: Math.sin, _sqrt: Math.sqrt, _tan: Math.tan,
                _acosh: Math.acosh, _asinh: Math.asinh, _atanh: Math.atanh,
                _cosh: Math.cosh, _sinh: Math.sinh, _tanh: Math.tanh,
                _isnan: Number.isNaN, _isinf: (x: number) => !isFinite(x),
                _copysign: (x: number, y: number) => (Math.sign(x) === Math.sign(y) ? x : -x),

                table: new WebAssembly.Table({ initial: 0, element: "anyfunc" })
            }
        };
    }
    private static createWasmMemoryPoly(voicesIn: number, sampleSize: number, dspMeta: FaustDspMeta, effectMeta: FaustDspMeta, bufferSize: number) {
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
            + (dspMeta.inputs + dspMeta.outputs * 2)  // + 2 for effect
            * (ptrSize + bufferSize * sampleSize)
        ) / 65536;
        memorySize = Math.max(2, memorySize); // At least 2
        return new WebAssembly.Memory({ initial: memorySize });
    };

    private static createWasmMemoryMono(sampleSize: number, dspMeta: FaustDspMeta, bufferSize: number) {
        // Memory allocator
        const ptrSize = sampleSize; // Done on wast/wasm backend side
        const memorySize = (dspMeta.size + (dspMeta.inputs + dspMeta.outputs) * (ptrSize + bufferSize * sampleSize)) / 65536;
        return new WebAssembly.Memory({ initial: memorySize * 2 }); // Safer to have a bit more memory
    }

    private static createMonoDSPInstanceAux(instance: WebAssembly.Instance, json: string, mem: WebAssembly.Memory | null = null) {
        const functions = instance.exports as IFaustDspInstance & WebAssembly.Exports;
        const api = new FaustDspInstance(functions);
        const memory: any = (mem) ? mem : instance.exports.memory;
        return { memory, api, json } as FaustMonoDspInstance;
    }

    private static createMemoryMono(monoFactory: LooseFaustDspFactory) {
        // Parse JSON to get 'size' and 'inputs/outputs' infos
        const monoMeta: FaustDspMeta = JSON.parse(monoFactory.json);
        const sampleSize = monoMeta.compile_options.match("-double") ? 8 : 4;
        return this.createWasmMemoryMono(sampleSize, monoMeta, 8192);

    }
    private static createMemoryPoly(voices: number, voiceFactory: LooseFaustDspFactory, effectFactory?: LooseFaustDspFactory) {
        // Parse JSON to get 'size' and 'inputs/outputs' infos
        const voiceMeta: FaustDspMeta = JSON.parse(voiceFactory.json);
        const effectMeta: FaustDspMeta = (effectFactory && effectFactory.json) ? JSON.parse(effectFactory.json) : null;
        const sampleSize = voiceMeta.compile_options.match("-double") ? 8 : 4;
        // Memory will be shared by voice, mixer and (possibly) effect instances
        return this.createWasmMemoryPoly(voices, sampleSize, voiceMeta, effectMeta, 8192);
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
            throw new Error(`=> exception raised while running loadDSPFactory, file not found: ${wasmPath}`);
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
            // console.error(`=> exception raised while running loadDSPFactory: ${e}`);
            throw e;
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
            // console.error(`=> exception raised while running loadMixer: ${e}`);
            throw e;
        }
    }

    static async createAsyncMonoDSPInstance(factory: LooseFaustDspFactory) {
        const parsedJson = JSON.parse(factory.json);
        // If the JSON contains a soundfile UI element, we need to create a memory object
        if (Array.isArray(parsedJson.ui) && parsedJson.ui.some((group: { items: any[]; }) => group.items?.some(item => item.type === "soundfile"))) {
            const memory = this.createMemoryMono(factory);
            const instance = await WebAssembly.instantiate(factory.module, this.createWasmImport(memory));
            return this.createMonoDSPInstanceAux(instance, factory.json, memory);
        } else {
            // Otherwise, we can create the instance using the wasm internal memory allocated by the wasm module
            const instance = await WebAssembly.instantiate(factory.module, this.createWasmImport());
            return this.createMonoDSPInstanceAux(instance, factory.json);
        }
    }

    static createSyncMonoDSPInstance(factory: LooseFaustDspFactory) {
        const parsedJson = JSON.parse(factory.json);
        // If the JSON contains a soundfile UI element, we need to create a memory object
        if (Array.isArray(parsedJson.ui) && parsedJson.ui.some((group: { items: any[]; }) => group.items?.some(item => item.type === "soundfile"))) {
            const memory = this.createMemoryMono(factory);
            const instance = new WebAssembly.Instance(factory.module, this.createWasmImport(memory));
            return this.createMonoDSPInstanceAux(instance, factory.json, memory);
        } else {
            // Otherwise, we can create the instance using the wasm internal memory allocated by the wasm module
            const instance = new WebAssembly.Instance(factory.module, this.createWasmImport());
            return this.createMonoDSPInstanceAux(instance, factory.json);
        }
    }

    static async createAsyncPolyDSPInstance(voiceFactory: LooseFaustDspFactory, mixerModule: WebAssembly.Module, voices: number, effectFactory?: LooseFaustDspFactory): Promise<FaustPolyDspInstance> {
        const memory = this.createMemoryPoly(voices, voiceFactory, effectFactory);
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
            } as FaustPolyDspInstance;
        } else {
            return {
                memory,
                voices,
                voiceAPI,
                mixerAPI,
                voiceJSON: voiceFactory.json
            } as FaustPolyDspInstance;
        }
    }

    static createSyncPolyDSPInstance(voiceFactory: LooseFaustDspFactory, mixerModule: WebAssembly.Module, voices: number, effectFactory?: LooseFaustDspFactory): FaustPolyDspInstance {
        const memory = this.createMemoryPoly(voices, voiceFactory, effectFactory);
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
                memory,
                voices,
                voiceAPI,
                effectAPI,
                mixerAPI,
                voiceJSON: voiceFactory.json,
                effectJSON: effectFactory.json
            } as FaustPolyDspInstance;
        } else {
            return {
                memory,
                voices,
                voiceAPI,
                mixerAPI,
                voiceJSON: voiceFactory.json
            } as FaustPolyDspInstance;
        }
    }
}

export default FaustWasmInstantiator;
