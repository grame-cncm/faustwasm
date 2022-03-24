//@ts-check
import { cpSync, rmSync } from "./fileutils.js";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

// @ts-ignore
const __dirname = path.dirname(fileURLToPath(import.meta.url));
// @ts-ignore
const __filename = fileURLToPath(import.meta.url);

const faustUiDistPath = path.join(__dirname, "./node_modules/@shren/faust-ui/dist/esm");
const faustUiDistDest = path.join(__dirname, "./assets/standalone/faust-ui");
const faustUiDistDest2 = path.join(__dirname, "./test/faustlive-wasm/faust-ui");

try {
    rmSync(faustUiDistDest);
    rmSync(faustUiDistDest2);
} catch (e) {
    console.warn(e);
}
try {
    fs.mkdirSync(faustUiDistDest);
    fs.mkdirSync(faustUiDistDest2);
} catch (e) {
    console.warn(e);
}

cpSync(faustUiDistPath, faustUiDistDest);
cpSync(faustUiDistPath, faustUiDistDest2);
const faustUiDts = `export * from "@shren/faust-ui";\n`;
fs.writeFileSync(path.join(faustUiDistDest, "index.d.ts"), faustUiDts);
fs.writeFileSync(path.join(faustUiDistDest2, "index.d.ts"), faustUiDts);

console.log("FaustUI files copied.")

const faustWasmDistPath = path.join(__dirname, "./dist/cjs");
const faustWasmDistEsmPath = path.join(__dirname, "./dist/esm");
const faustWasmDistBundlePath = path.join(__dirname, "./dist/cjs-bundle");
const faustWasmDistEsmBundlePath = path.join(__dirname, "./dist/esm-bundle");
const faustWasmDistDest = path.join(__dirname, "./assets/standalone/faustwasm");
const faustWasmDistDest2 = path.join(__dirname, "./test/faustlive-wasm/faustwasm");

fs.copyFileSync(path.join(faustWasmDistPath, "index.d.ts"), path.join(faustWasmDistEsmPath, "index.d.ts"));
fs.copyFileSync(path.join(faustWasmDistBundlePath, "index.d.ts"), path.join(faustWasmDistEsmBundlePath, "index.d.ts"));

try {
    rmSync(faustWasmDistDest);
    rmSync(faustWasmDistDest2);
} catch (e) {
    console.warn(e);
}
try {
    fs.mkdirSync(faustWasmDistDest);
    fs.mkdirSync(faustWasmDistDest2);
} catch (e) {
    console.warn(e);
}

cpSync(faustWasmDistEsmPath, faustWasmDistDest);
cpSync(faustWasmDistEsmPath, faustWasmDistDest2);

console.log("FaustWasm files copied.")
