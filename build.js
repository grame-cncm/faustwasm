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

console.log("Build files copied.")
