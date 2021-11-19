//@ts-check
const path = require("path");
const fs = require("fs");
const process = require("process");
/** @type {import("../dist")} */
const {
    instantiateFaustModule,
    LibFaust,
    FaustCompiler,
    FaustMonoDspGenerator,
    WavDecoder,
    WavEncoder
} = require(path.join(__dirname, "../dist"));

/**
 * @param {string} inputFile
 * @param {string} inputWav
 * @param {string} outputWav
 * @param {number} bufferSize
 * @param {number} sampleRate
 * @param {number} samples
 * @param {number} bitDepth
 * @param {string[]} [argv]
 */
const faust2wavFiles = async (inputFile, inputWav, outputWav, bufferSize = 64, sampleRate = 44100, samples = 5 * sampleRate, bitDepth = 16, argv = []) => {
    const faustModule = await instantiateFaustModule(path.join(__dirname, "../libfaust-wasm/libfaust-wasm.js"));
    const libFaust = new LibFaust(faustModule);
    const compiler = new FaustCompiler(libFaust);
    console.log(`Faust Compiler version: ${compiler.version()}`);
    console.log(`Reading file ${inputFile}`);
    const code = fs.readFileSync(inputFile, { encoding: "utf8" });
    if (!argv.find(a => a === "-I")) argv.push("-I", "libraries/");
    const gen = new FaustMonoDspGenerator();
    await gen.compile(compiler, "mydsp", code, argv.join(" "));
    const processor = await gen.createOfflineProcessor(sampleRate, bufferSize);
    if (!processor) throw Error("Processor not generated");
    /** @type {Float32Array[] | undefined} */
    let input = undefined;
    if (inputWav) {
        console.log(`Reading input wav file ${inputWav}.`);
        const inputBuffer = fs.readFileSync(inputWav).buffer;
        console.log(`Decoding...`);
        input = WavDecoder.decode(inputBuffer).channelData;
    }
    console.log(`Processing...`);
    const output = processor.render(input, samples, sample => process.stdout.write(`\r${sample} / ${samples}`));
    console.log("");
    console.log(`Decoding...`);
    const outputBuffer = WavEncoder.encode(output, { bitDepth, sampleRate });
    console.log(`Writing output wav file ${outputWav}.`);
    fs.writeFileSync(outputWav, new Uint8Array(outputBuffer));
};

module.exports = { default: faust2wavFiles };
