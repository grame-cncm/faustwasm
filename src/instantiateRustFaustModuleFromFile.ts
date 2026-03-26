import instantiateRustFaustModule from './instantiateRustFaustModule';

/**
 * Load and instantiate a raw Rust `faustwasm` compiler module from a `.wasm`
 * file or URL.
 */
const instantiateRustFaustModuleFromFile = async (
    wasmFile: string,
    imports: WebAssembly.Imports = {}
) => {
    let wasmBinary: ArrayBuffer;

    if (typeof window === 'object') {
        wasmBinary = await (await fetch(wasmFile)).arrayBuffer();
    } else {
        const { promises: fs } = await import('fs');
        wasmBinary = new Uint8Array(await fs.readFile(wasmFile))
            .buffer as ArrayBuffer;
    }

    return instantiateRustFaustModule(wasmBinary, imports);
};

export default instantiateRustFaustModuleFromFile;
