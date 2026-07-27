#!/usr/bin/env node
//@ts-check
import * as process from "process";
import faust2svgFiles from "../src/faust2svgFiles.js";

const argv = process.argv.slice(2);

if (argv[0] === "-help" || argv[0] === "-h") {
    console.log(`
faust2svg.js <file.dsp> <outputDir> [faust args...]
Generates diagram SVGs of a given Faust DSP.

Options:
  --rust              Use the raw Rust compiler module instead of Emscripten.
  --rust-wasm <file>  Path to libfaust-rs.wasm (default: /Users/letz/Developpements/RUST/faust-rs/target/wasm32-unknown-unknown/release/libfaust-rs.wasm).
  -help | -h          Show this help.
`);
    process.exit();
}

let rust = false;
let rustWasm;
const filtered = [];
for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--rust") {
        rust = true;
    } else if (argv[i] === "--rust-wasm" && argv[i + 1]) {
        rustWasm = argv[++i];
    } else {
        filtered.push(argv[i]);
    }
}

const [inputFile, outputDir, ...argvFaust] = filtered;

faust2svgFiles(inputFile, outputDir, argvFaust, { rust, rustWasm });
