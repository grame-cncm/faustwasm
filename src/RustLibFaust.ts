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

    private readTextResult(handle: number) {
        const ok = this.fModule.faust_wasm_text_result_is_ok(handle) !== 0;
        const text = this.readUtf8(
            this.fModule.faust_wasm_text_result_ptr(handle),
            this.fModule.faust_wasm_text_result_len(handle)
        );
        this.fModule.faust_wasm_text_result_free(handle);
        if (!ok) {
            return this.fail(text || 'Rust Faust helper request failed');
        }
        this.fLastError = '';
        return text;
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

    expandDSP(name: string, code: string, args: string) {
        const nameBuf = this.allocUtf8(name);
        const codeBuf = this.allocUtf8(code);
        const argsBuf = this.allocUtf8(args);
        try {
            const handle = this.fModule.faust_wasm_expand_dsp(
                nameBuf.ptr,
                nameBuf.len,
                codeBuf.ptr,
                codeBuf.len,
                argsBuf.ptr,
                argsBuf.len
            );
            return this.readTextResult(handle);
        } finally {
            this.fModule.faust_wasm_dealloc(nameBuf.ptr, nameBuf.len);
            this.fModule.faust_wasm_dealloc(codeBuf.ptr, codeBuf.len);
            this.fModule.faust_wasm_dealloc(argsBuf.ptr, argsBuf.len);
        }
    }

    generateAuxFiles(name: string, code: string, args: string) {
        const nameBuf = this.allocUtf8(name);
        const codeBuf = this.allocUtf8(code);
        const argsBuf = this.allocUtf8(args);
        try {
            const ok =
                this.fModule.faust_wasm_generate_aux_files(
                    nameBuf.ptr,
                    nameBuf.len,
                    codeBuf.ptr,
                    codeBuf.len,
                    argsBuf.ptr,
                    argsBuf.len
                ) !== 0;
            if (!ok) {
                this.fLastError =
                    'generateAuxFiles is not implemented yet in the Rust faustwasm service';
            } else {
                this.fLastError = '';
            }
            return ok;
        } finally {
            this.fModule.faust_wasm_dealloc(nameBuf.ptr, nameBuf.len);
            this.fModule.faust_wasm_dealloc(codeBuf.ptr, codeBuf.len);
            this.fModule.faust_wasm_dealloc(argsBuf.ptr, argsBuf.len);
        }
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
        const whatBuf = this.allocUtf8(what);
        try {
            return this.readTextResult(
                this.fModule.faust_wasm_get_info(whatBuf.ptr, whatBuf.len)
            );
        } finally {
            this.fModule.faust_wasm_dealloc(whatBuf.ptr, whatBuf.len);
        }
    }
}

export default RustLibFaust;
