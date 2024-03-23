#!/usr/bin/env node
//@ts-check
import * as process from "process";
import faust2cmajor from "../src/faust2cmajorFiles.js";

const argv = process.argv.slice(2);

if (argv[0] === "-help" || argv[0] === "-h") {
    console.log(`
faust2cmajor.js <file.dsp> <outputDir>
Compile a given Faust DSP to a Cmajor file.
`);
    process.exit();
}

const [inputFile, outputDir, ...argvFaust] = argv;

faust2cmajor(inputFile, outputDir, argvFaust);
