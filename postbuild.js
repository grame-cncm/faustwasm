//@ts-check
const path = require("path");
const fs = require("fs");
const { cpSync, rmSync } = require("./fileutils");

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

const faustWasmDistPath = path.join(__dirname, "./dist");
const faustWasmDistEsmPath = path.join(__dirname, "./dist/esm");
const faustWasmDistDest = path.join(__dirname, "./assets/standalone/faustwasm");
const faustWasmDistDest2 = path.join(__dirname, "./test/faustlive-wasm/faustwasm");

fs.copyFileSync(path.join(faustWasmDistPath, "index.d.ts"), path.join(faustWasmDistEsmPath, "index.d.ts"));

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
