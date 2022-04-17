import factoryFn from "../libfaust-wasm/libfaust-wasm.cjs";
import wasmBinary from "../libfaust-wasm/libfaust-wasm.wasm";
import dataBinary from "../libfaust-wasm/libfaust-wasm.data";

export const FaustModuleFactoryFn = factoryFn;
export const FaustModuleFactoryWasm = wasmBinary;
export const FaustModuleFactoryData = dataBinary;

/**
 * Instantiate `FaustModule` using bundled binaries. Module constructor and files can be overriden.
 */
const instantiateFaustModule = async (FaustModuleFactoryIn = factoryFn, dataBinaryIn = dataBinary, wasmBinaryIn = wasmBinary) => {
    const g = globalThis as any;
    if (g.AudioWorkletGlobalScope) {
        g.importScripts = () => {};
        g.self = { location: { href: "" } };
    }
    const faustModule = await FaustModuleFactoryIn({
        wasmBinary: wasmBinaryIn,
        getPreloadedPackage: (remotePackageName: string, remotePackageSize: number) => {
            if (remotePackageName === "libfaust-wasm.data") return dataBinaryIn.buffer;
            return new ArrayBuffer(0);
        }
    });
    if (g.AudioWorkletGlobalScope) {
		delete g.importScripts;
		delete g.self;
    }
    return faustModule;
};

export default instantiateFaustModule;
