/**
 * The three CLIs beside `faust2wasm.js`: SVG diagrams, Cmajor, audio files.
 *
 * They are thinner than `faust2wasm.js` -- each one compiles and writes a
 * single kind of output -- so what is worth checking is that the output is
 * really that kind of thing, and that the options which shape it are honoured.
 * For `faust2sndfile` in particular, `-sr`, `-bd` and `-c` are claims about the
 * bytes of the WAV header, so that is where they are read back from.
 *
 * These three scripts share the CLI conventions of `faust2wasm.js` but not its
 * argument parser: they take the input and output as the first two positional
 * arguments and pass the rest to the Faust compiler.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
    listDir,
    outDir,
    outExists,
    readOut,
    runCli,
    runCliOk,
    wavInfo
} from './runner.mjs';

// ---------------------------------------------------------------- faust2svg

test('faust2svg -h prints the usage and succeeds', () => {
    const { status, stdout } = runCli('faust2svg', ['-h']);
    assert.equal(status, 0);
    assert.match(stdout, /faust2svg\.js <file\.dsp> <outputDir>/);
});

test('faust2svg writes a process diagram', () => {
    const dir = outDir('svg-mono');
    runCliOk('faust2svg', ['test/mono.dsp', dir]);
    // Whatever else a DSP expands to, process.svg is the entry point and the
    // one file the README points at.
    assert.ok(outExists(dir, 'process.svg'));
    const svg = readOut(dir, 'process.svg');
    assert.match(svg, /<svg/);
    assert.match(svg, /<\/svg>/);
});

test('faust2svg writes one file per subdiagram', () => {
    const dir = outDir('svg-subdiagrams');
    runCliOk('faust2svg', ['test/mono.dsp', dir]);
    const files = listDir(dir);
    // Names of nested blocks carry a compiler-assigned address, so only their
    // extension and the presence of process.svg can be asserted.
    assert.ok(files.length > 1, 'expected subdiagrams beside process.svg');
    assert.ok(files.every((name) => name.endsWith('.svg')));
    for (const file of files) assert.match(readOut(dir, file), /<svg/);
});

test('faust2svg handles a DSP with an effect and many blocks', () => {
    const dir = outDir('svg-rev');
    runCliOk('faust2svg', ['test/rev.dsp', dir]);
    assert.ok(outExists(dir, 'process.svg'));
});

test('faust2svg creates a nested output directory', () => {
    const dir = path.join(outDir('svg-nested'), 'a', 'b');
    runCliOk('faust2svg', ['test/mono.dsp', dir]);
    assert.ok(outExists(dir, 'process.svg'));
});

test('faust2svg fails on a DSP that does not compile', () => {
    const dir = outDir('svg-bad');
    const source = path.join(dir, '..', 'svg-bad-source.dsp');
    fs.mkdirSync(path.dirname(source), { recursive: true });
    fs.writeFileSync(source, 'process = no_such_primitive;\n');
    const { status, stderr } = runCli('faust2svg', [source, dir]);
    assert.notEqual(status, 0);
    assert.match(stderr, /undefined symbol|no_such_primitive/i);
});

// ------------------------------------------------------------- faust2cmajor

test('faust2cmajor -h prints the usage and succeeds', () => {
    const { status, stdout } = runCli('faust2cmajor', ['-h']);
    assert.equal(status, 0);
    assert.match(stdout, /faust2cmajor\.js <file\.dsp> <outputDir>/);
});

test('faust2cmajor writes a Cmajor file named after the DSP', () => {
    const dir = outDir('cmajor-organ');
    runCliOk('faust2cmajor', ['test/organ.dsp', dir]);
    assert.deepEqual(listDir(dir), ['organ.cmajor']);
    const code = readOut(dir, 'organ.cmajor');
    assert.ok(code.length > 0, 'the Cmajor file is empty');
    // The generated file has to be Cmajor, not an empty shell or a stray
    // error string: a faust namespace holding a processor named after the
    // DSP, with its endpoints declared.
    assert.match(code, /namespace faust/);
    assert.match(code, /processor organ/);
    assert.match(code, /output stream/);
    assert.match(code, /-lang cmajor/);
});

test('faust2cmajor creates a nested output directory', () => {
    const dir = path.join(outDir('cmajor-nested'), 'a', 'b');
    runCliOk('faust2cmajor', ['test/mono.dsp', dir]);
    assert.ok(outExists(dir, 'mono.cmajor'));
});

test('faust2cmajor fails on a DSP that does not compile', () => {
    const dir = outDir('cmajor-bad');
    const source = path.join(dir, '..', 'cmajor-bad-source.dsp');
    fs.mkdirSync(path.dirname(source), { recursive: true });
    fs.writeFileSync(source, 'process = no_such_primitive;\n');
    const { status, stderr } = runCli('faust2cmajor', [source, dir]);
    assert.notEqual(status, 0);
    assert.match(stderr, /undefined symbol|no_such_primitive/i);
});

// ------------------------------------------------------------ faust2sndfile

test('faust2sndfile -h lists its options', () => {
    const { status, stdout } = runCli('faust2sndfile', ['-h']);
    assert.equal(status, 0);
    assert.match(stdout, /faust2sndfile\.js <file\.dsp> <outputWav\.wav>/);
    for (const option of ['-bs', '-bd', '-c', '-in', '-sr']) {
        assert.ok(stdout.includes(option), `usage does not mention ${option}`);
    }
});

test('faust2sndfile honours -sr, -bd and -c in the file header', () => {
    const dir = outDir('wav-options');
    fs.mkdirSync(dir, { recursive: true });
    const wav = path.join(dir, 'out.wav');
    runCliOk('faust2sndfile', [
        'test/djembe.dsp',
        wav,
        '-c',
        '48000',
        '-sr',
        '48000',
        '-bd',
        '24'
    ]);
    const info = wavInfo(wav);
    assert.equal(info.format, 1, 'expected PCM');
    assert.equal(info.sampleRate, 48000);
    assert.equal(info.bitDepth, 24);
    assert.equal(info.frames, 48000);
    assert.equal(info.channels, 1, 'djembe.dsp is mono');
});

for (const bitDepth of [16, 24, 32]) {
    test(`faust2sndfile writes ${bitDepth}-bit samples on -bd ${bitDepth}`, () => {
        const dir = outDir(`wav-bd-${bitDepth}`);
        fs.mkdirSync(dir, { recursive: true });
        const wav = path.join(dir, 'out.wav');
        runCliOk('faust2sndfile', [
            'test/mono.dsp',
            wav,
            '-c',
            '1000',
            '-sr',
            '22050',
            '-bd',
            String(bitDepth)
        ]);
        const info = wavInfo(wav);
        assert.equal(info.bitDepth, bitDepth);
        assert.equal(info.frames, 1000);
        assert.equal(info.dataBytes, 1000 * (bitDepth / 8));
    });
}

test('faust2sndfile defaults to 44100 Hz, 16 bits, five seconds', () => {
    const dir = outDir('wav-defaults');
    fs.mkdirSync(dir, { recursive: true });
    const wav = path.join(dir, 'out.wav');
    runCliOk('faust2sndfile', ['test/mono.dsp', wav]);
    const info = wavInfo(wav);
    assert.equal(info.sampleRate, 44100);
    assert.equal(info.bitDepth, 16);
    // The documented default length is SR * 5.
    assert.equal(info.frames, 44100 * 5);
});

test('faust2sndfile writes the channels the DSP declares', () => {
    const dir = outDir('wav-stereo');
    fs.mkdirSync(dir, { recursive: true });
    const wav = path.join(dir, 'out.wav');
    // rev.dsp is one input into a stereo reverb.
    runCliOk('faust2sndfile', ['test/rev.dsp', wav, '-c', '1000']);
    assert.equal(wavInfo(wav).channels, 2);
});

test('faust2sndfile renders something audible, not a silent file', () => {
    const dir = outDir('wav-audible');
    fs.mkdirSync(dir, { recursive: true });
    const wav = path.join(dir, 'out.wav');
    runCliOk('faust2sndfile', [
        'test/mono.dsp',
        wav,
        '-c',
        '1000',
        '-bd',
        '16'
    ]);
    // A file of the right size full of zeros would pass every header check
    // above, so the samples themselves are looked at.
    const buf = fs.readFileSync(wav);
    const data = buf.subarray(44);
    let peak = 0;
    for (let i = 0; i + 1 < data.length; i += 2) {
        peak = Math.max(peak, Math.abs(data.readInt16LE(i)));
    }
    assert.ok(peak > 0, 'the rendered file is silent');
});

test('faust2sndfile processes an input file with -in', () => {
    const dir = outDir('wav-chain');
    fs.mkdirSync(dir, { recursive: true });
    const dry = path.join(dir, 'djembe.wav');
    const wet = path.join(dir, 'djembe-rev.wav');

    // The README's two-step example: render a source, then run it through an
    // effect. rev.dsp takes one input and returns a stereo reverb.
    runCliOk('faust2sndfile', [
        'test/djembe.dsp',
        dry,
        '-c',
        '48000',
        '-sr',
        '48000',
        '-bd',
        '24'
    ]);
    runCliOk('faust2sndfile', [
        'test/rev.dsp',
        wet,
        '-c',
        '48000',
        '-sr',
        '48000',
        '-bd',
        '24',
        '-in',
        dry
    ]);

    const dryInfo = wavInfo(dry);
    const wetInfo = wavInfo(wet);
    assert.equal(dryInfo.channels, 1);
    assert.equal(wetInfo.channels, 2);
    assert.equal(wetInfo.frames, 48000);
    assert.equal(wetInfo.sampleRate, 48000);
    assert.equal(wetInfo.bitDepth, 24);
});

test('faust2sndfile with -in on a silent effect input stays silent', () => {
    const dir = outDir('wav-chain-silent');
    fs.mkdirSync(dir, { recursive: true });
    const silence = path.join(dir, 'silence.wav');
    const out = path.join(dir, 'out.wav');

    // A DSP that renders exact zeros, so the effect has nothing to work on.
    const source = path.join(dir, 'silence.dsp');
    fs.writeFileSync(source, 'process = 0.0;\n');
    runCliOk('faust2sndfile', [source, silence, '-c', '4800', '-sr', '48000']);
    runCliOk('faust2sndfile', [
        'test/rev.dsp',
        out,
        '-c',
        '4800',
        '-sr',
        '48000',
        '-in',
        silence
    ]);

    // Silence in, silence out: this is what makes the non-silent case above
    // evidence that the input was actually read rather than ignored.
    const data = fs.readFileSync(out).subarray(44);
    let peak = 0;
    for (let i = 0; i + 1 < data.length; i += 2) {
        peak = Math.max(peak, Math.abs(data.readInt16LE(i)));
    }
    assert.equal(peak, 0);
});

test('faust2sndfile honours the render buffer size', () => {
    const dir = outDir('wav-bs');
    fs.mkdirSync(dir, { recursive: true });
    const small = path.join(dir, 'bs64.wav');
    const large = path.join(dir, 'bs512.wav');
    runCliOk('faust2sndfile', [
        'test/mono.dsp',
        small,
        '-c',
        '4096',
        '-bs',
        '64'
    ]);
    runCliOk('faust2sndfile', [
        'test/mono.dsp',
        large,
        '-c',
        '4096',
        '-bs',
        '512'
    ]);
    // The block size is an internal detail of the render loop: a pure
    // oscillator must come out identical whichever way it was sliced.
    assert.ok(
        fs.readFileSync(small).equals(fs.readFileSync(large)),
        'the buffer size changed the rendered output'
    );
});

test('faust2sndfile creates the folders leading to its output', () => {
    const dir = outDir('wav-nested');
    const wav = path.join(dir, 'a', 'b', 'out.wav');
    runCliOk('faust2sndfile', ['test/mono.dsp', wav, '-c', '1000']);
    assert.equal(wavInfo(wav).frames, 1000);
});

test('faust2sndfile fails on a DSP that does not compile', () => {
    const dir = outDir('wav-bad');
    fs.mkdirSync(dir, { recursive: true });
    const source = path.join(dir, 'bad.dsp');
    fs.writeFileSync(source, 'process = no_such_primitive;\n');
    const { status, stderr } = runCli('faust2sndfile', [
        source,
        path.join(dir, 'out.wav'),
        '-c',
        '100'
    ]);
    assert.notEqual(status, 0);
    assert.match(stderr, /undefined symbol|no_such_primitive/i);
});
