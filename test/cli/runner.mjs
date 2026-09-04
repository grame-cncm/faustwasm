/**
 * Running the CLI scripts the way a user does.
 *
 * The scripts in `scripts/` are the package's command line surface, and
 * nothing exercised them before: they were only ever run by hand, from the
 * README's examples. They are checked here by spawning them as real processes
 * against a scratch output directory, so what is asserted is what the user
 * gets on disk, not what an internal function returns.
 *
 * Every case writes under `test/out/`, which is gitignored, and clears its own
 * directory first so a case never inherits the previous one's files.
 */
import { spawn, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

/** The repository root: the scripts and the DSP fixtures are relative to it. */
export const ROOT = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../..'
);

const OUT_ROOT = path.join(ROOT, 'test', 'out');

/**
 * A clean scratch directory for one case.
 *
 * The name goes into a path, so anything that is not a word character is
 * folded to `-`: case names carry flags like `-no-template` and DSP names.
 *
 * @param {string} name - Identifies the case; must be unique within a file.
 * @returns {string} Absolute path to the emptied directory's location.
 */
export const outDir = (name) => {
    const dir = path.join(OUT_ROOT, name.replace(/[^\w.-]+/g, '-'));
    fs.rmSync(dir, { recursive: true, force: true });
    return dir;
};

/**
 * Run one of the `scripts/*.js` CLIs and wait for it.
 *
 * `stdio` is captured rather than inherited so a failing case can report what
 * the script actually said. The default `cwd` is the repository root, which is
 * what the README's examples assume; `-I` handling is checked from elsewhere.
 *
 * @param {string} script - Script name without the `.js`, e.g. `faust2wasm`.
 * @param {string[]} args - Arguments passed through verbatim.
 * @param {{ cwd?: string }} [options]
 * @returns {{ status: number | null, stdout: string, stderr: string }}
 */
export const runCli = (script, args, options = {}) => {
    const result = spawnSync(
        process.execPath,
        [path.join(ROOT, 'scripts', `${script}.js`), ...args],
        { cwd: options.cwd ?? ROOT, encoding: 'utf8' }
    );
    return {
        status: result.status,
        stdout: result.stdout ?? '',
        stderr: result.stderr ?? ''
    };
};

/**
 * Run a CLI without blocking, so several can be in flight at once.
 *
 * `runCli` uses `spawnSync`, which serialises by construction; testing what
 * happens when two compilations overlap needs real concurrency.
 *
 * @param {string} script
 * @param {string[]} args
 * @param {{ cwd?: string }} [options]
 * @returns {Promise<{ status: number | null, stdout: string, stderr: string }>}
 */
export const runCliAsync = (script, args, options = {}) =>
    new Promise((resolve) => {
        const child = spawn(
            process.execPath,
            [path.join(ROOT, 'scripts', `${script}.js`), ...args],
            { cwd: options.cwd ?? ROOT }
        );
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (chunk) => (stdout += chunk));
        child.stderr.on('data', (chunk) => (stderr += chunk));
        child.on('close', (status) => resolve({ status, stdout, stderr }));
    });

/**
 * Run a CLI and fail loudly if it did not succeed.
 *
 * A case that asserts on output files gets a useless "file not found" when the
 * compilation was what failed, so the exit code is checked first and the
 * script's own stderr is what gets reported.
 *
 * @param {string} script
 * @param {string[]} args
 * @param {{ cwd?: string }} [options]
 * @returns {{ status: number | null, stdout: string, stderr: string }}
 */
export const runCliOk = (script, args, options) => {
    const result = runCli(script, args, options);
    if (result.status !== 0) {
        throw new Error(
            `${script}.js ${args.join(' ')} exited with ${result.status}\n` +
                `--- stdout ---\n${result.stdout}\n--- stderr ---\n${result.stderr}`
        );
    }
    return result;
};

/**
 * The entries of a directory, sorted, with directories marked by a `/`.
 *
 * Marking directories keeps the expected-file manifests readable and makes a
 * file that should have been a folder (or the reverse) an obvious mismatch.
 *
 * @param {string} dir
 * @returns {string[]}
 */
export const listDir = (dir) =>
    fs
        .readdirSync(dir, { withFileTypes: true })
        .map((entry) => (entry.isDirectory() ? `${entry.name}/` : entry.name))
        .sort();

/**
 * Read a generated file as text.
 *
 * @param {string} dir
 * @param {string} file
 * @returns {string}
 */
export const readOut = (dir, file) =>
    fs.readFileSync(path.join(dir, file), 'utf8');

/**
 * Read a generated `*-meta.json` and parse it.
 *
 * @param {string} dir
 * @param {string} file
 * @returns {any}
 */
export const readMeta = (dir, file) => JSON.parse(readOut(dir, file));

/**
 * Whether the CLI wrote a given file.
 *
 * @param {string} dir
 * @param {string} file
 * @returns {boolean}
 */
export const outExists = (dir, file) => fs.existsSync(path.join(dir, file));

/**
 * Compile a generated `.wasm` into a module.
 *
 * @param {string} dir
 * @param {string} file
 * @returns {Promise<WebAssembly.Module>}
 */
export const loadWasm = async (dir, file) =>
    WebAssembly.compile(fs.readFileSync(path.join(dir, file)));

/**
 * Build a DSP factory out of what the CLI wrote to disk.
 *
 * This is the point of testing the artifacts rather than recompiling in
 * process: the wasm and the JSON that get loaded are the exact bytes the CLI
 * produced, so a truncated module or a metadata mismatch shows up here.
 *
 * @param {string} dir
 * @param {"dsp" | "effect"} prefix
 * @returns {Promise<{ module: WebAssembly.Module, json: string, soundfiles: {} }>}
 */
export const loadFactory = async (dir, prefix = 'dsp') => ({
    module: await loadWasm(dir, `${prefix}-module.wasm`),
    json: readOut(dir, `${prefix}-meta.json`),
    soundfiles: {}
});

/**
 * Every `.dsp` fixture in `test/`, discovered rather than listed.
 *
 * A DSP dropped into `test/` is covered by the suite the moment it lands,
 * which is the whole point of the systematic pass.
 *
 * @returns {string[]} File names, e.g. `mono.dsp`, sorted.
 */
export const allTestDsps = () =>
    fs
        .readdirSync(path.join(ROOT, 'test'))
        .filter((name) => name.endsWith('.dsp'))
        .sort();

/**
 * Extra CLI arguments a fixture needs to compile at all.
 *
 * `foo.dsp` imports a library that deliberately sits outside its own
 * directory, so it only builds with an include path. Keeping that here rather
 * than skipping the fixture means the sweep really does cover every `.dsp` in
 * `test/`.
 *
 * @type {Record<string, string[]>}
 */
export const DSP_EXTRA_ARGS = {
    'foo.dsp': ['-I', 'test/includes']
};

/**
 * The arguments to compile one fixture, beyond input and output.
 *
 * @param {string} dsp - File name, e.g. `foo.dsp`.
 * @returns {string[]}
 */
export const dspArgs = (dsp) => DSP_EXTRA_ARGS[dsp] ?? [];
