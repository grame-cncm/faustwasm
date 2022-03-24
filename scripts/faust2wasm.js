//@ts-check
import * as process from "process";
import faust2wasmFiles from "../src/faust2wasmFiles.js";
import copyWebStandaloneAssets from "../src/copyWebStandaloneAssets.js";

const argv = process.argv.slice(2);

if (argv[0] === "-help" || argv[0] === "-h") {
    console.log(`
faust2wasm.js <file.dsp> <outputDir> [-poly] [-standalone]
Generates WebAssembly and metadata JSON files of a given Faust DSP.
`);
    process.exit();
}

const $poly = argv.indexOf("-poly");
const poly = $poly !== -1;
if (poly) argv.splice($poly, 1);

const $standalone = argv.indexOf("-standalone");
const standalone = $standalone !== -1;
if (standalone) argv.splice($standalone, 1);

const [inputFile, outputDir, ...argvFaust] = argv;

(async () => {
    await faust2wasmFiles(inputFile, outputDir, argvFaust, poly);
    if (standalone) copyWebStandaloneAssets(outputDir);
})();
