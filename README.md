# FaustWasm
WebAssembly version of [Faust Compiler](https://github.com/grame-cncm/faust) for [Node.js](https://nodejs.org) and web browsers, built with [Emscripten](https://emscripten.org/) 2.0.25

## Usage

Please use a stable version of [Node.js](https://nodejs.org) 16+ to work with this project.

### Use the command line interface

Clone and get into this project:
```bash
git clone https://github.com/fr0stbyter/faustwasm
cd faustwasm
```

#### Generate WebAssembly version of a Faust DSP
For example:
```bash
rm -rf test/out # make sure you are under the faustwasm directory.
node scripts/faust2wasm.js test/mono.dsp test/out
```
or
```bash
rm -rf test/out # make sure you are under the faustwasm directory.
node scripts/faust2wasm.js test/poly.dsp test/out -poly
```
You can create standalone DSP on a web page using the same command line
```bash
rm -rf test/out # make sure you are under the faustwasm directory.
node scripts/faust2wasm.js test/rev.dsp test/out -standalone
```

#### Generate SVG Diagrams of a Faust DSP
For example:
```bash
rm -rf test/out # make sure you are under the faustwasm directory.
node scripts/faust2svg.js test/mono.dsp test/out
```
The main diagram should be in `test/out/process.svg`.

#### Generate or process audio files
Options:
- `-bs     <num>` to setup the rendering buffer size in frames (default: 64)
- `-bd     16|24|32` to setup the output file bit-depth (default: 16)
- `-c      <samples>` to setup the output file length in frames, when -ct is not used (default: SR*5)
- `-in     <inputWav.wav>` specify an input file to process
- `-sr     <num>` to setup the output file sample rate (default: 44100)
See this help:

```bash
node scripts/faust2sndfile.js -h
```

For example:
```bash
rm -rf test/out # make sure you are under the faustwasm directory.
mkdir test/out
node scripts/faust2sndfile.js test/p-dj.dsp test/out/p-dj.wav -c 192000 -sr 48000 -bd 24
```
Now the `test/out/p-dj.wav` should be generated.

```bash
node scripts/faust2sndfile.js test/rev.dsp test/out/p-dj-rev.wav -c 192000 -sr 48000 -bd 24 -in test/out/p-dj.wav
```

### Use the JavaScript Module

```bash
npm i -D @shren/faustwasm
```

In JavaScript:
```JavaScript
import FaustWasm from "@shren/faustwasm";
import * as path from "path";
import * as url from "url";
import * as fs from "fs";

const {
    instantiateLibFaust,
    Faust,
    FaustProcessor,
    WavEncoder
} = FaustWasm;

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

(async () => {
    const libFaustPath = path.join(__dirname, "../node_modules/@shren/faustwasm/libfaust-wasm/libfaust-wasm.js");

    // initialize the libfaust wasm
    const libFaust = await instantiateLibFaust(libFaustPath);
    // Get the Faust compiler
    const faust = new Faust(libFaust);
    console.log(`Faust Compiler version: ${faust.version}`);
    const code = `
import("stdfaust.lib");
process = ba.pulsen(1, 10000) : pm.djembe(60, 0.3, 0.4, 1);
`;
    const args = ["-I", "libraries/"];

    // Compile the DSP
    const dsp = await faust.compile(code, args);

    // To generate SVG diagrams use `getDiagram` method.
    const svgs = faust.getDiagram(code, args);
    console.log(Object.keys(svgs));

    const sampleRate = 48000;

    // To generate audio using FaustProcessor
    const processor = new FaustProcessor({ dsp, sampleRate });
    await processor.initialize();
    const out = processor.generate(null, 192000);

    // The wav file is generated
    const wav = WavEncoder.encode(out, { sampleRate, bitDepth: 24 });
    fs.writeFileSync(`${__dirname}/out.wav`, new Uint8Array(wav));
})();
```

### Use in a web browser
```JavaScript

(async () => {
    const {
        instantiateLibFaust,
        Faust,
        FaustProcessor,
        WavEncoder
    } = await import("../node_modules/@shren/faustwasm/dist/esm/index.js");
    // initialize the libfaust wasm
    const libFaust = await instantiateLibFaust("../node_modules/@shren/faustwasm/libfaust-wasm/libfaust-wasm.js");
    // Get the Faust compiler
    const faust = new Faust(libFaust);
    window.faust = faust;
    console.log(faust.version);
    const sampleRate = 48000;
    const args = ["-I", "libraries/"];
    const code = `
import("stdfaust.lib");
process = ba.pulsen(1, 10000) : pm.djembe(60, 0.3, 0.4, 1);
`;
    // Compile the DSP
    const dsp = await faust.compile(code, args);

    // To generate SVG diagrams use `getDiagram` method.
    const svgs = faust.getDiagram(code, args);
    console.log(Object.keys(svgs));

    // To generate audio using FaustProcessor
    const processor = new FaustProcessor({ dsp, sampleRate });
    await processor.initialize();
    const out = processor.generate(null, 192000);
    const wav = WavEncoder.encode(out, { sampleRate, bitDepth: 24 });

    // The wav file is generated
    const blob = new Blob([wav], { type: "audio/wav" });
    const player = document.createElement("audio");
    player.controls = true;
    player.src = URL.createObjectURL(blob);
    document.body.appendChild(player);
})();
```


## Build

```bash
npm run build
```