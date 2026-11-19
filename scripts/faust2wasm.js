#!/usr/bin/env node
//@ts-check
import * as process from "process";
import faust2wasmFiles from "../src/faust2wasmFiles.js";
import { copyWebStandaloneAssets, copyWebPWAAssets, copyWebTemplateAssets, copyWebRemoteAssets } from "../src/copyWebStandaloneAssets.js";

const argv = process.argv.slice(2);

if (argv.includes("-help") || argv.includes("-h")) {
    console.log(`
faust2wasm.js <file.dsp> <outputDir> [-poly] [-standalone] [-pwa] [-remote] [-no-template]
Generates WebAssembly and metadata JSON files of a given Faust DSP.
-remote writes a host page and, in remote/, a remote control PWA that drives
it over WebRTC; serve <outputDir> with faust-remote-server-ts.
`);
    process.exit();
}

const takeFlag = (flag) => {
    const index = argv.indexOf(flag);
    if (index === -1) return false;
    argv.splice(index, 1);
    return true;
};
const poly = takeFlag("-poly");
const standalone = takeFlag("-standalone");
const pwa = takeFlag("-pwa");
const remote = takeFlag("-remote");
const noTemplate = takeFlag("-no-template");

// Allow Faust flags (like -I) anywhere while keeping the first two positionals as input/output.
const positionals = [];
const argvFaust = [];
for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "-I" && argv[i + 1]) {
        argvFaust.push(arg, argv[i + 1]);
        i += 1;
        continue;
    }
    if (positionals.length < 2 && !arg.startsWith("-")) {
        positionals.push(arg);
        continue;
    }
    argvFaust.push(arg);
}
const [inputFile, outputDir] = positionals;
if (!inputFile || !outputDir) {
    throw new Error("Usage: faust2wasm.js <file.dsp> <outputDir> [faust args...]");
}
const fileName = inputFile.split('/').pop();
if (!fileName) throw new Error("No input DSP file");
const dspName = fileName.replace(/\.dsp$/, '');

(async () => {
    const { dspMeta, effectMeta } = await faust2wasmFiles(inputFile, outputDir, argvFaust, poly);
    if (standalone) {
        copyWebStandaloneAssets(outputDir, dspName, poly, !!effectMeta);
    } else if (pwa) {
        copyWebPWAAssets(outputDir, dspName, poly, !!effectMeta);
    } else if (remote) {
        copyWebRemoteAssets(outputDir, dspName, poly, !!effectMeta);
        console.log(`Serve it with: npx faust-remote-server-ts ${outputDir} [-cert <file.pem> -key <file.pem>]`);
    } else if (!noTemplate) {
        copyWebTemplateAssets(outputDir, dspName, poly, !!effectMeta);
    }
})();
