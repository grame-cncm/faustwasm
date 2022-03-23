import type { FaustModuleFactory } from "./types";

/**
 * Load libfaust-wasm files, than instantiate libFaust
 * @param jsFile path to `libfaust-wasm.js`
 * @param dataFile path to `libfaust-wasm.data`
 * @param wasmFile path to `libfaust-wasm.wasm`
 */
const instantiateFaustModuleFromFile = async (jsFile: string, dataFile = jsFile.replace(/c?js$/, "data"), wasmFile = jsFile.replace(/c?js$/, "wasm")) => {
    let FaustModule: FaustModuleFactory;
    let dataBinary: ArrayBuffer;
    let wasmBinary: Uint8Array | ArrayBuffer;
    FaustModule = (await import(jsFile)).default;
    if (typeof globalThis.fetch === "function") {
        dataBinary = await (await fetch(dataFile)).arrayBuffer();
        wasmBinary = new Uint8Array(await (await fetch(wasmFile)).arrayBuffer());
    } else {
        const fs = await import("fs/promises");
        const { fileURLToPath } = await import("url");
        dataBinary = (await fs.readFile(fileURLToPath(dataFile))).buffer;
        wasmBinary = (await fs.readFile(fileURLToPath(wasmFile))).buffer;
    }
    const faustModule = await FaustModule({
        wasmBinary,
        getPreloadedPackage: (remotePackageName: string, remotePackageSize: number) => {
            if (remotePackageName === "libfaust-wasm.data") return dataBinary;
            return new ArrayBuffer(0);
        }});
    return faustModule;
};

export default instantiateFaustModuleFromFile;
