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

import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';

// -----------------------------------------------------------------------------//
// Web Audio stubs (Node context)
// -----------------------------------------------------------------------------//
// Minimal Web Audio stubs to allow createNode() to run in Node and capture processor code
const navigatorStub = { userAgent: 'node' };
const navigatorValue =
    typeof globalThis.navigator === 'undefined'
        ? navigatorStub
        : globalThis.navigator;
if (typeof globalThis.navigator === 'undefined') {
    globalThis.navigator = navigatorValue;
}
globalThis.location = globalThis.location || { href: 'file://' };
if (!globalThis.location.href) {
    globalThis.location.href = 'file://';
}
globalThis.window = globalThis.window || { navigator: navigatorValue };

let lastWorkletBlob = null;
let capturedProcessorCode = '';
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
    capturedProcessorCode = '';
    return 'blob:faustwasm-test';
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

// -----------------------------------------------------------------------------//
// Soundfile fixtures (local WAV generation/loading)
// -----------------------------------------------------------------------------//
// Always recreate a local WAV so soundfile tests stay offline and deterministic.
function ensureTestWav(filePath) {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    const sampleRate = 44100;
    const samples = 262144; // match the default length expected by soundfile runtime
    const numChannels = 1;
    const bytesPerSample = 2;
    const blockAlign = numChannels * bytesPerSample;
    const byteRate = sampleRate * blockAlign;
    const dataSize = samples * blockAlign;
    const buffer = Buffer.alloc(44 + dataSize);
    buffer.write('RIFF', 0);
    buffer.writeUInt32LE(36 + dataSize, 4);
    buffer.write('WAVE', 8);
    buffer.write('fmt ', 12);
    buffer.writeUInt32LE(16, 16); // PCM header size
    buffer.writeUInt16LE(1, 20); // PCM format
    buffer.writeUInt16LE(numChannels, 22);
    buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE(byteRate, 28);
    buffer.writeUInt16LE(blockAlign, 32);
    buffer.writeUInt16LE(bytesPerSample * 8, 34);
    buffer.write('data', 36);
    buffer.writeUInt32LE(dataSize, 40);
    // Write a ramped sine to ensure non-silence
    for (let i = 0; i < samples; i++) {
        const val = Math.sin((Math.PI * 2 * i) / samples) * 0.5;
        buffer.writeInt16LE(Math.round(val * 32767), 44 + i * 2);
    }
    fs.writeFileSync(filePath, buffer);
}

const soundfilePath = path.join(__dirname, 'sound.wav');
ensureTestWav(soundfilePath);
const soundfileUrl = `file://${soundfilePath.replace(/\\/g, '/')}`;

// Simple PCM WAV loader for local files (16/32-bit, mono/stereo), with padding to avoid wasm OOB.
function loadWav(filePath) {
    const buf = fs.readFileSync(filePath);
    if (buf.toString('ascii', 0, 4) !== 'RIFF') {
        throw new Error('Not a WAV file');
    }
    const fmtIndex = buf.indexOf('fmt ');
    const dataIndex = buf.indexOf('data');
    if (fmtIndex < 0 || dataIndex < 0) {
        throw new Error('Invalid WAV structure');
    }
    const audioFormat = buf.readUInt16LE(fmtIndex + 8);
    const numChannels = buf.readUInt16LE(fmtIndex + 10);
    const sampleRate = buf.readUInt32LE(fmtIndex + 12);
    const bitsPerSample = buf.readUInt16LE(fmtIndex + 22);
    if (audioFormat !== 1 || (bitsPerSample !== 16 && bitsPerSample !== 32)) {
        throw new Error('Only PCM 16/32-bit WAV supported');
    }
    const dataSize = buf.readUInt32LE(dataIndex + 4);
    const start = dataIndex + 8;
    const samples =
        bitsPerSample === 16
            ? new Int16Array(buf.buffer, buf.byteOffset + start, dataSize / 2)
            : new Int32Array(buf.buffer, buf.byteOffset + start, dataSize / 4);
    const denom = bitsPerSample === 16 ? 32768 : 2147483648;
    const channelData = [];
    for (let c = 0; c < numChannels; c++) {
        channelData.push(new Float32Array(samples.length / numChannels));
    }
    for (let i = 0; i < samples.length; i++) {
        const ch = i % numChannels;
        channelData[ch][Math.floor(i / numChannels)] = samples[i] / denom;
    }
    // Copy channels to detatch from Node Buffer backing store and pad generously
    const targetLen = Math.max(channelData[0].length, 600000);
    for (let c = 0; c < channelData.length; c++) {
        const copy = new Float32Array(targetLen);
        copy.set(channelData[c]);
        channelData[c] = copy;
    }
    return { audioBuffer: channelData, sampleRate };
}

// -----------------------------------------------------------------------------//
// Test runner
// -----------------------------------------------------------------------------//
(async () => {
    const FaustWasm = await import('../../dist/esm/index.js');
    if (FaustWasm.SoundfileReader) {
        FaustWasm.SoundfileReader.loadSoundfile = async (pathStr) => {
            const p = pathStr.replace(/^file:\/\//, '');
            try {
                return loadWav(p);
            } catch (e) {
                console.log(
                    `⚠️  Failed to load WAV at ${p}, returning silence: ${e}`
                );
                return {
                    audioBuffer: [new Float32Array(256)],
                    sampleRate: 44100
                };
            }
        };
        FaustWasm.SoundfileReader.loadSoundfiles = async (meta, map = {}) => {
            const result = { ...map };
            const finder = FaustWasm.SoundfileReader.findSoundfilesFromMeta;
            const needed = (finder && finder(meta)) || {};
            for (const id in needed) {
                if (!result[id]) {
                    const p = needed[id]?.path || soundfilePath;
                    try {
                        result[id] = loadWav(
                            p.startsWith('file://')
                                ? p.replace(/^file:\/\//, '')
                                : p
                        );
                    } catch {
                        result[id] = {
                            audioBuffer: [new Float32Array(256)],
                            sampleRate: 44100
                        };
                    }
                }
            }
            if (!Object.keys(result).length) {
                result['/dummy/sound.wav'] = loadWav(soundfilePath);
            }
            return result;
        };
    }

    // -------------------------------------------------------------------------//
    // Helper utilities (size capture, rendering, comparison)
    // -------------------------------------------------------------------------//
    console.log('='.repeat(60));
    console.log('Faust DSP Feature Test Suite');
    console.log('Testing processor code size for various DSP features');
    console.log('='.repeat(60));

    // Helper: get processor code size from generator (or captured blob)
    function getProcessorCodeSize(generator) {
        let code = '';
        if (
            generator.processorCode !== undefined &&
            generator.processorCode !== null
        ) {
            code = generator.processorCode;
        } else if (typeof generator.getProcessorCode === 'function') {
            try {
                code = generator.getProcessorCode();
            } catch (e) {
                console.log(
                    `⚠️  Warning: getProcessorCode() threw for ${generator?.name || 'generator'}: ${e}`
                );
            }
        } else {
            code = capturedProcessorCode || '';
            if (!code) {
                console.log(
                    '⚠️  Warning: Processor code is not available from generator instance.'
                );
                console.log(
                    '    The processor code is generated dynamically during createNode().'
                );
            }
        }
        return Buffer.byteLength(code || '', 'utf8');
    }

    // Capture processor code size by running createNode() with optional feature override.
    async function captureProcessorSize(
        generator,
        testName,
        detectOverride,
        requireSuccess = false
    ) {
        const originalDetect = FaustWasm.FaustBaseWebAudioDsp.detectFeatures;
        const sfr = FaustWasm.SoundfileReader;
        const originalLoadSoundfiles = sfr?.loadSoundfiles;
        if (detectOverride) {
            FaustWasm.FaustBaseWebAudioDsp.detectFeatures = detectOverride;
        }
        capturedProcessorCode = '';
        lastWorkletBlob = null;
        const fakeContext = createFakeAudioContext();
        try {
            const node = await generator.createNode(fakeContext, testName);
            if (!node && requireSuccess) {
                throw new Error('createNode() returned null/undefined');
            }
        } catch (e) {
            if (requireSuccess) {
                throw e;
            } else {
                console.log(
                    `⚠️  Warning: createNode() failed for ${testName}: ${e}`
                );
            }
        } finally {
            FaustWasm.FaustBaseWebAudioDsp.detectFeatures = originalDetect;
            if (sfr && originalLoadSoundfiles)
                sfr.loadSoundfiles = originalLoadSoundfiles;
        }
        return getProcessorCodeSize(generator);
    }

    // Return true if all samples are near zero (used to detect silent renders).
    function isSilent(samples, tolerance = 1e-8) {
        if (!samples) return true;
        let max = 0;
        for (const ch of samples) {
            for (let i = 0; i < ch.length; i++) {
                const v = Math.abs(ch[i]);
                if (v > max) max = v;
            }
        }
        return max <= tolerance;
    }

    // Run a short offline render for mono or poly DSP and return audio plus silence flag.
    async function renderSamples(generator, testName, detectOverride) {
        const originalDetect = FaustWasm.FaustBaseWebAudioDsp.detectFeatures;
        if (detectOverride) {
            FaustWasm.FaustBaseWebAudioDsp.detectFeatures = detectOverride;
        }
        try {
            if (generator instanceof FaustWasm.FaustMonoDspGenerator) {
                const proc = await generator.createOfflineProcessor(44100, 256);
                if (proc?.setParamValue) proc.setParamValue('gate', 1);
                try {
                    const dsp = proc?.fDSPCode;
                    if (dsp?.fInstance?.memory && dsp?.fSoundfiles?.length) {
                        const HEAP32 = new Int32Array(
                            dsp.fInstance.memory.buffer
                        );
                        const index = dsp.fSoundfiles[0]?.index || 0;
                        const basePtr = dsp.fSoundfiles[0]?.basePtr || 0;
                        const ptrIndex = (dsp.fDSP + index) >> 2;
                        const fPtr = HEAP32[ptrIndex];
                        const fLength = HEAP32[(fPtr + dsp.fPtrSize) >> 2];
                        const fSR = HEAP32[(fPtr + 2 * dsp.fPtrSize) >> 2];
                        const fOffset = HEAP32[(fPtr + 3 * dsp.fPtrSize) >> 2];
                        // Force pointer in case it was clobbered by a previous instantiation
                        if (basePtr && fPtr !== basePtr) {
                            HEAP32[ptrIndex] = basePtr;
                        }
                        console.log('Soundfile debug (mono renderSamples):', {
                            fDSP: dsp.fDSP,
                            index,
                            basePtr,
                            fPtr,
                            fLengthPtr: fLength,
                            fSRPtr: fSR,
                            fOffsetPtr: fOffset,
                            length0: HEAP32[fLength >> 2],
                            sr0: HEAP32[fSR >> 2],
                            offset0: HEAP32[fOffset >> 2],
                            buffer0: HEAP32[fPtr >> 2]
                        });
                    }
                } catch (err) {
                    console.log('Soundfile debug read failed', err);
                }
                const rendered = proc?.render(null, 256);
                if (!rendered) throw new Error('render() returned falsy');
                const samples = rendered.map((ch) => Array.from(ch));
                return { samples, silent: isSilent(samples) };
            } else {
                const proc = await generator.createOfflineProcessor(
                    44100,
                    256,
                    4
                );
                if (proc?.setParamValue) proc.setParamValue('gate', 1);
                if (proc?.keyOn) proc.keyOn(0, 60, 100);
                const rendered = proc?.render(null, 256);
                if (!rendered) throw new Error('render() returned falsy');
                const samples = rendered.map((ch) => Array.from(ch));
                return { samples, silent: isSilent(samples) };
            }
        } finally {
            FaustWasm.FaustBaseWebAudioDsp.detectFeatures = originalDetect;
        }
    }

    // Numeric comparison of two rendered buffers within tolerance.
    function compareSamples(a, b, tolerance = 1e-6) {
        if (!a || !b) return false;
        if (a.length !== b.length) return false;
        for (let c = 0; c < a.length; c++) {
            const ca = a[c];
            const cb = b[c];
            if (ca.length !== cb.length) return false;
            for (let i = 0; i < ca.length; i++) {
                if (Math.abs(ca[i] - cb[i]) > tolerance) return false;
            }
        }
        return true;
    }

    // Reload soundfile map for a generator based on its JSON meta if available.
    async function reloadSoundfiles(generator) {
        const loader = FaustWasm.SoundfileReader;
        if (!loader?.loadSoundfiles) return;
        const meta = generator.factory
            ? JSON.parse(generator.factory.json)
            : null;
        if (!meta) return;
        generator.factory.soundfiles = await loader.loadSoundfiles(
            meta,
            {},
            createFakeAudioContext()
        );
    }

    // Compile a DSP, sanity render it, and print processor code sizes (optimized vs unoptimized).
    async function compileAndPrintSize(
        compiler,
        generator,
        testName,
        code,
        args
    ) {
        console.log(`\nTest: ${testName}`);
        console.log(`Compiling ${testName}...`);

        const result = await generator.compile(compiler, testName, code, args);

        if (result) {
            console.log('✓ Compiled successfully');
            // Run a small offline render to ensure the generated code works
            const isSoundfile =
                testName.includes('soundfile') || testName.includes('sound');
            const skipAudio = false;
            if (!skipAudio) {
                try {
                    if (isSoundfile) await reloadSoundfiles(generator);
                    if (generator instanceof FaustWasm.FaustMonoDspGenerator) {
                        const proc = await generator.createOfflineProcessor(
                            44100,
                            256
                        );
                        const rendered = proc?.render(null, 512);
                        if (!rendered)
                            throw new Error('render() returned falsy');
                    } else {
                        const proc = await generator.createOfflineProcessor(
                            44100,
                            256,
                            4
                        );
                        const rendered = proc?.render(null, 512);
                        if (!rendered)
                            throw new Error('render() returned falsy');
                    }
                    console.log('✓ Offline render succeeded');
                } catch (e) {
                    console.log(
                        `✗ Offline render failed for ${testName}: ${
                            e.message || e
                        }`
                    );
                }
            } else {
                console.log(
                    'ℹ️  Audio render skipped for soundfile test in Node sandbox.'
                );
            }

            let optimizedBytes = 0;
            let optimizedSamples = null;
            let optimizedSilent = true;
            try {
                if (isSoundfile) await reloadSoundfiles(generator);
                if (isSoundfile && generator.factory?.soundfiles) {
                    console.log(
                        `Soundfile buffers before optimized createNode:`,
                        Object.entries(generator.factory.soundfiles).map(
                            ([k, v]) => ({
                                id: k,
                                channels: v.audioBuffer.length,
                                length: v.audioBuffer[0]?.length || 0,
                                sampleRate: v.sampleRate
                            })
                        )
                    );
                }
                optimizedBytes = await captureProcessorSize(
                    generator,
                    testName,
                    null,
                    true
                );
                const renderedOpt = await renderSamples(
                    generator,
                    testName,
                    null
                );
                optimizedSamples = renderedOpt.samples;
                optimizedSilent = renderedOpt.silent;
                console.log('✓ Optimized createNode() succeeded');
            } catch (e) {
                console.log(
                    `✗ Optimized createNode() failed for ${testName}: ${
                        e.stack || e
                    }`
                );
            }
            const unoptimizedBytes = await captureProcessorSize(
                generator,
                `${testName}_full`,
                () => ({
                    hasMidi: true,
                    hasAcc: true,
                    hasGyr: true,
                    hasSoundfiles: true,
                    hasPoly: true
                }),
                true
            );
            let unoptimizedSamples = null;
            let unoptimizedSilent = true;
            try {
                if (isSoundfile) await reloadSoundfiles(generator);
                if (isSoundfile && generator.factory?.soundfiles) {
                    console.log(
                        `Soundfile buffers before unoptimized createNode:`,
                        Object.entries(generator.factory.soundfiles).map(
                            ([k, v]) => ({
                                id: k,
                                channels: v.audioBuffer.length,
                                length: v.audioBuffer[0]?.length || 0,
                                sampleRate: v.sampleRate
                            })
                        )
                    );
                }
                const renderedUnopt = await renderSamples(
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
                unoptimizedSamples = renderedUnopt.samples;
                unoptimizedSilent = renderedUnopt.silent;
            } catch (e) {
                console.log(
                    `✗ Unoptimized render failed for ${testName}: ${
                        e.stack || e
                    }`
                );
            }
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
            if (optimizedSamples && unoptimizedSamples) {
                const same = compareSamples(
                    optimizedSamples,
                    unoptimizedSamples
                );
                console.log(
                    same
                        ? '✓ Audio output matches between optimized and unoptimized'
                        : '✗ Audio output differs between optimized and unoptimized'
                );
            }
            if (!optimizedSilent && !unoptimizedSilent) {
                if (optimizedSamples && unoptimizedSamples) {
                    const same = compareSamples(
                        optimizedSamples,
                        unoptimizedSamples
                    );
                    console.log(
                        same
                            ? '✓ Audio output matches between optimized and unoptimized'
                            : '✗ Audio output differs between optimized and unoptimized'
                    );
                }
            } else {
                console.log(
                    '✗ One of the renders produced silence; cannot compare audio output'
                );
            }
        } else {
            console.log('✗ Compilation failed\n');
        }

        return result;
    }

    // -------------------------------------------------------------------------//
    // Faust setup and individual test cases
    // -------------------------------------------------------------------------//
    // Load Faust module
    const savedWindow = globalThis.window;
    globalThis.window = undefined;
    const faustModule = await FaustWasm.instantiateFaustModuleFromFile(
        path.join(__dirname, '../../libfaust-wasm/libfaust-wasm.js')
    );
    globalThis.window = savedWindow;
    const libFaust = new FaustWasm.LibFaust(faustModule);
    const compiler = new FaustWasm.FaustCompiler(libFaust);

    console.log(`\nFaust version: ${compiler.version()}`);

    const options = '-I libraries/';

    // Test 1: Simple DSP (basic oscillator without special features)
    const simpleCode = `
import("stdfaust.lib");
process = os.osc(440) * 0.1;
`;
    const simpleGen = new FaustWasm.FaustMonoDspGenerator();
    await compileAndPrintSize(
        compiler,
        simpleGen,
        'simple',
        simpleCode,
        options
    );

    // Test 2: Soundfile DSP (uses soundfile feature)
    const soundfileCode = `
import("stdfaust.lib");
import("soundfiles.lib");
s = soundfile("sound [url:{'${soundfileUrl}'}]", 1);
process = so.sound(s, 0).loop;
`;
    const soundfileGen = new FaustWasm.FaustMonoDspGenerator();
    await compileAndPrintSize(
        compiler,
        soundfileGen,
        'soundfile',
        soundfileCode,
        options
    );

    // Test 3: Accelerometer DSP (uses accelerometer sensor)
    const accCode = `
import("stdfaust.lib");
vol = hslider("volume [acc:1 1 -10 0 10]", 0.5, 0, 1, 0.01);
freq = hslider("freq [acc:0 1 -10 0 10]", 440, 20, 2000, 1);
process = os.osc(freq) * vol;
`;
    const accGen = new FaustWasm.FaustMonoDspGenerator();
    await compileAndPrintSize(compiler, accGen, 'acc', accCode, options);

    // Test 4: Gyroscope DSP (uses gyroscope sensor)
    const gyrCode = `
import("stdfaust.lib");
vol = hslider("volume [gyr:1 1 -10 0 10]", 0.5, 0, 1, 0.01);
freq = hslider("freq [gyr:0 1 -10 0 10]", 440, 20, 2000, 1);
process = os.osc(freq) * vol;
`;
    const gyrGen = new FaustWasm.FaustMonoDspGenerator();
    await compileAndPrintSize(compiler, gyrGen, 'gyr', gyrCode, options);

    // Test 5: MIDI DSP (uses MIDI features)
    const midiCode = `
import("stdfaust.lib");
freq = hslider("freq [midi:ctrl 1]", 440, 200, 2000, 0.01);
vol = hslider("volume [midi:ctrl 7]", 0.5, 0, 1, 0.01);
gate = button("gate [midi:key 60]");
process = os.osc(freq) * vol * gate;
`;
    const midiGen = new FaustWasm.FaustMonoDspGenerator();
    await compileAndPrintSize(compiler, midiGen, 'midi', midiCode, options);

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
    await compileAndPrintSize(compiler, multiGen, 'multi', multiCode, options);

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
        'multi_soundfile',
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
    await compileAndPrintSize(
        compiler,
        multiAccGen,
        'multi_acc',
        multiAccCode,
        options
    );

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
    await compileAndPrintSize(
        compiler,
        multiGyrGen,
        'multi_gyr',
        multiGyrCode,
        options
    );

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
        'multi_acc_gyr',
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
        'multi_acc_gyr_sound',
        multiAccGyrSoundCode,
        options
    );

    console.log('='.repeat(60));
    console.log('All tests completed!');
    console.log('='.repeat(60));

    URL.createObjectURL = OriginalCreateObjectURL;
})();
