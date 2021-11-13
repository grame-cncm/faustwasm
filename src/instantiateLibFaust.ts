import { FaustModuleFactory } from "./types";
import fetchModule from "./fetchModule";

const instantiateLibFaust = async (jsFile: string, dataFile = jsFile.replace(/c?js$/, "data"), wasmFile = jsFile.replace(/c?js$/, "wasm")) => {
    /*
    const ENVIRONMENT_IS_WEB = typeof window === "object";
    const ENVIRONMENT_IS_WORKER = typeof importScripts === "function";
    const ENVIRONMENT_IS_NODE = typeof process === "object" && typeof process.versions === "object" && typeof process.versions.node === "string";
    const ENVIRONMENT_IS_SHELL = !ENVIRONMENT_IS_WEB && !ENVIRONMENT_IS_NODE && !ENVIRONMENT_IS_WORKER;
    let LibFaust: FaustModuleFactory;
    if (ENVIRONMENT_IS_NODE) {
        const { createRequire } = await import("module");
        const require = createRequire(import.meta.url);
        LibFaust = require(jsFile.replace(/\.js$/, ".cjs"));
    } else {
        LibFaust = (await import(jsFile)).default;
    }
    */
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
    /*
    libFaust.lengthBytesUTF8 = (str: string) => {
        let len = 0;
        for (let i = 0; i < str.length; ++i) {
            let u = str.charCodeAt(i);
            if (u >= 55296 && u <= 57343) u = 65536 + ((u & 1023) << 10) | str.charCodeAt(++i) & 1023;
            if (u <= 127) ++len;
            else if (u <= 2047) len += 2;
            else if (u <= 65535) len += 3;
            else if (u <= 2097151) len += 4;
            else if (u <= 67108863) len += 5;
            else len += 6;
        }
        return len;
    };
    */
    return libFaust;
};

export default instantiateLibFaust;
