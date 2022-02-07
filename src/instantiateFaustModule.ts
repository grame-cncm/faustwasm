import FaustModule from "../libfaust-wasm/libfaust-wasm";
import wasmBinary from "../libfaust-wasm/libfaust-wasm.wasm";
import dataBinary from "../libfaust-wasm/libfaust-wasm.data";

/**
 * Instantiate `FaustModule` using bundled binaries. Module constructor and files can be overriden.
 */
const instantiateFaustModule = async (FaustModuleIn = FaustModule, dataBinaryIn = dataBinary, wasmBinaryIn = wasmBinary) => {
    const faustModule = await FaustModuleIn({
        wasmBinary: wasmBinaryIn,
        getPreloadedPackage: (remotePackageName: string, remotePackageSize: number) => {
            if (remotePackageName === "libfaust-wasm.data") return dataBinaryIn.buffer;
            return new ArrayBuffer(0);
        }
    });
    return faustModule;
};

export default instantiateFaustModule;
