//@ts-ignore
import FaustModule from "../libfaust-wasm/libfaust-wasm.cjs";
import wasmBinary from "../libfaust-wasm/libfaust-wasm.wasm";
import dataBinary from "../libfaust-wasm/libfaust-wasm.data";

/**
 * Instantiate `FaustModule` using bundled binaries. Module constructor and files can be overriden.
 */
const instantiateFaustModule = async (FaustModuleIn = FaustModule, dataBinaryIn = dataBinary, wasmBinaryIn = wasmBinary) => {
    const g = globalThis as any;
    if (g.AudioWorkletGlobalScope) {
        g.importScripts = () => {};
        g.self = { location: { href: "" } };
    }
    const faustModule = await FaustModuleIn({
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
