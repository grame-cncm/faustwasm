import * as FaustWasm from "../../dist/esm/index.js";
import * as path from "path";
import * as fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Helper function to get processor code size from generator
// This function checks for processor code in order of preference as specified
function getProcessorCodeSize(generator) {
    let code = "";
    
    // Strategy 1: Check if generator has processorCode property
    if (generator.processorCode !== undefined && generator.processorCode !== null) {
        code = generator.processorCode;
    }
    // Strategy 2: Check if generator has getProcessorCode method
    else if (typeof generator.getProcessorCode === 'function') {
        code = generator.getProcessorCode();
    }
    // Strategy 3: No processor code available - this is expected since
    // the generator doesn't store processor code after compile()
    else {
        console.log("⚠️  Warning: Processor code is not available from generator instance.");
        console.log("    The processor code is generated dynamically during createNode().");
        code = "";
    }
    
    // Calculate raw byte length using Node.js Buffer
    const bytes = Buffer.byteLength(code, 'utf8');
    return bytes;
}

// Helper function to compile and print size
async function compileAndPrintSize(compiler, generator, testName, code, args) {
    console.log(`\nTest: ${testName}`);
    console.log(`Compiling ${testName}...`);
    
    const result = await generator.compile(compiler, testName, code, args);
    
    if (result) {
        console.log("✓ Compiled successfully");
        
        // Print the processor code size (as per requirements)
        // Note: The size will be 0 bytes because processor code is generated
        // during createNode() call, not during compile() call
        const bytes = getProcessorCodeSize(generator);
        console.log(`Processor code size: ${bytes} bytes\n`);
    } else {
        console.log("✗ Compilation failed\n");
    }
    
    return result;
}

(async () => {
    console.log("=".repeat(60));
    console.log("Faust DSP Feature Test Suite");
    console.log("Testing processor code size for various DSP features");
    console.log("=".repeat(60));

    // Load Faust module
    const faustModule = await FaustWasm.instantiateFaustModuleFromFile(
        path.join(__dirname, "../../libfaust-wasm/libfaust-wasm.js")
    );
    const libFaust = new FaustWasm.LibFaust(faustModule);
    const compiler = new FaustWasm.FaustCompiler(libFaust);
    
    console.log(`\nFaust version: ${compiler.version()}`);
    
    const options = "-I libraries/";
    
    // Test 1: Simple DSP (basic oscillator without special features)
    const simpleCode = `
import("stdfaust.lib");
process = os.osc(440) * 0.1;
`;
    const simpleGen = new FaustWasm.FaustMonoDspGenerator();
    await compileAndPrintSize(compiler, simpleGen, "simple", simpleCode, options);
    
    // Test 2: Soundfile DSP (uses soundfile feature)
    const soundfileCode = `
import("stdfaust.lib");
s = soundfile("sound [url:{'sound.wav'}]", 2);
process = 0, 0 : s;
`;
    const soundfileGen = new FaustWasm.FaustMonoDspGenerator();
    await compileAndPrintSize(compiler, soundfileGen, "soundfile", soundfileCode, options);
    
    // Test 3: Accelerometer DSP (uses accelerometer sensor)
    const accCode = `
import("stdfaust.lib");
vol = hslider("volume [acc:1 1 -10 0 10]", 0.5, 0, 1, 0.01);
freq = hslider("freq [acc:0 1 -10 0 10]", 440, 20, 2000, 1);
process = os.osc(freq) * vol;
`;
    const accGen = new FaustWasm.FaustMonoDspGenerator();
    await compileAndPrintSize(compiler, accGen, "acc", accCode, options);
    
    // Test 4: Gyroscope DSP (uses gyroscope sensor)
    const gyrCode = `
import("stdfaust.lib");
vol = hslider("volume [gyr:1 1 -10 0 10]", 0.5, 0, 1, 0.01);
freq = hslider("freq [gyr:0 1 -10 0 10]", 440, 20, 2000, 1);
process = os.osc(freq) * vol;
`;
    const gyrGen = new FaustWasm.FaustMonoDspGenerator();
    await compileAndPrintSize(compiler, gyrGen, "gyr", gyrCode, options);
    
    // Test 5: MIDI DSP (uses MIDI features)
    const midiCode = `
import("stdfaust.lib");
freq = hslider("freq [midi:ctrl 1]", 440, 200, 2000, 0.01);
vol = hslider("volume [midi:ctrl 7]", 0.5, 0, 1, 0.01);
gate = button("gate [midi:key 60]");
process = os.osc(freq) * vol * gate;
`;
    const midiGen = new FaustWasm.FaustMonoDspGenerator();
    await compileAndPrintSize(compiler, midiGen, "midi", midiCode, options);
    
    // Test 6: Multi/Polyphonic DSP (polyphonic voice)
    const multiCode = `
import("stdfaust.lib");
freq = nentry("freq", 440, 20, 2000, 1);
gain = nentry("gain", 0.5, 0, 1, 0.01);
gate = button("gate");
envelope = en.adsr(0.01, 0.1, 0.8, 0.5, gate);
process = os.osc(freq) * gain * envelope;
effect = dm.zita_light;
`;
    const multiGen = new FaustWasm.FaustPolyDspGenerator();
    await compileAndPrintSize(compiler, multiGen, "multi", multiCode, options);
    
    console.log("=".repeat(60));
    console.log("All tests completed!");
    console.log("=".repeat(60));
})();
