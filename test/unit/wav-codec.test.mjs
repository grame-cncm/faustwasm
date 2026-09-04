/**
 * The WAV pair.
 *
 * `WavEncoder` is what `faust2sndfile` writes with and `WavDecoder` what it
 * reads back under `-in`, so the two are a round trip in ordinary use: render
 * a source, then process it through an effect. The CLI tests check the header
 * the encoder produces; what is checked here is the other half -- that the
 * samples survive the trip, at every bit depth, and that a malformed file is
 * rejected rather than decoded into noise.
 *
 * Both are exported from the package, so they are exercised through the same
 * bundle everything else in test/unit uses.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WavEncoder, WavDecoder } from '../../dist/esm/index.js';

const SAMPLE_RATE = 44100;

/**
 * A deterministic signal that visits the whole [-1, 1] range.
 *
 * A sine alone would cluster samples near the extremes; the ramp makes sure
 * the mid-range and the exact zero are covered too.
 *
 * @param {number} length
 * @param {number} [channel] - Shifts the phase so channels differ.
 * @returns {Float32Array}
 */
const signal = (length, channel = 0) => {
    const out = new Float32Array(length);
    for (let i = 0; i < length; i += 1) {
        const ramp = (2 * i) / (length - 1) - 1;
        out[i] = i % 2 === 0 ? ramp : Math.sin((i + channel) * 0.1) * 0.9;
    }
    return out;
};

/**
 * One quantization step for a signed PCM depth.
 *
 * A round trip through N-bit PCM cannot do better than half a step; a whole
 * step is the honest bound to assert against, and it is what separates "the
 * codec works" from "the codec works at 16 bits and mangles 24".
 *
 * @param {number} bitDepth
 * @returns {number}
 */
const step = (bitDepth) => 2 / 2 ** bitDepth;

/** The largest absolute difference between two channel sets. */
const maxError = (a, b) => {
    let worst = 0;
    for (let ch = 0; ch < a.length; ch += 1) {
        for (let i = 0; i < a[ch].length; i += 1) {
            worst = Math.max(worst, Math.abs(a[ch][i] - b[ch][i]));
        }
    }
    return worst;
};

for (const bitDepth of [8, 16, 24, 32]) {
    test(`a mono signal survives a ${bitDepth}-bit round trip`, () => {
        const input = [signal(512)];
        const wav = WavEncoder.encode(input, {
            sampleRate: SAMPLE_RATE,
            bitDepth
        });
        const decoded = WavDecoder.decode(wav);

        assert.equal(decoded.numberOfChannels, 1);
        assert.equal(decoded.sampleRate, SAMPLE_RATE);
        assert.equal(decoded.length, 512);
        assert.ok(
            maxError(input, decoded.channelData) <= step(bitDepth),
            `error exceeds one ${bitDepth}-bit step`
        );
    });

    test(`a stereo signal keeps its channels apart at ${bitDepth} bits`, () => {
        const input = [signal(256, 0), signal(256, 7)];
        const wav = WavEncoder.encode(input, { sampleRate: 48000, bitDepth });
        const decoded = WavDecoder.decode(wav);

        assert.equal(decoded.numberOfChannels, 2);
        assert.equal(decoded.sampleRate, 48000);
        assert.ok(maxError(input, decoded.channelData) <= step(bitDepth));
        // Interleaving is where a codec silently swaps or duplicates
        // channels, and two identical-looking channels would hide it.
        assert.notDeepEqual(
            Array.from(decoded.channelData[0]),
            Array.from(decoded.channelData[1])
        );
    });
}

test('a finer depth really is finer', () => {
    const input = [signal(512)];
    const error = (bitDepth) =>
        maxError(
            input,
            WavDecoder.decode(
                WavEncoder.encode(input, { sampleRate: SAMPLE_RATE, bitDepth })
            ).channelData
        );
    // Otherwise `-bd 24` could be writing 16-bit samples into a 24-bit
    // container and every tolerance above would still pass.
    assert.ok(error(16) < error(8));
    assert.ok(error(24) < error(16));
});

test('float encoding is exact', () => {
    const input = [signal(256)];
    const wav = WavEncoder.encode(input, {
        sampleRate: SAMPLE_RATE,
        bitDepth: 32,
        float: true
    });
    const decoded = WavDecoder.decode(wav);
    // Float32 in, float32 out: no quantization anywhere on the path.
    assert.deepEqual(Array.from(decoded.channelData[0]), Array.from(input[0]));
});

test('float encoding is tagged as IEEE float, not PCM', () => {
    const wav = WavEncoder.encode([signal(64)], {
        sampleRate: SAMPLE_RATE,
        bitDepth: 32,
        float: true
    });
    // A reader that trusts the format tag has to be told the truth, or it
    // will read the bytes as integers.
    assert.equal(new DataView(wav).getUint16(20, true), 0x0003);

    const pcm = WavEncoder.encode([signal(64)], {
        sampleRate: SAMPLE_RATE,
        bitDepth: 16
    });
    assert.equal(new DataView(pcm).getUint16(20, true), 0x0001);
});

test('the encoder defaults to 16 bits', () => {
    const wav = WavEncoder.encode([signal(64)], { sampleRate: SAMPLE_RATE });
    assert.equal(new DataView(wav).getUint16(34, true), 16);
});

test('a zero-length signal encodes to a header and no data', () => {
    const wav = WavEncoder.encode([new Float32Array(0)], {
        sampleRate: SAMPLE_RATE,
        bitDepth: 16
    });
    assert.equal(wav.byteLength, 44);
    const decoded = WavDecoder.decode(wav);
    assert.equal(decoded.length, 0);
});

test('a buffer that is not RIFF is refused', () => {
    const notWav = new Uint8Array(64);
    notWav.set([0x4d, 0x5a, 0x00, 0x00]); // "MZ": a DOS executable
    assert.throws(() => WavDecoder.decode(notWav.buffer), TypeError);
});

test('an empty buffer is refused rather than read past its end', () => {
    // There is no zero-length guard: the read simply runs out of buffer and
    // DataView raises RangeError rather than the decoder's own TypeError.
    // What matters is that it throws instead of returning empty audio.
    assert.throws(() => WavDecoder.decode(new ArrayBuffer(0)), RangeError);
});

test('a RIFF file that is not WAVE is refused', () => {
    const wav = WavEncoder.encode([signal(32)], {
        sampleRate: SAMPLE_RATE,
        bitDepth: 16
    });
    const view = new DataView(wav);
    // Keep "RIFF" but claim another form: this is an AVI, not audio.
    for (const [i, c] of [...'AVI '].entries()) {
        view.setUint8(8 + i, c.charCodeAt(0));
    }
    assert.throws(() => WavDecoder.decode(wav), TypeError);
});

test('an unsupported bit depth is refused', () => {
    const wav = WavEncoder.encode([signal(32)], {
        sampleRate: SAMPLE_RATE,
        bitDepth: 16
    });
    const view = new DataView(wav);
    view.setUint16(34, 12, true); // 12-bit PCM: no reader for it
    assert.throws(() => WavDecoder.decode(wav), {
        name: 'TypeError',
        message: /Not supported bit depth: 12/
    });
});

test('an unsupported format tag is refused', () => {
    const wav = WavEncoder.encode([signal(32)], {
        sampleRate: SAMPLE_RATE,
        bitDepth: 16
    });
    const view = new DataView(wav);
    view.setUint16(20, 0x0011, true); // IMA ADPCM
    assert.throws(() => WavDecoder.decode(wav), {
        name: 'TypeError',
        message: /Unsupported format/
    });
});

test('a truncated data chunk decodes the frames that are there', () => {
    const input = [signal(128)];
    const wav = WavEncoder.encode(input, {
        sampleRate: SAMPLE_RATE,
        bitDepth: 16
    });
    // Cut the file in half without touching the header, as a partial
    // download or an interrupted write would.
    const truncated = wav.slice(0, 44 + 128);
    const decoded = WavDecoder.decode(truncated);
    // The header still claims 128 frames; only 64 are readable, and the
    // decoder is expected to stop at what it has rather than run off the end.
    assert.equal(decoded.length, 64);
    assert.ok(
        maxError([input[0].subarray(0, 64)], decoded.channelData) <= step(16)
    );
});

test('the decoder reports the sample rate it was given', () => {
    for (const sampleRate of [8000, 22050, 44100, 48000, 96000]) {
        const wav = WavEncoder.encode([signal(32)], {
            sampleRate,
            bitDepth: 16
        });
        assert.equal(WavDecoder.decode(wav).sampleRate, sampleRate);
    }
});

test('digital full scale down survives 24 bits', () => {
    // Regression: 24-bit is the one depth whose reader sign-extends by hand,
    // and it tested `xx > 0x800000`. 0x800000 *is* the most negative value,
    // so the single loudest negative sample came back as +1.0 -- a
    // full-amplitude sign flip in the middle of the audio, on the depth the
    // README recommends for faust2sndfile.
    const input = [Float32Array.from([-1, -0.5, 0, 0.5, 1])];
    const decoded = WavDecoder.decode(
        WavEncoder.encode(input, { sampleRate: SAMPLE_RATE, bitDepth: 24 })
    );
    assert.equal(decoded.channelData[0][0], -1);
    for (const [i, expected] of input[0].entries()) {
        assert.ok(
            Math.abs(decoded.channelData[0][i] - expected) <= step(24),
            `frame ${i}: ${decoded.channelData[0][i]} for ${expected}`
        );
    }
});

test('digital full scale down survives every other depth too', () => {
    for (const bitDepth of [8, 16, 32]) {
        const decoded = WavDecoder.decode(
            WavEncoder.encode([Float32Array.from([-1])], {
                sampleRate: SAMPLE_RATE,
                bitDepth
            })
        );
        assert.equal(decoded.channelData[0][0], -1, `at ${bitDepth} bits`);
    }
});
