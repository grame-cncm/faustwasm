import type {
    FaustDspWasm,
    FaustInfoType,
    IntVector,
    LibFaustWasm,
    RustFaustModule,
    WasmAuxFileDto
} from './types';
import {
    FaustCompilerError,
    parseFaustDiagnosticReport
} from './FaustDiagnostics';
import type { FaustDiagnosticReport } from './FaustDiagnostics';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * Minimal `IntVector` implementation backed by copied WASM bytes.
 *
 * The historical C++ path returns a vector-like object. The raw Rust compiler
 * path copies the compiled module bytes out of linear memory and re-exposes
 * them through the same small interface expected by the higher-level factory
 * code.
 */
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

/**
 * Adapter from the raw Rust `wasm-ffi` ABI to the historical `LibFaustWasm`
 * method surface used internally by `faustwasm`.
 *
 * This class is intentionally compatibility-oriented:
 * - host strings are encoded to UTF-8 and copied into linear memory
 * - results are read back through handle-based pointer/length accessors
 * - helper failures are surfaced through `getErrorAfterException()` so the
 *   surrounding `FaustCompiler` code can keep its existing control flow
 */
class RustLibFaust implements LibFaustWasm {
    private fModule: RustFaustModule;
    private fLastError = '';
    private fLastErrorDiagnostics: FaustDiagnosticReport | null = null;
    private fLastDiagnostics: FaustDiagnosticReport | null = null;
    /** Extra user-supplied virtual sources, synced from the host (e.g. in-memory FS). */
    private fExtraVirtualSources: Map<string, string> = new Map();
    /** Host-prefetched HTTP(S) sources, keyed by their absolute URL. */
    private fRemoteSources: Map<string, string> = new Map();

    constructor(module: RustFaustModule) {
        this.fModule = module;
    }

    /**
     * Register or update a named virtual source available to the compiler.
     * Pass `null` as content to remove the entry.
     */
    setVirtualSource(name: string, content: string | null) {
        if (content === null) this.fExtraVirtualSources.delete(name);
        else this.fExtraVirtualSources.set(name, content);
    }

    /** Register, update, or remove one host-prefetched HTTP(S) source. */
    setRemoteSource(url: string, content: string | null) {
        if (content === null) this.fRemoteSources.delete(url);
        else this.fRemoteSources.set(url, content);
    }

    /** Remove every registered host-prefetched remote source. */
    clearRemoteSources() {
        this.fRemoteSources.clear();
    }

    /** Encode registered virtual and remote sources as transport-only flags. */
    private sourceFlags(): string {
        const parts: string[] = [];
        for (const [name, content] of [...this.fExtraVirtualSources].sort(
            ([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)
        )) {
            parts.push(
                `--virtual-source ${name}=${RustLibFaust.base64FromString(content)}`
            );
        }
        for (const [url, content] of [...this.fRemoteSources].sort(
            ([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)
        )) {
            parts.push(
                `--remote-source ${url} ${RustLibFaust.base64FromString(content)}`
            );
        }
        if (parts.length === 0) return '';
        return ' ' + parts.join(' ');
    }

    /** Stable description of hidden compiler inputs used by factory caching. */
    getCompilationContextKey(): string {
        return this.sourceFlags();
    }

    private static base64FromString(str: string): string {
        const bytes = encoder.encode(str);
        if (typeof Buffer !== 'undefined') {
            return Buffer.from(bytes).toString('base64');
        }
        // Browser: build binary string in chunks to avoid call-stack overflow,
        // then encode with the native btoa (same approach as the ab2str fix).
        const CHUNK = 0x8000;
        let binary = '';
        for (let i = 0; i < bytes.length; i += CHUNK) {
            binary += String.fromCharCode(
                ...(bytes.subarray(i, i + CHUNK) as unknown as number[])
            );
        }
        return btoa(binary);
    }

    /**
     * Allocate and populate one UTF-8 string inside the raw Rust compiler
     * module's linear memory.
     *
     * The caller is responsible for releasing the returned region with
     * `faust_wasm_dealloc`.
     */
    private allocUtf8(str: string) {
        const data = encoder.encode(str);
        const ptr = this.fModule.faust_wasm_alloc(data.length);
        new Uint8Array(this.fModule.memory.buffer, ptr, data.length).set(data);
        return { ptr, len: data.length };
    }

    /**
     * Decode one UTF-8 slice borrowed from the compiler module memory.
     */
    private readUtf8(ptr: number, len: number) {
        return decoder.decode(
            new Uint8Array(this.fModule.memory.buffer, ptr, len)
        );
    }

    /**
     * Copy one byte payload out of the compiler module memory.
     *
     * Compile-result payloads must be copied before the associated handle is
     * freed.
     */
    private copyBytes(ptr: number, len: number) {
        return new Uint8Array(
            new Uint8Array(this.fModule.memory.buffer, ptr, len)
        );
    }

    /**
     * Record the last helper/compiler error and throw a JS exception carrying
     * the same message.
     */
    private fail(
        message: string,
        diagnostics: FaustDiagnosticReport | null = null,
        cause?: unknown
    ): never {
        this.fLastError = message;
        this.fLastErrorDiagnostics = diagnostics;
        throw new FaustCompilerError(message, diagnostics, cause);
    }

    /**
     * Query and copy one optional diagnostics-v2 report before its compile
     * result is freed.
     *
     * Invalid/malformed payloads degrade to `null`; they never replace the
     * human compatibility message that explains the original failure.
     */
    private readDiagnostics(
        query: ((handle: number) => number) | undefined,
        compileHandle: number
    ): FaustDiagnosticReport | null {
        if (typeof query !== 'function') return null;
        let textHandle: number | null = null;
        try {
            textHandle = query(compileHandle);
            if (this.fModule.faust_wasm_text_result_is_ok(textHandle) === 0) {
                return null;
            }
            const text = this.readUtf8(
                this.fModule.faust_wasm_text_result_ptr(textHandle),
                this.fModule.faust_wasm_text_result_len(textHandle)
            );
            return parseFaustDiagnosticReport(text);
        } catch {
            return null;
        } finally {
            if (textHandle !== null) {
                this.fModule.faust_wasm_text_result_free(textHandle);
            }
        }
    }

    /**
     * Resolve a stored text-result handle returned by the raw Rust helper ABI.
     *
     * The payload is copied to JS immediately and the handle is freed before
     * returning.
     */
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
        const argsBuf = this.allocUtf8(args + this.sourceFlags());
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
                const diagnostics = this.readDiagnostics(
                    this.fModule.faust_wasm_result_get_error_diagnostics,
                    handle
                );
                this.fModule.faust_wasm_result_free(handle);
                this.fLastDiagnostics = null;
                return this.fail(
                    error || 'Rust Faust compilation failed',
                    diagnostics
                );
            }
            const wasmBytes = this.copyBytes(
                this.fModule.faust_wasm_result_wasm_ptr(handle),
                this.fModule.faust_wasm_result_wasm_len(handle)
            );
            const json = this.readUtf8(
                this.fModule.faust_wasm_result_json_ptr(handle),
                this.fModule.faust_wasm_result_json_len(handle)
            );
            this.fLastDiagnostics = this.readDiagnostics(
                this.fModule.faust_wasm_result_get_diagnostics,
                handle
            );
            this.fModule.faust_wasm_result_free(handle);
            this.fLastError = '';
            this.fLastErrorDiagnostics = null;
            return {
                cfactory: 0,
                data: new RustIntVector(wasmBytes),
                json
            };
        } finally {
            // Request buffers are always released on the host side after the
            // compiler call completes, regardless of success or failure.
            this.fModule.faust_wasm_dealloc(nameBuf.ptr, nameBuf.len);
            this.fModule.faust_wasm_dealloc(codeBuf.ptr, codeBuf.len);
            this.fModule.faust_wasm_dealloc(argsBuf.ptr, argsBuf.len);
        }
    }

    /**
     * No-op compatibility shim.
     *
     * The raw Rust compiler path does not expose factory pointers with a
     * separate lifetime; `faustwasm` caches the returned artifact directly.
     */
    deleteDSPFactory(_cFactory: number) {}

    expandDSP(name: string, code: string, args: string) {
        const nameBuf = this.allocUtf8(name);
        const codeBuf = this.allocUtf8(code);
        const argsBuf = this.allocUtf8(args + this.sourceFlags());
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

    /**
     * Decode a standard base64 string to a `Uint8Array`.
     *
     * Works in both browser (`atob`) and Node.js (`Buffer`) environments.
     */
    private static base64ToBytes(b64: string): Uint8Array {
        if (typeof Buffer !== 'undefined') {
            return new Uint8Array(Buffer.from(b64, 'base64'));
        }
        return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    }

    /**
     * Call `faust_wasm_generate_aux_files_json` and return the complete
     * auxiliary-file map keyed by relative path.
     *
     * All artifacts are returned, not only SVG files.  Callers that want only
     * SVG can filter by `.endsWith('.svg')`.  `process.svg` is always the
     * first key in the returned map, matching the hierarchy entry-point
     * convention.
     *
     * @param name - logical DSP source name
     * @param code - Faust DSP source text
     * @param args - compiler argument string (e.g. `-lang wasm -o binary -svg`)
     * @returns map from relative path to decoded UTF-8 content (for text
     *   artifacts) or an opaque byte string (for binary artifacts)
     */
    generateAuxFilesJson(
        name: string,
        code: string,
        args: string
    ): Record<string, string> {
        const nameBuf = this.allocUtf8(name);
        const codeBuf = this.allocUtf8(code);
        const argsBuf = this.allocUtf8(args + this.sourceFlags());
        try {
            const handle = this.fModule.faust_wasm_generate_aux_files_json(
                nameBuf.ptr,
                nameBuf.len,
                codeBuf.ptr,
                codeBuf.len,
                argsBuf.ptr,
                argsBuf.len
            );
            const json = this.readTextResult(handle);
            const dtos: WasmAuxFileDto[] = JSON.parse(json);
            const result: Record<string, string> = {};
            for (const dto of dtos) {
                const bytes = RustLibFaust.base64ToBytes(dto.content_base64);
                result[dto.path] = new TextDecoder().decode(bytes);
            }
            return result;
        } finally {
            this.fModule.faust_wasm_dealloc(nameBuf.ptr, nameBuf.len);
            this.fModule.faust_wasm_dealloc(codeBuf.ptr, codeBuf.len);
            this.fModule.faust_wasm_dealloc(argsBuf.ptr, argsBuf.len);
        }
    }

    generateAuxFiles(name: string, code: string, args: string) {
        const nameBuf = this.allocUtf8(name);
        const codeBuf = this.allocUtf8(code);
        const argsBuf = this.allocUtf8(args + this.sourceFlags());
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
                // Keep a stable compatibility message until the richer aux-file
                // API is fully surfaced through `faustwasm`.
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

    /**
     * No-op compatibility shim.
     *
     * The Rust embedded compiler currently keeps no JS-visible factory cache on
     * the compiler side.
     */
    deleteAllDSPFactories() {}

    getErrorAfterException() {
        return this.fLastError;
    }

    getErrorDiagnosticsAfterException() {
        return this.fLastErrorDiagnostics;
    }

    getDiagnostics() {
        return this.fLastDiagnostics;
    }

    cleanupAfterException() {
        this.fLastError = '';
        this.fLastErrorDiagnostics = null;
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
