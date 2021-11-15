//@ts-check
const path = require("path");
const fs = require("fs");
/** @type {import("../dist")} */
const {
    instantiateLibFaust,
    Faust
} = require(path.join(__dirname, "../dist"));

/**
 * @param {string} inputFile
 * @param {string} outputDir
 * @param {string[]} [argv]
 * @param {boolean} [poly]
 */
const faust2wasmFiles = async (inputFile, outputDir, argv = [], poly = false) => {
    const libFaustPath = path.join(__dirname, "../libfaust-wasm/libfaust-wasm.js");
    const libFaust = await instantiateLibFaust(libFaustPath);
    const faust = new Faust(libFaust);
    console.log(`Faust Compiler version: ${faust.version}`);
    console.log(`Reading file ${inputFile}`);
    const code = fs.readFileSync(inputFile, { encoding: "utf8" });

    if (!argv.find(a => a === "-I")) argv.push("-I", "libraries/");
    const dsp = await faust.compile(code, argv, !poly);

    const dspModulePath = path.join(outputDir, "dspModule.wasm");
    const dspMetaPath = path.join(outputDir, "dspMeta.json");
    const effectModulePath = path.join(outputDir, "effectModule.wasm");
    const effectMetaPath = path.join(outputDir, "effectMeta.json");
    const { mainCode, mainMeta, effectCode, effectMeta } = dsp;

    const { wasmCModule: dspModule } = mainCode;
    const files = [dspModulePath, dspMetaPath];
    if (effectCode) files.push(effectModulePath, effectMetaPath);

    console.log(`Writing files to ${outputDir}`);
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir);
    for (const filePath in files) {
        if (fs.existsSync(filePath)) fs.rmSync(filePath);
    }
    fs.writeFileSync(dspModulePath, dspModule);
    fs.writeFileSync(dspMetaPath, JSON.stringify(mainMeta, null, 4));
    if (effectCode) {
        const { wasmCModule: effectModule } = effectCode;
        fs.writeFileSync(effectModulePath, effectModule);
        fs.writeFileSync(effectMetaPath, JSON.stringify(effectMeta, null, 4));
    }
    return dsp;
};

module.exports = { default: faust2wasmFiles };
