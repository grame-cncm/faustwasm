/**
 * The backends compiled into libfaust-wasm.
 *
 * Which ones the library carries is settled when Faust is CONFIGURED, not when
 * it is built: `build/emcc/CMakeLists.txt` asks for
 * `scan_backends (wasmlib WASM)`, so a backend enters the library when its
 * `<X>_BACKEND` value carries the WASM keyword -- `regular.cmake` gives that
 * keyword to AssemblyScript, Cmajor and wasm, `all.cmake` to wasm alone.
 *
 * Nothing in this repository can see that decision: the library arrives as
 * three opaque files. A build made against a differently configured tree drops
 * a backend without a word, and the loss surfaces much later and elsewhere --
 * that is how the Cmajor backend went missing, and it took a failing
 * `faust2cmajor` in the CLI suite to say so.
 *
 * Cmajor has that cover. AssemblyScript has no CLI script and so had none at
 * all, which is what this file is for: ask the library for `-lang asc` and
 * require AssemblyScript back.
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    instantiateFaustModuleFromFile,
    LibFaust,
    FaustCompiler
} from '../../dist/esm/index.js';

const ROOT = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../..'
);

/** A DSP with a delay, so the generated code has to declare state. */
const CODE = 'process = _ : @(1);';

/** @type {any} */ let compiler;

before(async () => {
    const faustModule = await instantiateFaustModuleFromFile(
        path.join(ROOT, 'libfaust-wasm', 'libfaust-wasm.js')
    );
    compiler = new FaustCompiler(new LibFaust(faustModule));
});

/**
 * Generate one auxiliary file and read it back out of the compiler's own
 * filesystem, which is where the backends write.
 *
 * A backend that is not compiled in does not return false: it throws
 * "-lang <x> not supported since <X> backend is not built". Caught here so the
 * failure names the backend rather than showing a stack.
 *
 * @param {string} lang - the `-lang` keyword, e.g. `asc`.
 * @param {string} file - where the backend should write, inside that filesystem.
 * @returns {string} what it wrote.
 */
const generate = (lang, file) => {
    let generated;
    try {
        generated = compiler.generateAuxFiles(
            'probe',
            CODE,
            `-lang ${lang} -cn probe -o ${file}`
        );
    } catch (e) {
        assert.fail(`-lang ${lang} was refused: ${e.message.trim()}`);
    }
    assert.ok(generated, `-lang ${lang} reported failure`);
    return compiler.fs().readFile(file, { encoding: 'utf8' });
};

test('the AssemblyScript backend is compiled into libfaust-wasm', () => {
    const out = generate('asc', 'probe-asc.ts');
    // The backend's own header line: it says which language it just emitted.
    assert.match(out, /Language: AssemblyScript/);
    // And the code is really AssemblyScript, not another backend's output
    // under an .ts name: StaticArray and the explicit widths are its own.
    assert.match(out, /StaticArray</);
    assert.match(out, /: i32/);
    // -cn was honoured, so this is the class for the DSP we asked about.
    assert.match(out, /class probe/);
});
