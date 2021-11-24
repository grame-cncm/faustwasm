//@ts-check
const path = require("path");
const fs = require("fs");

const faustUIDistPath = path.join(__dirname, "./node_modules/@shren/faust-ui/dist/esm");
const faustUIDistDest = path.join(__dirname, "./assets/wam2/faust-ui");
const faustUIDistDest2 = path.join(__dirname, "./test/faustlive-wasm/faust-ui");

try {
    fs.rmSync(faustUIDistDest, { force: true, recursive: true });
    fs.rmSync(faustUIDistDest2, { force: true, recursive: true });
} catch (e) {
    console.warn(e);
}
try {
    fs.mkdirSync(faustUIDistDest);
    fs.mkdirSync(faustUIDistDest2);
} catch (e) {
    console.warn(e);
}

fs.cpSync(faustUIDistPath, faustUIDistDest, { recursive: true });
fs.cpSync(faustUIDistPath, faustUIDistDest2, { recursive: true });
const dts = `export * from "@shren/faust-ui";\n`;
fs.writeFileSync(path.join(faustUIDistDest, "index.d.ts"), dts);
fs.writeFileSync(path.join(faustUIDistDest2, "index.d.ts"), dts);

console.log("FaustUI files copied.")

const faustWasmDistPath = path.join(__dirname, "./dist");
const faustWasmDistEsmPath = path.join(__dirname, "./dist/esm");
const faustWasmDistDest = path.join(__dirname, "./assets/wam2/faustwasm");
const faustWasmDistDest2 = path.join(__dirname, "./test/faustlive-wasm/faustwasm");

fs.copyFileSync(path.join(faustWasmDistPath, "index.d.ts"), path.join(faustWasmDistEsmPath, "index.d.ts"));

try {
    fs.rmSync(faustWasmDistDest, { force: true, recursive: true });
    fs.rmSync(faustWasmDistDest2, { force: true, recursive: true });
} catch (e) {
    console.warn(e);
}
try {
    fs.mkdirSync(faustWasmDistDest);
    fs.mkdirSync(faustWasmDistDest2);
} catch (e) {
    console.warn(e);
}

fs.cpSync(faustWasmDistEsmPath, faustWasmDistDest, { recursive: true });
fs.cpSync(faustWasmDistEsmPath, faustWasmDistDest2, { recursive: true });

console.log("FaustWasm files copied.")
