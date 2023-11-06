#!/usr/bin/env node
//@ts-check
import * as process from "process";
import faust2wavFiles from "../src/faust2wavFiles.js";

const argv = process.argv.slice(2);

if (argv[0] === "-help" || argv[0] === "-h") {
    console.log(`
faust2sndfile.js <file.dsp> <outputWav.wav>
Generates audio file from a Faust DSP.
\t -bs\t <num> to setup the rendering buffer size in frames (default: 64)
\t -bd\t 16|24|32 to setup the output file bit-depth (default: 16)
\t -c \t <samples> to setup the output file length in frames, when -ct is not used (default: SR*5)
\t -in\t <inputWav.wav> specify an input file to process
\t -sr\t <num> to setup the output file sample rate (default: 44100)
`);
    process.exit();
}

const $in = argv.indexOf("-in");
/** @type {string} */let inputWav;
if ($in !== -1) [, inputWav] = argv.splice($in, 2);

const $bs = argv.indexOf("-bs");
/** @type {number} */let bufferSize;
if ($bs !== -1) bufferSize = +argv.splice($bs, 2)[1];

const $bd = argv.indexOf("-bd");
/** @type {number} */let bitDepth;
if ($bd !== -1) bitDepth = +argv.splice($bd, 2)[1];

const $c = argv.indexOf("-c");
/** @type {number} */let samples;
if ($c !== -1) samples = +argv.splice($c, 2)[1];

const $sr = argv.indexOf("-sr");
/** @type {number} */let sampleRate;
if ($sr !== -1) sampleRate = +argv.splice($sr, 2)[1];

const [inputFile, outputWav, ...argvFaust] = argv;


faust2wavFiles(inputFile, inputWav, outputWav, bufferSize, sampleRate, samples, bitDepth, argvFaust);
