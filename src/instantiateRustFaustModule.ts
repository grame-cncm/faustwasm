import type { RustFaustModule } from './types';

const toArrayBuffer = (binary: BufferSource) => {
    if (binary instanceof ArrayBuffer) {
        return binary;
    }
    if (ArrayBuffer.isView(binary)) {
        return binary.buffer.slice(
            binary.byteOffset,
            binary.byteOffset + binary.byteLength
        );
    }
    throw new Error('Unsupported Rust compiler-module binary source');
};

/**
 * Instantiate a raw Rust `faustwasm` compiler module from a `.wasm` binary.
 *
 * Unlike the historical `libfaust-wasm` path, this loader does not require any
 * Emscripten JS glue: the returned value is the typed raw export surface
 * produced directly by the Rust `wasm-ffi` crate.
 */
const instantiateRustFaustModule = async (
    wasmBinary: BufferSource,
    imports: WebAssembly.Imports = {}
) => {
    const { instance } = await WebAssembly.instantiate(
        toArrayBuffer(wasmBinary),
        imports
    );
    return instance.exports as unknown as RustFaustModule;
};

export default instantiateRustFaustModule;
