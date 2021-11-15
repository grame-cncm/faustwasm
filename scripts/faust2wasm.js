//@ts-check
const process = require("process");
const { default: faust2wasmFiles } = require("../src/faust2wasmFiles.js");
const { default: faustDsp2wam2Files } = require("../src/faustDsp2wam2Files.js");

const argv = process.argv.slice(2);

if (argv[0] === "-help" || argv[0] === "-h") {
    console.log(`
faust2wasm.js <file.dsp> <outputDir> [-poly] [-wam2]
Generates WebAssembly and metadata JSON files of a given Faust DSP.
`);
    process.exit();
}

const $poly = argv.indexOf("-poly");
const poly = $poly !== -1;
if (poly) argv.splice($poly, 1);

const $wam2 = argv.indexOf("-wam2");
const wam2 = $wam2 !== -1;
if (wam2) argv.splice($wam2, 1);

const [inputFile, outputDir, ...argvFaust] = argv;

(async () => {
    const dsp = await faust2wasmFiles(inputFile, outputDir, argvFaust, poly);
    if (wam2) await faustDsp2wam2Files(dsp, outputDir, poly);
})();
