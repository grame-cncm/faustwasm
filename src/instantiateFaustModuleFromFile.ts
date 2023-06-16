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
    const jsCodeHead = /var (.+) = \(/;
    if (typeof window === "object") {
        let jsCode = await (await fetch(jsFile)).text();
        jsCode = `${jsCode}
export default ${jsCode.match(jsCodeHead)?.[1]};
`;
        const jsFileMod = URL.createObjectURL(new Blob([jsCode], { type: "text/javascript" }));
        FaustModule = (await import(/* webpackIgnore: true */jsFileMod)).default;
        dataBinary = await (await fetch(dataFile)).arrayBuffer();
        wasmBinary = new Uint8Array(await (await fetch(wasmFile)).arrayBuffer());
    } else {
        const { promises: fs } = await import("fs");
        const { pathToFileURL } = await import("url");
        let jsCode = (await fs.readFile(jsFile, { encoding: "utf-8" }));
        jsCode = `
import process from "process";
import * as path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const __filename = fileURLToPath(import.meta.url);
const require = createRequire(import.meta.url);

${jsCode}

export default ${jsCode.match(jsCodeHead)?.[1]};
`;
        const jsFileMod = jsFile.replace(/c?js$/, "mjs");
        await fs.writeFile(jsFileMod, jsCode);
        FaustModule = (await import(/* webpackIgnore: true */pathToFileURL(jsFileMod).href)).default;
        await fs.unlink(jsFileMod);
        dataBinary = (await fs.readFile(dataFile)).buffer;
        wasmBinary = (await fs.readFile(wasmFile)).buffer;
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
