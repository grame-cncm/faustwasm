//@ts-check
import { join } from "path";
import { mkdirSync, writeFileSync, copyFileSync } from "fs";
import { cpSync, rmSync } from "./fileutils.js";

import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const __filename = fileURLToPath(import.meta.url);

const faustUiDistPath = join(__dirname, "./node_modules/@shren/faust-ui/dist/esm");
const faustUiDistDest = join(__dirname, "./assets/standalone/faust-ui");
const faustUiDistDest2 = join(__dirname, "./test/faustlive-wasm/faust-ui");

try {
    rmSync(faustUiDistDest);
    rmSync(faustUiDistDest2);
} catch (e) {
    console.warn(e);
}
try {
    mkdirSync(faustUiDistDest);
    mkdirSync(faustUiDistDest2);
} catch (e) {
    console.warn(e);
}

cpSync(faustUiDistPath, faustUiDistDest);
cpSync(faustUiDistPath, faustUiDistDest2);
const faustUiDts = `export * from "@shren/faust-ui";\n`;
writeFileSync(join(faustUiDistDest, "index.d.ts"), faustUiDts);
writeFileSync(join(faustUiDistDest2, "index.d.ts"), faustUiDts);

console.log("FaustUI files copied.")

const faustWasmDistPath = join(__dirname, "./dist");
const faustWasmDistEsmPath = join(__dirname, "./dist/esm");
const faustWasmDistDest = join(__dirname, "./assets/standalone/faustwasm");
const faustWasmDistDest2 = join(__dirname, "./test/faustlive-wasm/faustwasm");

copyFileSync(join(faustWasmDistPath, "index.d.ts"), join(faustWasmDistEsmPath, "index.d.ts"));

try {
    rmSync(faustWasmDistDest);
    rmSync(faustWasmDistDest2);
} catch (e) {
    console.warn(e);
}
try {
    mkdirSync(faustWasmDistDest);
    mkdirSync(faustWasmDistDest2);
} catch (e) {
    console.warn(e);
}

cpSync(faustWasmDistEsmPath, faustWasmDistDest);
cpSync(faustWasmDistEsmPath, faustWasmDistDest2);

console.log("FaustWasm files copied.")
