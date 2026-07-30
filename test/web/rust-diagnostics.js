// Browser regression test for the Rust compiler's structured diagnostics.
//
// Serve the `Developpements` directory so that both the faustwasm build and the
// faust-rs compiler artifact are reachable, then open rust-diagnostics.html.

import {
    FaustCompiler,
    FaustCompilerError,
    LibFaust,
    instantiateRustFaustModule
} from '../../dist/esm/index.js';

const result = document.getElementById('result');

const assert = (condition, message) => {
    if (!condition) {
        throw new Error(message);
    }
};

const compileFailure = async (compiler, name, source) => {
    try {
        await compiler.createMonoDSPFactory(name, source, '');
        throw new Error(`${name} unexpectedly compiled`);
    } catch (error) {
        assert(
            error instanceof FaustCompilerError,
            `${name} did not throw FaustCompilerError`
        );
        return error;
    }
};

try {
    const wasmUrl =
        '../../../../RUST/faust-rs/target/wasm32-unknown-unknown/release/libfaust-rs.wasm';
    const wasmResponse = await fetch(wasmUrl);
    assert(wasmResponse.ok, `cannot load ${wasmUrl}`);
    const rawModule = await instantiateRustFaustModule(
        await wasmResponse.arrayBuffer()
    );
    const compiler = new FaustCompiler(new LibFaust(rawModule));

    const [parseError, evalError] = await Promise.all([
        compileFailure(compiler, 'browser-parse.dsp', 'process = ;'),
        compileFailure(compiler, 'browser-eval.dsp', 'process = missing;')
    ]);
    const parseReport = parseError.getErrorDiagnostics();
    const evalReport = evalError.getErrorDiagnostics();

    assert(parseReport?.schema_version === 2, 'missing schema v2 report');
    assert(parseReport?.status === 'failed', 'wrong failure status');
    assert(
        parseReport?.diagnostics.some(({ code }) =>
            code.startsWith('FRS-PARSE-')
        ),
        'missing parser diagnostic'
    );
    assert(
        evalReport?.diagnostics.some(({ code }) =>
            code.startsWith('FRS-EVAL-')
        ),
        'missing evaluator diagnostic'
    );
    assert(
        parseReport !== evalReport,
        'concurrent failures unexpectedly share a report object'
    );

    await compiler.createMonoDSPFactory(
        'browser-warning.dsp',
        'process = sqrt;',
        '--warn'
    );
    const warningReport = compiler.getDiagnostics();
    assert(warningReport?.status === 'success', 'wrong success status');
    assert(
        warningReport?.diagnostics.some(
            ({ severity }) => severity === 'warning'
        ),
        'missing successful-compilation warning'
    );
    assert(
        warningReport?.sources.every(({ text }) => text === null),
        'FFI diagnostics unexpectedly disclose source text'
    );

    result.dataset.state = 'passed';
    result.textContent = 'PASS: Rust structured diagnostics';
} catch (error) {
    result.dataset.state = 'failed';
    result.textContent = `FAIL: ${error?.stack || error}`;
    throw error;
}
