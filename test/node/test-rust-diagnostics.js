import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
    FaustCompiler,
    FaustCompilerError,
    LibFaust,
    instantiateRustFaustModule
} from '../../dist/esm/index.js';

const wasmPath = process.env.FAUST_RS_WASM_MODULE;
assert.ok(
    wasmPath,
    'FAUST_RS_WASM_MODULE must name the libfaust-rs.wasm artifact under test'
);

const wasmBytes = await readFile(wasmPath);
const rawModule = await instantiateRustFaustModule(wasmBytes);

const compileFailure = async (compiler, name, source) => {
    try {
        await compiler.createMonoDSPFactory(name, source, '');
        assert.fail(`expected ${name} to fail`);
    } catch (error) {
        assert.ok(error instanceof FaustCompilerError);
        assert.ok(error.message.length > 0);
        return error;
    }
};

const compiler = new FaustCompiler(new LibFaust(rawModule));
const [parseError, evalError] = await Promise.all([
    compileFailure(compiler, 'diagnostics-parse.dsp', 'process = ;'),
    compileFailure(compiler, 'diagnostics-eval.dsp', 'process = missing;')
]);

const parseReport = parseError.getErrorDiagnostics();
const evalReport = evalError.getErrorDiagnostics();
assert.equal(parseReport?.schema_version, 2);
assert.equal(parseReport?.status, 'failed');
assert.equal(parseReport?.request.backend, 'wasm');
assert.ok(
    parseReport?.diagnostics.some(({ code }) => code.startsWith('FRS-PARSE-'))
);
assert.ok(parseReport?.sources.every(({ text }) => text === null));
assert.ok(
    evalReport?.diagnostics.some(({ code }) => code.startsWith('FRS-EVAL-'))
);
assert.notDeepEqual(
    parseReport?.diagnostics.map(({ code }) => code),
    evalReport?.diagnostics.map(({ code }) => code),
    'each rejected error must own the report for its own request'
);

const lastReport = compiler.getErrorDiagnostics();
assert.equal(lastReport?.schema_version, 2);

const warningFactory = await compiler.createMonoDSPFactory(
    'diagnostics-warning.dsp',
    'process = sqrt;',
    '--warn'
);
assert.ok(warningFactory);
const warningReport = compiler.getDiagnostics();
assert.equal(warningReport?.status, 'success');
assert.ok(
    warningReport?.diagnostics.some(
        ({ severity, facts }) =>
            severity === 'warning' &&
            facts.operation?.type === 'string' &&
            facts.operation.value === 'sqrt'
    )
);
assert.ok(warningReport?.sources.every(({ text }) => text === null));

const oldRawModule = Object.fromEntries(
    Object.entries(rawModule).filter(
        ([name]) =>
            name !== 'faust_wasm_result_get_error_diagnostics' &&
            name !== 'faust_wasm_result_get_diagnostics'
    )
);
const oldCompiler = new FaustCompiler(new LibFaust(oldRawModule));
const oldModuleError = await compileFailure(
    oldCompiler,
    'diagnostics-old-module.dsp',
    'process = ;'
);
assert.equal(oldModuleError.getErrorDiagnostics(), null);
assert.ok(oldCompiler.getErrorMessage().length > 0);

const malformedJson = new TextEncoder().encode('{"schema_version":2');
const malformedPtr = rawModule.faust_wasm_alloc(malformedJson.length);
new Uint8Array(rawModule.memory.buffer, malformedPtr, malformedJson.length).set(
    malformedJson
);
const malformedHandle = 0xfffffff0;
const malformedRawModule = {
    ...Object.fromEntries(Object.entries(rawModule)),
    faust_wasm_result_get_error_diagnostics: () => malformedHandle,
    faust_wasm_text_result_is_ok: (handle) =>
        handle === malformedHandle
            ? 1
            : rawModule.faust_wasm_text_result_is_ok(handle),
    faust_wasm_text_result_ptr: (handle) =>
        handle === malformedHandle
            ? malformedPtr
            : rawModule.faust_wasm_text_result_ptr(handle),
    faust_wasm_text_result_len: (handle) =>
        handle === malformedHandle
            ? malformedJson.length
            : rawModule.faust_wasm_text_result_len(handle),
    faust_wasm_text_result_free: (handle) => {
        if (handle !== malformedHandle) {
            rawModule.faust_wasm_text_result_free(handle);
        }
    }
};
const malformedCompiler = new FaustCompiler(new LibFaust(malformedRawModule));
const malformedError = await compileFailure(
    malformedCompiler,
    'diagnostics-malformed.dsp',
    'process = ;'
);
assert.equal(malformedError.getErrorDiagnostics(), null);
assert.ok(malformedError.message.length > 0);
rawModule.faust_wasm_dealloc(malformedPtr, malformedJson.length);

const invalidWasmLib = {
    createDSPFactory() {
        const data = new Uint8Array([0, 1, 2, 3]);
        return {
            cfactory: 0,
            data: {
                size: () => data.length,
                get: (index) => data[index] ?? 0,
                delete() {}
            },
            json: '{}'
        };
    },
    getDiagnostics: () => null,
    getErrorAfterException: () => '',
    getErrorDiagnosticsAfterException: () => null,
    cleanupAfterException() {}
};
const hostCompiler = new FaustCompiler(invalidWasmLib);
try {
    await hostCompiler.createMonoDSPFactory(
        'diagnostics-host-wasm.dsp',
        'process = 0;',
        ''
    );
    assert.fail('invalid host WASM bytes should fail');
} catch (error) {
    assert.ok(error instanceof WebAssembly.CompileError);
    assert.ok(!(error instanceof FaustCompilerError));
    assert.equal(hostCompiler.getErrorDiagnostics(), null);
}

console.log('rust structured diagnostics end-to-end: OK');
