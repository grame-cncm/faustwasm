import type {
    FaustDspWasm,
    FaustInfoType,
    IntVector,
    LibFaustWasm,
    RustFaustModule
} from './types';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

class RustIntVector implements IntVector {
    private fData: Uint8Array;

    constructor(data: Uint8Array) {
        this.fData = data;
    }
    size() {
        return this.fData.length;
    }
    get(i: number) {
        return this.fData[i] ?? 0;
    }
    delete() {
        this.fData = new Uint8Array(0);
    }
}

class RustLibFaust implements LibFaustWasm {
    private fModule: RustFaustModule;
    private fLastError = '';

    constructor(module: RustFaustModule) {
        this.fModule = module;
    }

    private allocUtf8(str: string) {
        const data = encoder.encode(str);
        const ptr = this.fModule.faust_wasm_alloc(data.length);
        new Uint8Array(this.fModule.memory.buffer, ptr, data.length).set(data);
        return { ptr, len: data.length };
    }

    private readUtf8(ptr: number, len: number) {
        return decoder.decode(
            new Uint8Array(this.fModule.memory.buffer, ptr, len)
        );
    }

    private copyBytes(ptr: number, len: number) {
        return new Uint8Array(
            new Uint8Array(this.fModule.memory.buffer, ptr, len)
        );
    }

    private fail(message: string): never {
        this.fLastError = message;
        throw new Error(message);
    }

    version() {
        return this.readUtf8(
            this.fModule.faust_wasm_version_ptr(),
            this.fModule.faust_wasm_version_len()
        );
    }

    createDSPFactory(
        name: string,
        code: string,
        args: string,
        useInternalMemory: boolean
    ): FaustDspWasm {
        const nameBuf = this.allocUtf8(name);
        const codeBuf = this.allocUtf8(code);
        const argsBuf = this.allocUtf8(args);
        try {
            const handle = this.fModule.faust_wasm_compile_dsp(
                nameBuf.ptr,
                nameBuf.len,
                codeBuf.ptr,
                codeBuf.len,
                argsBuf.ptr,
                argsBuf.len,
                useInternalMemory ? 1 : 0
            );
            if (this.fModule.faust_wasm_result_is_ok(handle) === 0) {
                const error = this.readUtf8(
                    this.fModule.faust_wasm_result_error_ptr(handle),
                    this.fModule.faust_wasm_result_error_len(handle)
                );
                this.fModule.faust_wasm_result_free(handle);
                return this.fail(error || 'Rust Faust compilation failed');
            }
            const wasmBytes = this.copyBytes(
                this.fModule.faust_wasm_result_wasm_ptr(handle),
                this.fModule.faust_wasm_result_wasm_len(handle)
            );
            const json = this.readUtf8(
                this.fModule.faust_wasm_result_json_ptr(handle),
                this.fModule.faust_wasm_result_json_len(handle)
            );
            this.fModule.faust_wasm_result_free(handle);
            this.fLastError = '';
            return {
                cfactory: 0,
                data: new RustIntVector(wasmBytes),
                json
            };
        } finally {
            this.fModule.faust_wasm_dealloc(nameBuf.ptr, nameBuf.len);
            this.fModule.faust_wasm_dealloc(codeBuf.ptr, codeBuf.len);
            this.fModule.faust_wasm_dealloc(argsBuf.ptr, argsBuf.len);
        }
    }

    deleteDSPFactory(_cFactory: number) {}

    expandDSP(_name: string, _code: string, _args: string) {
        return this.fail(
            'expandDSP is not supported by the Rust raw faustwasm backend yet'
        );
    }

    generateAuxFiles(_name: string, _code: string, _args: string) {
        return this.fail(
            'generateAuxFiles is not supported by the Rust raw faustwasm backend yet'
        );
    }

    deleteAllDSPFactories() {}

    getErrorAfterException() {
        return this.fLastError;
    }

    cleanupAfterException() {
        this.fLastError = '';
    }

    getInfos(what: FaustInfoType) {
        if (what === 'version') {
            return this.version();
        }
        return this.fail(
            `getInfos(${what}) is not supported by the Rust raw faustwasm backend yet`
        );
    }
}

export default RustLibFaust;
