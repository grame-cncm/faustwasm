import type { FaustModuleFactory } from './types';

/**
 * Load libfaust-wasm files, than instantiate libFaust
 * @param jsFile path to `libfaust-wasm.js`
 * @param dataFile path to `libfaust-wasm.data`
 * @param wasmFile path to `libfaust-wasm.wasm`
 */
const instantiateFaustModuleFromFile = async (
    jsFile: string,
    dataFile = jsFile.replace(/c?js$/, 'data'),
    wasmFile = jsFile.replace(/c?js$/, 'wasm')
) => {
    let FaustModule: FaustModuleFactory;
    let dataBinary: ArrayBuffer;
    let wasmBinary: ArrayBuffer;
    // Match both `var FaustModule = (` (older emcc) and `var FaustModule=(` (emcc 5.x)
    const jsCodeHead = /var (\w+)\s*=\s*\(/;
    if (typeof window === 'object') {
        let jsCode = await (await fetch(jsFile)).text();
        jsCode = `${jsCode}
export default ${jsCode.match(jsCodeHead)?.[1]};
`;
        const jsFileMod = URL.createObjectURL(
            new Blob([jsCode], { type: 'text/javascript' })
        );
        FaustModule = (await import(/* webpackIgnore: true */ jsFileMod))
            .default;
        dataBinary = await (await fetch(dataFile)).arrayBuffer();
        wasmBinary = await (await fetch(wasmFile)).arrayBuffer();
    } else {
        const { promises: fs } = await import('fs');
        const { pathToFileURL } = await import('url');
        let jsCode = await fs.readFile(jsFile, { encoding: 'utf-8' });
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
        // The wrapped module has to be written out before it can be imported,
        // and the name has to be unique: a fixed one makes two concurrent
        // compilations race, each unlinking the file the other is still
        // importing. It stays in the same directory so that `__dirname` inside
        // the emscripten module keeps pointing at libfaust-wasm.
        const unique = `${process.pid.toString(36)}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
        const jsFileMod = jsFile.replace(/c?js$/, `${unique}.mjs`);
        await fs.writeFile(jsFileMod, jsCode);
        try {
            FaustModule = (
                await import(
                    /* webpackIgnore: true */ pathToFileURL(jsFileMod).href
                )
            ).default;
        } finally {
            // Cleanup must not mask an import failure, nor fail the call when
            // the module loaded fine.
            await fs.unlink(jsFileMod).catch(() => {});
        }
        // Using a type assertion `as ArrayBuffer` to satisfy the strict type checking.
        dataBinary = new Uint8Array(await fs.readFile(dataFile))
            .buffer as ArrayBuffer;
        wasmBinary = new Uint8Array(await fs.readFile(wasmFile))
            .buffer as ArrayBuffer;
    }
    const faustModule = await FaustModule({
        wasmBinary,
        getPreloadedPackage: (
            remotePackageName: string,
            remotePackageSize: number
        ) => {
            if (remotePackageName === 'libfaust-wasm.data') return dataBinary;
            return new ArrayBuffer(0);
        }
    });
    return faustModule;
};

export default instantiateFaustModuleFromFile;
