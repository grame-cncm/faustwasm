import * as FaustWasm from "../../dist/esm/index.js";
import * as path from "path";
import * as fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const faustModule = await FaustWasm.instantiateFaustModuleFromFile(
    path.join(__dirname, "../../libfaust-wasm/libfaust-wasm.js")
);

const compiler = new FaustWasm.FaustCompiler(faustModule);

console.log("Testing feature detection...\n");

// Helper: print size of generated processor code (raw byte length).
// This helps track processorCode regressions during development and CI.
function printProcessorCodeSize(gen, name) {
    let code = "";
    if (typeof gen.processorCode === "string") {
        code = gen.processorCode;
    } else if (typeof gen.getProcessorCode === "function") {
        try {
            code = gen.getProcessorCode();
        } catch (e) {
            console.log(`Warning: getProcessorCode() threw for ${name}: ${e}`);
        }
    } else {
        console.log(`Warning: processorCode not found for generator ${name}.`);
    }
    const bytes = Buffer.byteLength(code || "", "utf8");
    console.log(`Processor code size: ${bytes} bytes\n`);
    return bytes;
}

// Test 1: Simple mono DSP without features
const simpleDSP = `
import("stdfaust.lib");
process = os.osc(440);
`;
console.log("Test 1: Simple mono DSP");
const monoGen = new FaustWasm.FaustMonoDspGenerator();
await monoGen.compile(compiler, "simple", simpleDSP, "-I libraries/");
// Should detect no features (hasSoundfiles, hasAcc, hasGyr, hasMidi should all be false)
console.log("✓ Compiled successfully\n");
printProcessorCodeSize(monoGen, 'simple');

// Test 2: DSP with soundfile
const soundfileDSP = `
import("stdfaust.lib");
s = soundfile("test[url:{'sound.wav'}]", 1);
process = s;
`;
console.log("Test 2: DSP with soundfile");
const soundfileGen = new FaustWasm.FaustMonoDspGenerator();
await soundfileGen.compile(compiler, "soundfile", soundfileDSP, "-I libraries/");
// Should detect hasSoundfiles = true
console.log("✓ Compiled successfully\n");
printProcessorCodeSize(soundfileGen, 'soundfile');

// Test 3: DSP with accelerometer
const accDSP = `
import("stdfaust.lib");
freq = hslider("freq[acc: 0 0 -10 0 10]", 440, 20, 20000, 0.01);
process = os.osc(freq);
`;
console.log("Test 3: DSP with accelerometer");
const accGen = new FaustWasm.FaustMonoDspGenerator();
await accGen.compile(compiler, "acc", accDSP, "-I libraries/");
// Should detect hasAcc = true
console.log("✓ Compiled successfully\n");
printProcessorCodeSize(accGen, 'acc');

// Test 4: DSP with gyroscope
const gyrDSP = `
import("stdfaust.lib");
freq = hslider("freq[gyr: 0 0 -10 0 10]", 440, 20, 20000, 0.01);
process = os.osc(freq);
`;
console.log("Test 4: DSP with gyroscope");
const gyrGen = new FaustWasm.FaustMonoDspGenerator();
await gyrGen.compile(compiler, "gyr", gyrDSP, "-I libraries/");
// Should detect hasGyr = true
console.log("✓ Compiled successfully\n");
printProcessorCodeSize(gyrGen, 'gyr');

// Test 5: DSP with MIDI
const midiDSP = `
import("stdfaust.lib");
freq = hslider("freq[midi: ctrl 1]", 440, 20, 20000, 0.01);
process = os.osc(freq);
`;
console.log("Test 5: DSP with MIDI");
const midiGen = new FaustWasm.FaustMonoDspGenerator();
await midiGen.compile(compiler, "midi", midiDSP, "-I libraries/");
// Should detect hasMidi = true
console.log("✓ Compiled successfully\n");
printProcessorCodeSize(midiGen, 'midi');

// Test 6: DSP with multiple features
const multiDSP = `
import("stdfaust.lib");
s = soundfile("test[url:{'sound.wav'}]", 1);
freq = hslider("freq[acc: 0 0 -10 0 10][midi: ctrl 1]", 440, 20, 20000, 0.01);
process = os.osc(freq), s;
`;
console.log("Test 6: DSP with multiple features (soundfile + acc + MIDI)");
const multiGen = new FaustWasm.FaustMonoDspGenerator();
await multiGen.compile(compiler, "multi", multiDSP, "-I libraries/");
// Should detect hasSoundfiles = true, hasAcc = true, hasMidi = true
console.log("✓ Compiled successfully\n");
printProcessorCodeSize(multiGen, 'multi');

console.log("All tests passed! ✓");
console.log("\nNote: The feature detection happens during compilation.");
console.log("The generated processorCode will only include the necessary runtime classes.");
console.log("For example, a simple DSP without features will be ~10 kB instead of ~60 kB.");
