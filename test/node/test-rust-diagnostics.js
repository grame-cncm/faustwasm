import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
    FaustCompiler,
    FaustCompilerError,
    LibFaust,
    instantiateFaustModuleFromFile,
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

const libFaust = new LibFaust(rawModule);
const compiler = new FaustCompiler(libFaust);
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
const parsePrimary = parseReport?.diagnostics
    .flatMap(({ labels }) => labels)
    .find(({ style }) => style === 'primary');
assert.ok(parsePrimary?.range);
assert.ok(parsePrimary.range.start <= parsePrimary.range.end);
assert.ok(
    parsePrimary.range.end <= new TextEncoder().encode('process = ;').length
);
assert.notDeepEqual(
    parseReport?.diagnostics.map(({ code }) => code),
    evalReport?.diagnostics.map(({ code }) => code),
    'each rejected error must own the report for its own request'
);
await compileFailure(compiler, 'diagnostics-parse.dsp', 'process = ;');

const fixError = await compileFailure(
    compiler,
    'diagnostics-fix.dsp',
    'filter(x) = x * 0.5;\nprocess = filtre;'
);
assert.ok(
    fixError
        .getErrorDiagnostics()
        ?.diagnostics.some(({ fixes }) => fixes.length > 0)
);

const traceError = await compileFailure(
    compiler,
    'diagnostics-trace.dsp',
    'foo = case { (0) => 1; };\nprocess = foo(2);'
);
assert.ok(
    traceError
        .getErrorDiagnostics()
        ?.diagnostics.some(({ traces }) => traces.length > 0)
);

libFaust.setVirtualSource(
    'diagnostics-virtual.lib',
    'foo = missing_from_virtual;'
);
const virtualError = await compileFailure(
    compiler,
    'diagnostics-import.dsp',
    'import("diagnostics-virtual.lib");\nprocess = foo;'
);
const virtualReport = virtualError.getErrorDiagnostics();
const virtualSource = virtualReport?.sources.find(
    ({ name }) => name === 'diagnostics-virtual.lib'
);
assert.ok(virtualSource);
assert.ok(
    virtualReport?.diagnostics.some(({ labels }) =>
        labels.some(({ range }) => range?.source_id === virtualSource.id)
    )
);

const remoteRootUrl = 'https://example.test/dsp/main.dsp';
const remoteChildUrl = 'https://example.test/dsp/lib/gain.lib';
const remoteRootSource = 'import("lib/gain.lib");\nprocess = remoteGain;';
libFaust.setRemoteSourceBundle(
    new Map([[remoteChildUrl, 'remoteGain(x) = x;']])
);
const firstRemoteFactory = await compiler.createMonoDSPFactory(
    remoteRootUrl,
    remoteRootSource,
    ''
);
assert.ok(firstRemoteFactory);

libFaust.setRemoteSource(remoteChildUrl, 'remoteGain(x) = x * 0.5;');
const changedRemoteFactory = await compiler.createMonoDSPFactory(
    remoteRootUrl,
    remoteRootSource,
    ''
);
assert.ok(changedRemoteFactory);
assert.notEqual(
    changedRemoteFactory.shaKey,
    firstRemoteFactory.shaKey,
    'changing a prefetched dependency must invalidate the factory cache'
);

libFaust.setRemoteSource(remoteChildUrl, null);
const missingRemoteError = await compileFailure(
    compiler,
    remoteRootUrl,
    remoteRootSource
);
assert.match(missingRemoteError.message, /lib\/gain\.lib/);

const backendError = await compileFailure(
    compiler,
    'diagnostics-codegen.dsp',
    'ext = fvariable(float extvar, <math.h>);\nprocess = ext;'
);
assert.ok(
    backendError
        .getErrorDiagnostics()
        ?.diagnostics.some(
            ({ stage, detail_code, facts }) =>
                stage === 'codegen' &&
                detail_code !== null &&
                facts.codegen_code?.type === 'string' &&
                facts.codegen_code.value === detail_code
        )
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

const cppModule = await instantiateFaustModuleFromFile(
    new URL('../../libfaust-wasm/libfaust-wasm.js', import.meta.url).pathname
);
const cppCompiler = new FaustCompiler(new LibFaust(cppModule));
const cppError = await compileFailure(
    cppCompiler,
    'diagnostics-cpp.dsp',
    'process = ;'
);
assert.equal(cppError.getErrorDiagnostics(), null);
assert.ok(cppError.message.length > 0);

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
