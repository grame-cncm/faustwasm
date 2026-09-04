/**
 * Do the tests actually fail when the code is wrong?
 *
 * A test can be green for two reasons: the code is right, or the assertion
 * cannot tell. Nothing in an ordinary run separates them. This applies a list
 * of deliberate breakages to `src/` and requires the named test file to go red
 * for each one; a mutant that survives means the test covering it proves less
 * than its name claims.
 *
 * Every entry below was found the hard way -- either it is a bug this suite
 * actually caught, or it is a mutation that slipped through a first draft of a
 * test and forced that test to be rewritten. It is not a generated mutation
 * matrix and does not try to be exhaustive: it is a regression test for the
 * tests themselves, run on demand rather than on every commit.
 *
 *     npm run test-mutants
 *
 * Source files are restored on the way out, including after a crash or a
 * Ctrl-C, and the ESM bundle is rebuilt at the end.
 */
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * @typedef {object} Mutant
 * @property {string} what - what the breakage represents, for the report
 * @property {string} file - the source to break, relative to the repo root
 * @property {string} from - the text to replace (every occurrence)
 * @property {string} to - what to replace it with
 * @property {string} tests - the test file that must fail
 */

/** @type {Mutant[]} */
const MUTANTS = [
    {
        what: 'the three-point interpolator takes the midpoint on the wrong side',
        file: 'src/FaustSensors.ts',
        from: 'return x < this.fMid',
        to: 'return x <= this.fMid',
        tests: 'test/unit/sensors.test.mjs'
    },
    {
        what: 'the Up curve is built as a Down converter',
        file: 'src/FaustSensors.ts',
        from: 'case Curve.Up:\n                return new FaustSensors.UpConverter(',
        to: 'case Curve.Up:\n                return new FaustSensors.DownConverter(',
        tests: 'test/unit/sensors.test.mjs'
    },
    {
        what: '24-bit decoding drops the most negative sample',
        file: 'src/WavDecoder.ts',
        from: 'xx >= 0x800000',
        to: 'xx > 0x800000',
        tests: 'test/unit/wav-codec.test.mjs'
    },
    {
        what: 'an unknown parameter path reaches wasm again',
        file: 'src/FaustWebAudioDsp.ts',
        from: "if (index === undefined) return this.warnUnknownPath(path, 'ignored');",
        to: 'if (false) return;',
        tests: 'test/unit/param-api.test.mjs'
    },
    {
        what: 'the ScriptProcessor node forwards keyOff to keyOn',
        file: 'src/FaustScriptProcessorNode.ts',
        from: 'this.fDSPCode.keyOff(channel, pitch, velocity);',
        to: 'this.fDSPCode.keyOn(channel, pitch, velocity);',
        tests: 'test/unit/script-processor.test.mjs'
    },
    {
        what: 'the accelerometer is not inverted on Android',
        file: 'src/FaustScriptProcessorNode.ts',
        from: 'this.propagateAcc({ x, y, z }, isAndroid);',
        to: 'this.propagateAcc({ x, y, z }, false);',
        tests: 'test/unit/script-processor.test.mjs'
    },
    {
        what: 'the offline processor ignores the tail of its input',
        file: 'src/FaustOfflineProcessor.ts',
        from: 'input = inputs[i].subarray(l, inputs[i].length);',
        to: 'input = new Float32Array(sliceLength);',
        tests: 'test/unit/paths-agree.test.mjs'
    },
    {
        what: 'the worklet processor hands the DSP no input',
        file: 'src/FaustAudioWorkletProcessor.ts',
        from: 'return this.fDSPCode.compute(inputs[0], outputs[0], events);',
        to: 'return this.fDSPCode.compute([], outputs[0], events);',
        tests: 'test/unit/paths-agree.test.mjs'
    },
    {
        what: 'a polyphonic voice computes half a block',
        file: 'src/FaustWebAudioDsp.ts',
        from: 'voice.compute(count, this.fAudioInputs, this.fAudioMixing);',
        to: 'voice.compute(count >> 1, this.fAudioInputs, this.fAudioMixing);',
        tests: 'test/unit/paths-agree.test.mjs'
    },
    {
        what: 'the factory cache key goes back to concatenation',
        file: 'src/FaustCompiler.ts',
        from: 'const shaKey = await sha256(JSON.stringify([name, code, args, poly]));',
        to: "const shaKey = await sha256(name + code + args + (poly ? 'poly' : 'mono'));",
        tests: 'test/unit/compiler-cache.test.mjs'
    },
    {
        what: 'faust2wasm stops creating nested output directories',
        file: 'src/faust2wasmFiles.js',
        from: 'fs.mkdirSync(outputDir, { recursive: true });',
        to: 'if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir);',
        tests: 'test/cli/faust2wasm-edge.test.mjs'
    }
];

/** The source files this run touches, with their original contents. */
const originals = new Map();

/** Put every touched file back the way it was. */
const restoreAll = () => {
    for (const [file, content] of originals) {
        fs.writeFileSync(path.join(ROOT, file), content);
    }
    originals.clear();
};

// A crash or a Ctrl-C must not leave a broken source behind.
process.on('exit', restoreAll);
process.on('SIGINT', () => {
    restoreAll();
    process.exit(130);
});

/** Rebuild the ESM bundle the tests import. */
const rebuild = () =>
    spawnSync('npm', ['run', 'build-esm'], { cwd: ROOT, stdio: 'ignore' });

/**
 * Apply one mutant and report whether its tests noticed.
 *
 * @param {Mutant} mutant
 * @returns {{ caught: boolean, detail: string }}
 */
const run = (mutant) => {
    const file = path.join(ROOT, mutant.file);
    const original = fs.readFileSync(file, 'utf8');
    if (!original.includes(mutant.from)) {
        return {
            caught: false,
            detail: `the text to break is no longer in ${mutant.file}`
        };
    }
    originals.set(mutant.file, original);
    try {
        fs.writeFileSync(file, original.split(mutant.from).join(mutant.to));
        rebuild();
        const result = spawnSync('node', ['--test', mutant.tests], {
            cwd: ROOT,
            encoding: 'utf8'
        });
        const failures = (result.stdout.match(/^not ok /gm) || []).length;
        return result.status === 0
            ? { caught: false, detail: 'the tests stayed green' }
            : { caught: true, detail: `${failures} test(s) failed` };
    } finally {
        fs.writeFileSync(file, original);
        originals.delete(mutant.file);
    }
};

let survivors = 0;
console.log(`Applying ${MUTANTS.length} deliberate breakages.\n`);
for (const mutant of MUTANTS) {
    process.stdout.write(`  ${mutant.what}\n    `);
    const { caught, detail } = run(mutant);
    if (!caught) survivors += 1;
    console.log(
        `${caught ? 'caught' : 'SURVIVED'} by ${path.basename(mutant.tests)} -- ${detail}`
    );
}

rebuild();
console.log(
    `\n${MUTANTS.length - survivors}/${MUTANTS.length} caught.` +
        (survivors
            ? ` ${survivors} survived: the tests named above do not cover what they appear to.`
            : '')
);
process.exit(survivors === 0 ? 0 : 1);
