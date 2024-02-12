import * as FaustWasm from "../../dist/esm/index.js";
import * as path from "path";
import * as fs from "fs";
import { fileURLToPath, pathToFileURL } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const __filename = fileURLToPath(import.meta.url);

const wasmBuf = fs.readFileSync(path.join(__dirname, "../../libfaust-wasm/libfaust-wasm.wasm")).buffer;

(async () => {
    // const w = await WebAssembly.instantiate(wasmBuf, {env:{},wasi_snapshot_preview1:{}});
    // console.log(w);
    const faustModule = await FaustWasm.instantiateFaustModuleFromFile(path.join(__dirname, "../../libfaust-wasm/libfaust-wasm.js"));
    console.log(faustModule);
})();
