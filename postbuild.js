//@ts-check
const path = require("path");
const fs = require("fs");

/**
 * @param {string} src
 * @param {string} dest
 */
const cpSync = (src, dest) => {
    if (!fs.existsSync(src)) return;
    if (fs.lstatSync(src).isDirectory()) {
        if (!fs.existsSync(dest)) fs.mkdirSync(dest);
        fs.readdirSync(src).forEach(child => cpSync(path.join(src, child), path.join(dest, child)));
    } else {
        fs.copyFileSync(src, dest);
    }
};

/**
 * @param {string} dir
 */
 const rmSync = (dir) => {
    if (!fs.existsSync(dir)) return;
    if (fs.lstatSync(dir).isDirectory()) {
        fs.readdirSync(dir).forEach(child => rmSync(path.join(dir, child)));
        fs.rmdirSync(dir);
    } else {
        fs.unlinkSync(dir);
    }
};

const faustUIDistPath = path.join(__dirname, "./node_modules/@shren/faust-ui/dist/esm");
const faustUIDistDest = path.join(__dirname, "./assets/wam2/faust-ui");
const faustUIDistDest2 = path.join(__dirname, "./test/faustlive-wasm/faust-ui");

try {
    rmSync(faustUIDistDest);
    rmSync(faustUIDistDest2);
} catch (e) {
    console.warn(e);
}
try {
    fs.mkdirSync(faustUIDistDest);
    fs.mkdirSync(faustUIDistDest2);
} catch (e) {
    console.warn(e);
}

cpSync(faustUIDistPath, faustUIDistDest);
cpSync(faustUIDistPath, faustUIDistDest2);
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

module.exports = { cpSync, rmSync };
