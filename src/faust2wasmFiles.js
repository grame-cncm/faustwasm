//@ts-check
import * as fs from "fs";
import * as path from "path";
import {
    instantiateFaustModuleFromFile,
    LibFaust,
    FaustCompiler,
    FaustMonoDspGenerator,
    FaustPolyDspGenerator
} from "../dist/esm/index.js";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const __filename = fileURLToPath(import.meta.url);

/**
 *  Script to compile a Faust DSP file to WebAssembly and write the output to files.
 * 
 * @param {string} inputFile : The path to the Faust DSP file.
 * @param {string} outputDir : The path to the output directory.
 * @param {string[]} [argv] : An array of command-line arguments to pass to the Faust compiler.
 * @param {boolean} [poly] : Whether to compile the DSP as a polyphonic instrument.
 */
const faust2wasmFiles = async (inputFile, outputDir, argv = [], poly = false) => {
    const faustModule = await instantiateFaustModuleFromFile(path.join(__dirname, "../libfaust-wasm/libfaust-wasm.js"));
    const libFaust = new LibFaust(faustModule);
    const compiler = new FaustCompiler(libFaust);
    console.log(`Faust Compiler version: ${compiler.version()}`);
    console.log(`Reading file ${inputFile}`);
    const code = fs.readFileSync(inputFile, { encoding: "utf8" });

    const fileName = /** @type {string} */(inputFile.split('/').pop());
    const dspName = fileName.replace(/\.dsp$/, '');

    if (!argv.find(a => a === "-I")) argv.push("-I", "libraries/");
    argv.push("-ftz", "2");
    const dspModulePath = path.join(outputDir, `${dspName}.wasm`);
    const dspMetaPath = path.join(outputDir, `${dspName}.json`);
    const effectModulePath = path.join(outputDir, `${dspName}_effect.wasm`);
    const effectMetaPath = path.join(outputDir, `${dspName}_effect.json`);
    const mixerModulePath = path.join(outputDir, "mixerModule.wasm");
    /** @type {Uint8Array} */
    let dspModule;
    /** @type {import("./types").FaustDspMeta} */
    let dspMeta;
    /** @type {Uint8Array | null} */
    let effectModule = null;
    /** @type {import("./types").FaustDspMeta | null} */
    let effectMeta = null;
    /** @type {Uint8Array | null} */
    let mixerModule = null;
    const { name } = path.parse(inputFile);
    if (poly) {
        const generator = new FaustPolyDspGenerator();
        const t1 = Date.now();
        const dsp = await generator.compile(compiler, name, code, argv.join(" "));
        if (!dsp) throw new Error("Faust DSP not compiled");
        const { voiceFactory, effectFactory, mixerBuffer } = dsp;
        if (!voiceFactory) throw new Error("Faust DSP Factory not compiled");
        console.log(`Compilation successful (${Date.now() - t1} ms).`);
        dspModule = voiceFactory.code;
        dspMeta = JSON.parse(voiceFactory.json);
        mixerModule = mixerBuffer;
        if (effectFactory) {
            effectModule = effectFactory.code;
            effectMeta = JSON.parse(effectFactory.json);
        }
    } else {
        const generator = new FaustMonoDspGenerator();
        const t1 = Date.now();
        const dsp = await generator.compile(compiler, name, code, argv.join(" "));
        if (!dsp) throw new Error("Faust DSP not compiled");
        const { factory } = dsp;
        if (!factory) throw new Error("Faust DSP Factory not compiled");
        console.log(`Compilation successful (${Date.now() - t1} ms).`);
        dspModule = factory.code;
        dspMeta = JSON.parse(factory.json);
    }
    const files = [dspModulePath, dspMetaPath];
    if (mixerModule) files.push(mixerModulePath);
    if (effectModule) files.push(effectModulePath, effectMetaPath);

    console.log(`Writing files to ${outputDir}`);
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir);
    for (const filePath in files) {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }
    fs.writeFileSync(dspModulePath, dspModule);
    fs.writeFileSync(dspMetaPath, JSON.stringify(dspMeta, null, 4));
    if (effectModule && effectMeta) {
        fs.writeFileSync(effectModulePath, effectModule);
        fs.writeFileSync(effectMetaPath, JSON.stringify(effectMeta, null, 4));
    }
    if (mixerModule) fs.writeFileSync(mixerModulePath, mixerModule);
    return { dspMeta, effectMeta };
};

export default faust2wasmFiles;
