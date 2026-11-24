/**
 * How fast the wasm this package runs is, against the C++ the Faust compiler
 * generates for the same program.
 *
 *   npm run bench
 *   npm run bench -- ../audio-dsl-bench/dsp            # every .dsp of a directory
 *   npm run bench -- test/bench/dsp/zita_rev.dsp --runs 11
 *   npm run bench -- --max-ratio 3                     # fail above 3x slower
 *
 * Each program is compiled twice: by libfaust-wasm (this package) to wasm,
 * and by a native Faust compiler to C++ with `test/bench/bench-arch.cpp`,
 * which clang (or `CXX`) builds with `-O3`. Both are then timed by the same
 * protocol -- same sample rate, same block size, same input noise, a warm-up
 * run, then the best of 3 rounds of 5 timed runs, the sides taking turns so
 * that a burst of load on the machine does not land on one of them -- and
 * three numbers come out:
 *
 *   C++      the native program, the reference;
 *   wasm     the generated wasm alone: `compute` called straight on the wasm
 *            instance, buffers already in its memory. Against C++, this is
 *            the wasm backend and the engine (V8 here, as in Chrome);
 *   worklet  the same wasm through `FaustMonoWebAudioDsp.compute`, which the
 *            AudioWorklet processor of a node runs at every block: copying
 *            the inputs in, the timed-event loop, bargraphs, the non-finite
 *            check, copying the outputs out. Against wasm, this is this
 *            package's own overhead.
 *
 * Before timing, both sides render the same first frames and the outputs are
 * compared: "max |d|" is the largest difference, relative to the peak of the
 * C++ output. It is what makes the two times comparable (both sides computed
 * the same thing). It is not exactly 0: the wasm imports its math functions
 * from JavaScript (`_sinf` is `Math.sin`, computed in double), which does not
 * round like libm. A large one has two causes: a program the two compilers
 * did not compile alike (different Faust or library versions), or a feedback
 * loop that amplifies those rounding differences -- `greyhole`, whose
 * modulated delays take a 1e-6 difference at frame 44 to 1e-2 at frame 4096.
 * The first shows from the start, the second grows.
 *
 * The native compiler is `FAUST` if set, else `$FAUST_SOURCE_DIR/build/bin/faust`
 * (headers from its `architecture/`), else `faust` on the PATH (headers from
 * `faust --includedir`). Its version should match the one of `libfaust-wasm/`:
 * the script prints both.
 *
 * Not part of `npm test`: timings depend on the machine and its load, and a
 * benchmark that fails at random teaches to ignore it. `--max-ratio` turns it
 * into a check for a machine one knows.
 *
 * Options:
 *   --runs N         timed runs per side and round (default 5)
 *   --rounds N       rounds per program, the sides taking turns; the best run
 *                    of all rounds is kept (default 3)
 *   --seconds S      audio rendered per run (default 1)
 *   --block B        frames per compute call (default 128, the AudioWorklet
 *                    quantum; audio-dsl-bench uses 256)
 *   --sample-rate R  (default 48000)
 *   --args "..."     Faust options for both compilers (default "-ftz 2", what
 *                    createNode uses)
 *   --cxxflags "..." C++ compiler flags (default "-O3")
 *   --max-ratio X    exit 1 if wasm is more than X times slower than C++ on
 *                    any program
 *   --json FILE      write every run of every program there
 */
import {
    instantiateFaustModuleFromFile,
    LibFaust,
    FaustCompiler,
    FaustWasmInstantiator,
    FaustMonoWebAudioDsp
} from '../../dist/esm/index.js';
import { holdEventLoop } from '../../src/holdEventLoop.js';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    '..'
);
const BENCH = path.join(ROOT, 'test', 'bench');
const OUT = path.join(ROOT, 'test', 'out', 'bench');

/** Frames both sides render and compare before timing. */
const REF_FRAMES = 4096;

/** Above this "max |d|", the line is flagged: not the same computation. */
const MISMATCH = 1e-3;

// ---------------------------------------------------------------------------
// Command line

const argv = process.argv.slice(2);
const option = (name, fallback) => {
    const at = argv.indexOf(name);
    if (at === -1) return fallback;
    const value = argv[at + 1];
    if (value === undefined) fail(`${name} needs a value`);
    argv.splice(at, 2);
    return value;
};
const RUNS = Number(option('--runs', '5'));
const ROUNDS = Number(option('--rounds', '3'));
const SECONDS = Number(option('--seconds', '1'));
const BLOCK = Number(option('--block', '128'));
const SAMPLE_RATE = Number(option('--sample-rate', '48000'));
const FAUST_ARGS = option('--args', '-ftz 2');
const CXXFLAGS = option('--cxxflags', '-O3');
const MAX_RATIO = Number(option('--max-ratio', 'NaN'));
const JSON_OUT = option('--json', '');
const unknown = argv.find((a) => a.startsWith('--'));
if (unknown) fail(`unknown option ${unknown}`);

const FRAMES = Math.max(1, Math.round((SECONDS * SAMPLE_RATE) / BLOCK)) * BLOCK;

/** The .dsp files named, or found in the directories named. */
const programs = (argv.length ? argv : [path.join(BENCH, 'dsp')]).flatMap(
    (arg) => {
        const p = path.resolve(arg);
        if (!fs.existsSync(p)) fail(`no such file or directory: ${arg}`);
        if (!fs.statSync(p).isDirectory()) return [p];
        return fs
            .readdirSync(p)
            .filter((name) => name.endsWith('.dsp'))
            .sort()
            .map((name) => path.join(p, name));
    }
);

// ---------------------------------------------------------------------------
// Native toolchain

const SOURCE = process.env.FAUST_SOURCE_DIR ?? '';
const FAUST =
    process.env.FAUST ||
    (SOURCE ? path.join(SOURCE, 'build', 'bin', 'faust') : 'faust');
const CXX = process.env.CXX || 'c++';

const run = (cmd, args, what) => {
    const result = spawnSync(cmd, args, {
        encoding: 'utf8',
        maxBuffer: 64 << 20
    });
    if (result.error)
        fail(`${what}: cannot run ${cmd} (${result.error.message})`);
    return result;
};

const nativeVersion = run(FAUST, ['--version'], 'native Faust').stdout.split(
    '\n'
)[0];
const INCLUDE = SOURCE
    ? path.join(SOURCE, 'architecture')
    : run(FAUST, ['--includedir'], 'native Faust').stdout.trim();
if (!fs.existsSync(path.join(INCLUDE, 'faust', 'dsp', 'dsp.h'))) {
    fail(
        `no faust/dsp/dsp.h under ${INCLUDE}: set FAUST_SOURCE_DIR to a faust checkout`
    );
}
const isDouble = /(^|\s)-(double|db)(\s|$)/.test(FAUST_ARGS);

/**
 * The C++ side of one program: generated, compiled, run once; `again` runs
 * it once more for the next round and returns that round's timings.
 * @returns {{ inputs: number, outputs: number, runs: number[], ref: (Float32Array | Float64Array)[], loopMath: string[], again: () => number[] } | { error: string }}
 */
const native = (dsp, dir) => {
    const cpp = path.join(dir, 'native.cpp');
    const bin = path.join(dir, 'native');
    const refFile = path.join(dir, 'native.ref');
    const faust = run(
        FAUST,
        [
            '-lang',
            'cpp',
            ...split(FAUST_ARGS),
            '-cn',
            'mydsp',
            '-a',
            path.join(BENCH, 'bench-arch.cpp'),
            '-I',
            path.dirname(dsp),
            dsp,
            '-o',
            cpp
        ],
        'native Faust'
    );
    if (faust.status !== 0) return { error: `faust: ${faust.stderr.trim()}` };
    const cxx = run(
        CXX,
        [
            '-std=c++17',
            ...split(CXXFLAGS),
            ...(isDouble ? ['-DFAUSTFLOAT=double'] : []),
            '-I',
            INCLUDE,
            cpp,
            '-o',
            bin
        ],
        'C++ compiler'
    );
    if (cxx.status !== 0)
        return { error: `${CXX}: ${cxx.stderr.trim().split('\n')[0]}` };
    const exec = () =>
        run(
            bin,
            [SAMPLE_RATE, BLOCK, FRAMES, RUNS, REF_FRAMES, refFile].map(String),
            'native program'
        );
    const parse = (out) =>
        JSON.parse(out.stdout.trim().split('\n').pop() ?? '{}');
    const out = exec();
    if (out.status !== 0)
        return { error: `native program: ${out.stderr.trim()}` };
    const { inputs, outputs, runs_ns } = parse(out);
    const bytes = fs.readFileSync(refFile);
    const all = isDouble
        ? new Float64Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 8)
        : new Float32Array(
              bytes.buffer,
              bytes.byteOffset,
              bytes.byteLength / 4
          );
    const ref = Array.from({ length: outputs }, (_, c) =>
        all.subarray(c * REF_FRAMES, (c + 1) * REF_FRAMES)
    );
    return {
        inputs,
        outputs,
        runs: runs_ns,
        ref,
        loopMath: loopMath(fs.readFileSync(cpp, 'utf8')),
        again: () => parse(exec()).runs_ns
    };
};

/**
 * The C math functions the wasm backend imports from JavaScript. The ones
 * wasm has as instructions (`floor`, `sqrt`, `fabs`, `min`, `max`...) are not
 * here: calling them costs no more in wasm than in C++.
 */
const IMPORTED_MATH = new Set(
    (
        'sin cos tan asin acos atan atan2 sinh cosh tanh asinh acosh atanh ' +
        'exp exp2 exp10 expm1 log log2 log10 log1p pow fmod remainder round'
    ).split(' ')
);

/**
 * The math functions the generated C++ calls in its sample loop, the code
 * from the first `for (int i0` of `compute` on: in wasm, each is a call into
 * JavaScript at every sample. A program that calls them only on its controls
 * (`fSlow`, before the loop) imports them too, at no cost per sample. Faust
 * writes a primitive `std::sin(` and a foreign function (`ma.tanh`) `tanhf(`.
 */
const loopMath = (source) => {
    const compute = source.indexOf('virtual void compute(');
    const loop = source.indexOf('for (int i0 = 0;', compute);
    if (compute === -1 || loop === -1) return [];
    const names = [
        ...source
            .slice(loop)
            .matchAll(/(?<![\w.])(?:std::)?([a-z][a-z0-9]*)\(/g)
    ]
        .map((m) => m[1])
        .map((name) =>
            !IMPORTED_MATH.has(name) && IMPORTED_MATH.has(name.slice(0, -1))
                ? name.slice(0, -1)
                : name
        )
        .filter((name) => IMPORTED_MATH.has(name));
    return [...new Set(names)].sort();
};

// ---------------------------------------------------------------------------
// The input: one block of noise per channel, the LCG of bench-arch.cpp

/** @returns {Float32Array[]} */
const noise = (channels) => {
    let seed = 12345;
    return Array.from({ length: channels }, () =>
        Float32Array.from({ length: BLOCK }, () => {
            seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
            return Math.fround(((seed >>> 8) / 16777216) * 0.5 - 0.25);
        })
    );
};

// ---------------------------------------------------------------------------
// The wasm side

const now = () => process.hrtime.bigint();

/**
 * The generated wasm alone, laid out the way FaustMonoWebAudioDsp lays it
 * out (DSP at 0, then the channel pointer tables, then the buffers), and
 * called straight.
 */
const rawWasm = async (factory) => {
    const instance =
        await FaustWasmInstantiator.createAsyncMonoDSPInstance(factory);
    const meta = JSON.parse(factory.json);
    const { api, memory } = instance;
    const sampleSize = /-double/.test(meta.compile_options) ? 8 : 4;
    const ins = api.getNumInputs(0);
    const outs = api.getNumOutputs(0);
    const $ins = meta.size;
    const $outs = $ins + ins * 4;
    const $inBuf = $outs + outs * 4;
    const $outBuf = $inBuf + ins * BLOCK * sampleSize;
    const end = $outBuf + outs * BLOCK * sampleSize;
    if (end > memory.buffer.byteLength)
        memory.grow(Math.ceil((end - memory.buffer.byteLength) / 65536));
    const HEAP32 = new Int32Array(memory.buffer);
    const HEAPF =
        sampleSize === 4
            ? new Float32Array(memory.buffer)
            : new Float64Array(memory.buffer);
    const channel = (base, c) =>
        HEAPF.subarray(
            (base + c * BLOCK * sampleSize) / sampleSize,
            (base + (c + 1) * BLOCK * sampleSize) / sampleSize
        );
    const inputs = [];
    const outputs = [];
    for (let c = 0; c < ins; c++) {
        HEAP32[($ins >> 2) + c] = $inBuf + c * BLOCK * sampleSize;
        inputs.push(channel($inBuf, c));
    }
    for (let c = 0; c < outs; c++) {
        HEAP32[($outs >> 2) + c] = $outBuf + c * BLOCK * sampleSize;
        outputs.push(channel($outBuf, c));
    }
    api.init(0, SAMPLE_RATE);
    noise(ins).forEach((block, c) => inputs[c].set(block));
    return {
        ins,
        outs,
        /** @returns {Float32Array[]} */
        render(frames) {
            const result = Array.from(
                { length: outs },
                () => new Float32Array(frames)
            );
            for (let done = 0; done < frames; done += BLOCK) {
                const count = Math.min(BLOCK, frames - done);
                api.compute(0, count, $ins, $outs);
                for (let c = 0; c < outs; c++)
                    result[c].set(outputs[c].subarray(0, count), done);
            }
            return result;
        },
        block: () => api.compute(0, BLOCK, $ins, $outs)
    };
};

/** The same wasm through the per-block entry point of the Web Audio nodes. */
const wrapped = async (factory) => {
    const instance =
        await FaustWasmInstantiator.createAsyncMonoDSPInstance(factory);
    const sampleSize = /-double/.test(JSON.parse(factory.json).compile_options)
        ? 8
        : 4;
    const dsp = new FaustMonoWebAudioDsp(
        instance,
        SAMPLE_RATE,
        sampleSize,
        BLOCK,
        undefined
    );
    dsp.start();
    const inputs = noise(dsp.getNumInputs());
    const outputs = Array.from(
        { length: dsp.getNumOutputs() },
        () => new Float32Array(BLOCK)
    );
    return { block: () => dsp.compute(inputs, outputs) };
};

/** One warm-up run, then RUNS timed ones, in nanoseconds. */
const time = (block) => {
    const blocks = FRAMES / BLOCK;
    const runs = [];
    for (let r = -1; r < RUNS; r++) {
        const start = now();
        for (let b = 0; b < blocks; b++) block();
        const elapsed = Number(now() - start);
        if (r >= 0) runs.push(elapsed);
    }
    return runs;
};

/** Largest difference between two renderings, relative to the reference's peak. */
const difference = (ref, got) => {
    let peak = 0;
    let diff = 0;
    for (let c = 0; c < ref.length; c++) {
        for (let i = 0; i < ref[c].length; i++) {
            peak = Math.max(peak, Math.abs(ref[c][i]));
            diff = Math.max(diff, Math.abs(ref[c][i] - got[c][i]));
        }
    }
    return peak > 0 ? diff / peak : diff;
};

// ---------------------------------------------------------------------------
// Main

const main = async () => {
    const faustModule = await instantiateFaustModuleFromFile(
        path.join(ROOT, 'libfaust-wasm', 'libfaust-wasm.js')
    );
    const compiler = new FaustCompiler(new LibFaust(faustModule));
    fs.mkdirSync(OUT, { recursive: true });

    console.log(`libfaust-wasm  ${compiler.version()}`);
    console.log(`native         ${nativeVersion} (${FAUST})`);
    console.log(`C++            ${CXX} ${CXXFLAGS}`);
    console.log(
        `protocol       ${SAMPLE_RATE} Hz, ${BLOCK}-frame blocks, ${FRAMES} frames per run, best of ${ROUNDS}x${RUNS}, Faust ${FAUST_ARGS}`
    );
    console.log('');
    console.log(
        'ns per frame (lower is faster); wasm/C++ above 1 means wasm is slower'
    );
    console.log('');

    const header = [
        'program',
        'in/out',
        'C++',
        'wasm',
        'worklet',
        'wasm/C++',
        'worklet/wasm',
        'C++ xRT',
        'max |d|'
    ];
    const widths = [16, 7, 9, 9, 9, 9, 12, 9, 9];
    const line = (cells) =>
        cells
            .map((cell, i) =>
                i === 0
                    ? String(cell).padEnd(widths[i])
                    : String(cell).padStart(widths[i])
            )
            .join(' ');
    console.log(line(header));

    const results = [];
    /** @type {{ name: string, error: string }[]} */
    const failed = [];
    for (const dsp of programs) {
        const name = path.basename(dsp, '.dsp');
        const dir = path.join(OUT, name);
        fs.mkdirSync(dir, { recursive: true });
        const code = fs.readFileSync(dsp, 'utf8');

        const factory = await compiler.createMonoDSPFactory(
            name,
            code,
            FAUST_ARGS
        );
        if (!factory) {
            console.log(
                `${name.padEnd(widths[0])} wasm compilation failed: ${compiler.getErrorMessage().trim()}`
            );
            failed.push({ name, error: compiler.getErrorMessage() });
            continue;
        }
        if (/"type":\s*"soundfile"/.test(factory.json)) {
            console.log(`${name.padEnd(widths[0])} skipped: soundfiles`);
            continue;
        }
        const cpp = native(dsp, dir);
        if ('error' in cpp) {
            console.log(`${name.padEnd(widths[0])} ${cpp.error}`);
            failed.push({ name, error: cpp.error });
            continue;
        }

        const raw = await rawWasm(factory);
        const diff = difference(cpp.ref, raw.render(REF_FRAMES));
        const worklet = await wrapped(factory);
        // The sides take turns, so that a burst of load on the machine
        // lands on all three rather than on whichever was running.
        const cppRuns = [...cpp.runs];
        const wasmRuns = time(raw.block);
        const workletRuns = time(worklet.block);
        for (let round = 1; round < ROUNDS; round++) {
            cppRuns.push(...cpp.again());
            wasmRuns.push(...time(raw.block));
            workletRuns.push(...time(worklet.block));
        }

        const best = (runs) => Math.min(...runs) / FRAMES;
        const c = best(cppRuns);
        const w = best(wasmRuns);
        const n = best(workletRuns);
        const result = {
            name,
            inputs: raw.ins,
            outputs: raw.outs,
            cppNsPerFrame: c,
            wasmNsPerFrame: w,
            workletNsPerFrame: n,
            wasmOverCpp: w / c,
            workletOverWasm: n / w,
            maxRelDiff: diff,
            // The math functions the wasm calls out to JavaScript for
            // (`_sinf`...): the first suspect when wasm is far behind.
            imports: WebAssembly.Module.imports(factory.module)
                .filter((i) => i.kind === 'function')
                .map((i) => i.name),
            loopMath: cpp.loopMath,
            runs: { cpp: cppRuns, wasm: wasmRuns, worklet: workletRuns }
        };
        results.push(result);
        console.log(
            line([
                name,
                `${raw.ins}/${raw.outs}`,
                c.toFixed(2),
                w.toFixed(2),
                n.toFixed(2),
                `x${(w / c).toFixed(2)}`,
                `x${(n / w).toFixed(2)}`,
                Math.round(1e9 / SAMPLE_RATE / c),
                diff > MISMATCH
                    ? `${diff.toExponential(1)} !`
                    : diff.toExponential(1)
            ])
        );
    }

    if (results.length > 1) {
        const geomean = (key) =>
            Math.exp(
                results.reduce((s, r) => s + Math.log(r[key]), 0) /
                    results.length
            );
        console.log('');
        console.log(
            `geometric mean over ${results.length} programs: wasm/C++ x${geomean('wasmOverCpp').toFixed(2)}, worklet/wasm x${geomean('workletOverWasm').toFixed(2)}`
        );
    }
    if (results.some((r) => r.maxRelDiff > MISMATCH)) {
        console.log(
            `! outputs differ by more than ${MISMATCH} of their peak: different Faust versions, or a feedback loop amplifying rounding (see the header of this script)`
        );
    }

    if (JSON_OUT) {
        const environment = {
            libfaustWasm: compiler.version(),
            native: nativeVersion,
            cxx: `${CXX} ${CXXFLAGS}`,
            node: process.version,
            cpu: os.cpus()[0]?.model ?? '',
            platform: `${os.platform()} ${os.arch()}`,
            date: new Date().toISOString().slice(0, 10),
            sampleRate: SAMPLE_RATE,
            block: BLOCK,
            frames: FRAMES,
            runs: RUNS,
            rounds: ROUNDS,
            faustArgs: FAUST_ARGS
        };
        fs.writeFileSync(
            JSON_OUT,
            `${JSON.stringify({ environment, results, failed }, null, 2)}\n`
        );
        console.log(`results written to ${JSON_OUT}`);
    }

    const tooSlow = Number.isNaN(MAX_RATIO)
        ? []
        : results.filter((r) => r.wasmOverCpp > MAX_RATIO);
    for (const r of tooSlow)
        console.log(
            `FAIL ${r.name}: wasm x${r.wasmOverCpp.toFixed(2)} slower than C++ (max x${MAX_RATIO})`
        );
    if (failed.length || tooSlow.length) process.exitCode = 1;
};

function split(args) {
    return args.split(/\s+/).filter(Boolean);
}

function fail(message) {
    console.error(message);
    process.exit(1);
}

// Awaiting WebAssembly.compile with no live handle can hang Node (see
// src/holdEventLoop.js); the bench compiles one program after another.
await holdEventLoop(main)();
