/**
 * Faust DSP Feature Test Suite
 *
 * Compiles a set of mono and poly DSP snippets with different feature mixes,
 * builds the processor code via createNode() (using Web Audio stubs in Node),
 * and reports processor code sizes for:
 *   - optimized (feature-detected)
 *   - unoptimized (all features enabled)
 * along with their ratio.
 *
 * Tests:
 *   Mono:  simple, soundfile, acc, gyr, midi
 *   Poly:  multi, multi_soundfile, multi_acc, multi_gyr,
 *          multi_acc_gyr, multi_acc_gyr_sound
 *
 * Purpose: Track the impact of feature-based tree‑shaking on generated
 * processor code size in CI and local development.
 */

import * as path from "path";
import * as fs from "fs";
import { fileURLToPath } from "url";

// Minimal Web Audio stubs to allow createNode() to run in Node and capture processor code
const navigatorStub = { userAgent: "node" };
const navigatorValue =
    typeof globalThis.navigator === "undefined"
        ? navigatorStub
        : globalThis.navigator;
if (typeof globalThis.navigator === "undefined") {
    globalThis.navigator = navigatorValue;
}
globalThis.location = globalThis.location || { href: "file://" };
if (!globalThis.location.href) {
    globalThis.location.href = "file://";
}
globalThis.window = globalThis.window || { navigator: navigatorValue };

let lastWorkletBlob = null;
let capturedProcessorCode = "";
const OriginalCreateObjectURL = URL.createObjectURL;

class AudioWorkletNodeStub {
    constructor(context, name, options = {}) {
        this.context = context;
        this.name = name;
        this.options = options;
        this.port = {
            postMessage: () => {},
            addEventListener: () => {},
            start: () => {},
            close: () => {}
        };
    }
}

globalThis.AudioWorkletNode =
    globalThis.AudioWorkletNode || AudioWorkletNodeStub;

URL.createObjectURL = (blob) => {
    lastWorkletBlob = blob;
    capturedProcessorCode = "";
    return "blob:faustwasm-test";
};

function createFakeAudioContext() {
    return {
        sampleRate: 44100,
        audioWorklet: {
            addModule: async () => {
                if (lastWorkletBlob) {
                    capturedProcessorCode = await lastWorkletBlob.text();
                }
            }
        }
    };
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Ensure we have a tiny local WAV to exercise soundfile support without external assets.
function ensureTestWav(filePath) {
    if (fs.existsSync(filePath)) return;
    const sampleRate = 44100;
    const samples = sampleRate / 10; // 0.1s of silence
    const numChannels = 1;
    const bytesPerSample = 2;
    const blockAlign = numChannels * bytesPerSample;
    const byteRate = sampleRate * blockAlign;
    const dataSize = samples * blockAlign;
    const buffer = Buffer.alloc(44 + dataSize);
    buffer.write("RIFF", 0);
    buffer.writeUInt32LE(36 + dataSize, 4);
    buffer.write("WAVE", 8);
    buffer.write("fmt ", 12);
    buffer.writeUInt32LE(16, 16); // PCM header size
    buffer.writeUInt16LE(1, 20); // PCM format
    buffer.writeUInt16LE(numChannels, 22);
    buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE(byteRate, 28);
    buffer.writeUInt16LE(blockAlign, 32);
    buffer.writeUInt16LE(bytesPerSample * 8, 34);
    buffer.write("data", 36);
    buffer.writeUInt32LE(dataSize, 40);
    buffer.fill(0, 44); // silence payload
    fs.writeFileSync(filePath, buffer);
}

const soundfilePath = path.join(__dirname, "sound.wav");
ensureTestWav(soundfilePath);
const soundfileUrl = `file://${soundfilePath.replace(/\\/g, "/")}`;

(async () => {
    const FaustWasm = await import("../../dist/esm/index.js");
    if (FaustWasm.SoundfileReader?.loadSoundfiles) {
        FaustWasm.SoundfileReader.loadSoundfiles = async () => ({});
    }

    console.log("=".repeat(60));
    console.log("Faust DSP Feature Test Suite");
    console.log("Testing processor code size for various DSP features");
    console.log("=".repeat(60));

    // Helper: get processor code size from generator (or captured blob)
    function getProcessorCodeSize(generator) {
        let code = "";
        if (generator.processorCode !== undefined && generator.processorCode !== null) {
            code = generator.processorCode;
        } else if (typeof generator.getProcessorCode === "function") {
            try {
                code = generator.getProcessorCode();
            } catch (e) {
                console.log(
                    `⚠️  Warning: getProcessorCode() threw for ${generator?.name || "generator"}: ${e}`
                );
            }
        } else {
            code = capturedProcessorCode || "";
            if (!code) {
                console.log(
                    "⚠️  Warning: Processor code is not available from generator instance."
                );
                console.log(
                    "    The processor code is generated dynamically during createNode()."
                );
            }
        }
        return Buffer.byteLength(code || "", "utf8");
    }

    // Helper: capture processor code size by running createNode() with optional feature override
    async function captureProcessorSize(generator, testName, detectOverride) {
        const originalDetect = FaustWasm.FaustBaseWebAudioDsp.detectFeatures;
        if (detectOverride) {
            FaustWasm.FaustBaseWebAudioDsp.detectFeatures = detectOverride;
        }
        capturedProcessorCode = "";
        lastWorkletBlob = null;
        const fakeContext = createFakeAudioContext();
        try {
            await generator.createNode(fakeContext, testName);
        } catch (e) {
            console.log(`⚠️  Warning: createNode() failed for ${testName}: ${e}`);
        } finally {
            FaustWasm.FaustBaseWebAudioDsp.detectFeatures = originalDetect;
        }
        return getProcessorCodeSize(generator);
    }

    // Helper: compile a DSP and print processor code sizes (optimized vs unoptimized)
    async function compileAndPrintSize(compiler, generator, testName, code, args) {
        console.log(`\nTest: ${testName}`);
        console.log(`Compiling ${testName}...`);

        const result = await generator.compile(compiler, testName, code, args);

        if (result) {
            console.log("✓ Compiled successfully");
            const optimizedBytes = await captureProcessorSize(generator, testName);
            const unoptimizedBytes = await captureProcessorSize(
                generator,
                `${testName}_full`,
                () => ({
                    hasMidi: true,
                    hasAcc: true,
                    hasGyr: true,
                    hasSoundfiles: true,
                    hasPoly: true
                })
            );
            console.log(
                `Processor code size (optimized): ${optimizedBytes} bytes`
            );
            console.log(
                `Processor code size (unoptimized/all features): ${unoptimizedBytes} bytes\n`
            );
            if (optimizedBytes > 0) {
                const ratio = (unoptimizedBytes / optimizedBytes).toFixed(2);
                console.log(
                    `Size ratio (unoptimized / optimized): ${ratio}x\n`
                );
            }
        } else {
            console.log("✗ Compilation failed\n");
        }

        return result;
    }

    // Load Faust module
    const savedWindow = globalThis.window;
    globalThis.window = undefined;
    const faustModule = await FaustWasm.instantiateFaustModuleFromFile(
        path.join(__dirname, "../../libfaust-wasm/libfaust-wasm.js")
    );
    globalThis.window = savedWindow;
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
import("soundfiles.lib");
s = soundfile("sound [url:{'${soundfileUrl}'}]", 1);
process = so.sound(s, 0).loop;
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

    // Test 7: Polyphonic DSP with soundfile
    const multiSoundfileCode = `
import("stdfaust.lib");
import("soundfiles.lib");
freq = nentry("freq", 440, 20, 2000, 1);
gain = nentry("gain", 0.5, 0, 1, 0.01);
gate = button("gate");
envelope = en.adsr(0.01, 0.1, 0.8, 0.5, gate);
s = soundfile("sound [url:{'${soundfileUrl}'}]", 1);
process = os.osc(freq) * gain * envelope, so.sound(s, 0).loop;
effect = dm.zita_light;
`;
    const multiSoundfileGen = new FaustWasm.FaustPolyDspGenerator();
    await compileAndPrintSize(
        compiler,
        multiSoundfileGen,
        "multi_soundfile",
        multiSoundfileCode,
        options
    );

    // Test 8: Polyphonic DSP with accelerometer
    const multiAccCode = `
import("stdfaust.lib");
freq = hslider("freq [acc:0 1 -10 0 10]", 440, 20, 2000, 1);
gain = nentry("gain", 0.5, 0, 1, 0.01);
gate = button("gate");
envelope = en.adsr(0.01, 0.1, 0.8, 0.5, gate);
process = os.osc(freq) * gain * envelope;
effect = dm.zita_light;
`;
    const multiAccGen = new FaustWasm.FaustPolyDspGenerator();
    await compileAndPrintSize(compiler, multiAccGen, "multi_acc", multiAccCode, options);

    // Test 9: Polyphonic DSP with gyroscope
    const multiGyrCode = `
import("stdfaust.lib");
freq = hslider("freq [gyr:0 1 -10 0 10]", 440, 20, 2000, 1);
gain = nentry("gain", 0.5, 0, 1, 0.01);
gate = button("gate");
envelope = en.adsr(0.01, 0.1, 0.8, 0.5, gate);
process = os.osc(freq) * gain * envelope;
effect = dm.zita_light;
`;
    const multiGyrGen = new FaustWasm.FaustPolyDspGenerator();
    await compileAndPrintSize(compiler, multiGyrGen, "multi_gyr", multiGyrCode, options);

    // Test 10: Polyphonic DSP with gyroscope and accelerometer
    const multiAccGyrCode = `
import("stdfaust.lib");
freq = hslider("freq [acc:0 1 -10 0 10][gyr:0 1 -10 0 10]", 440, 20, 2000, 1);
gain = nentry("gain", 0.5, 0, 1, 0.01);
gate = button("gate");
envelope = en.adsr(0.01, 0.1, 0.8, 0.5, gate);
process = os.osc(freq) * gain * envelope;
effect = dm.zita_light;
`;
    const multiAccGyrGen = new FaustWasm.FaustPolyDspGenerator();
    await compileAndPrintSize(
        compiler,
        multiAccGyrGen,
        "multi_acc_gyr",
        multiAccGyrCode,
        options
    );

    // Test 11: Polyphonic DSP with gyroscope, accelerometer, and soundfile
    const multiAccGyrSoundCode = `
import("stdfaust.lib");
import("soundfiles.lib");
freq = hslider("freq [acc:0 1 -10 0 10][gyr:0 1 -10 0 10]", 440, 20, 2000, 1);
gain = nentry("gain", 0.5, 0, 1, 0.01);
gate = button("gate");
envelope = en.adsr(0.01, 0.1, 0.8, 0.5, gate);
s = soundfile("sound [url:{'${soundfileUrl}'}]", 1);
process = os.osc(freq) * gain * envelope, so.sound(s, 0).loop;
effect = dm.zita_light;
`;
    const multiAccGyrSoundGen = new FaustWasm.FaustPolyDspGenerator();
    await compileAndPrintSize(
        compiler,
        multiAccGyrSoundGen,
        "multi_acc_gyr_sound",
        multiAccGyrSoundCode,
        options
    );

    console.log("=".repeat(60));
    console.log("All tests completed!");
    console.log("=".repeat(60));

    URL.createObjectURL = OriginalCreateObjectURL;
})();
