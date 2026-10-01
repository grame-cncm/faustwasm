/**
 * Reading a soundfile with more channels than it actually has.
 *
 * `soundfile(label, N)` with a file of C < N channels reads channel `c` as
 * channel `c % C`. This wrap is done by the generated code (`chan % fChannels`),
 * not by the runtime: `Soundfile` only allocates the C
 * real channel buffers, and has to fill the `fChannels` field the generated
 * code reads. A missing or wrong `fChannels` gives a wrong channel, or an
 * `i32.rem_s` trap when it is 0.
 *
 * The DSPs are compiled for real with libfaust-wasm, in float and double: in
 * double, the pointer array of the buffers used to be indexed with an 8-byte
 * stride, so channel 1 of a stereo file played channel 0.
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    instantiateFaustModuleFromFile,
    LibFaust,
    FaustCompiler,
    FaustMonoDspGenerator
} from '../../dist/esm/index.js';

const ROOT = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../..'
);
const FRAMES = 64;

/** @type {FaustCompiler} */
let compiler;

before(async () => {
    const faustModule = await instantiateFaustModuleFromFile(
        path.join(ROOT, 'libfaust-wasm', 'libfaust-wasm.js')
    );
    compiler = new FaustCompiler(new LibFaust(faustModule));
});

/**
 * A file of `channels` channels where channel c holds (c + 1) + frame / 1024,
 * exactly representable in float.
 *
 * @param {number} channels
 */
const file = (channels) => ({
    sampleRate: 44100,
    audioBuffer: Array.from({ length: channels }, (_, chan) =>
        Float32Array.from(
            { length: 256 },
            (_, frame) => chan + 1 + frame / 1024
        )
    )
});

/**
 * Render `outputs` outputs of a soundfile holding `channels` channels.
 *
 * @param {number} channels
 * @param {number} outputs
 * @param {string} args
 */
const render = async (channels, outputs, args) => {
    const code = `process = 0, _~+(1) : soundfile("son[url:{'wrap.wav'}]", ${outputs}) : !, !, par(i, ${outputs}, _);`;
    const generator = new FaustMonoDspGenerator();
    assert.ok(await generator.compile(compiler, 'wrap', code, args));
    generator.addSoundfiles({ 'wrap.wav': file(channels) });
    const processor = await generator.createOfflineProcessor(44100, FRAMES);
    return processor.render([], FRAMES);
};

for (const args of ['-ftz 2', '-ftz 2 -double']) {
    for (const [channels, outputs] of [
        [1, 3],
        [2, 4],
        [3, 5],
        [3, 70]
    ]) {
        test(`${channels} channels read as ${outputs} (${args})`, async () => {
            const result = await render(channels, outputs, args);
            assert.equal(result.length, outputs);
            for (let out = 0; out < outputs; out += 1) {
                const chan = out % channels;
                // Output 'out' has the content of channel 'out % channels'
                assert.ok(
                    result[out].every((v) => Math.floor(v) === chan + 1),
                    `output ${out} should read channel ${chan}, got ${result[out][1]}`
                );
                assert.deepEqual(result[out], result[chan]);
            }
        });
    }
}
