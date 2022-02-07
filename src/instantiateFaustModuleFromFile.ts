import fetchModule from "./fetchModule";
import type { FaustModuleFactory } from "./types";

/**
 * Load libfaust-wasm files, than instantiate libFaust
 * @param jsFile path to `libfaust-wasm.js`
 * @param dataFile path to `libfaust-wasm.data`
 * @param wasmFile path to `libfaust-wasm.wasm`
 */
const instantiateFaustModuleFromFile = async (jsFile: string, dataFile = jsFile.replace(/c?js$/, "data"), wasmFile = jsFile.replace(/c?js$/, "wasm")) => {
    let FaustModule: FaustModuleFactory;
    try {
        FaustModule = require(jsFile);
    } catch (error) {
        FaustModule = await fetchModule(jsFile);
    }
    const locateFile = (url: string, scriptDirectory: string) => ({
        "libfaust-wasm.wasm": wasmFile,
        "libfaust-wasm.data": dataFile
    }[url]) || scriptDirectory + url;
    const faustModule = await FaustModule({ locateFile });
    return faustModule;
};

export default instantiateFaustModuleFromFile;
