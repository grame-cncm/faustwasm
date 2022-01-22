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

const wamSdkParamMgrDistPath = path.join(__dirname, "./node_modules/@webaudiomodules/sdk-parammgr/dist");
const wamSdkParamMgrDistDest = path.join(__dirname, "./assets/wam2/sdk-parammgr");

try {
    rmSync(wamSdkParamMgrDistDest);
} catch (e) {
    console.warn(e);
}
try {
    fs.mkdirSync(wamSdkParamMgrDistDest);
} catch (e) {
    console.warn(e);
}

cpSync(wamSdkParamMgrDistPath, wamSdkParamMgrDistDest);
const wamSdkParamMgrDts = `export * from "@webaudiomodules/sdk-parammgr";\n`;
fs.writeFileSync(path.join(wamSdkParamMgrDistDest, "index.d.ts"), wamSdkParamMgrDts);

console.log("WAM SDK-ParamMgr files copied.")

const wamSdkDistPath = path.join(__dirname, "./node_modules/@webaudiomodules/sdk/dist");
const wamSdkDistDest = path.join(__dirname, "./assets/wam2/sdk");

try {
    rmSync(wamSdkDistDest);
} catch (e) {
    console.warn(e);
}
try {
    fs.mkdirSync(wamSdkDistDest);
} catch (e) {
    console.warn(e);
}

cpSync(wamSdkDistPath, wamSdkDistDest);
const wamSdkDts = `export * from "@webaudiomodules/sdk";\n`;
fs.writeFileSync(path.join(wamSdkDistDest, "index.d.ts"), wamSdkDts);

console.log("WAM SDK files copied.")

const faustUiDistPath = path.join(__dirname, "./node_modules/@shren/faust-ui/dist/esm");
const faustUiDistDest = path.join(__dirname, "./assets/wam2/faust-ui");
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
