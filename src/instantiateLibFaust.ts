import fetchModule from "./fetchModule";
import type { FaustModuleFactory } from "./types";

/**
 * Load libfaust-wasm files, than instantiate libFaust
 * @param jsFile path to `libfaust-wasm.js`
 * @param dataFile path to `libfaust-wasm.data`
 * @param wasmFile path to `libfaust-wasm.wasm`
 */
const instantiateLibFaust = async (jsFile: string, dataFile = jsFile.replace(/c?js$/, "data"), wasmFile = jsFile.replace(/c?js$/, "wasm")) => {
    let LibFaust: FaustModuleFactory;
    try {
        LibFaust = require(jsFile);
    } catch (error) {
        LibFaust = await fetchModule(jsFile);
    }
    const locateFile = (url: string, scriptDirectory: string) => ({
        "libfaust-wasm.wasm": wasmFile,
        "libfaust-wasm.data": dataFile
    }[url]) || scriptDirectory + url;
    const libFaust = await LibFaust({ locateFile });
    return libFaust;
};

export default instantiateLibFaust;
