/**
 * Reading and writing parameters by name.
 *
 * A host addresses a control by its full path, its shortname, or its label,
 * and the three have to land on the same value. This was covered only by
 * `test/node/test-param-aliases.js`, a standalone script no npm script ran, so
 * the aliasing was public API that nothing checked.
 *
 * Unlike the rest of test/unit this compiles a real DSP through libfaust and
 * instantiates real wasm, because the path table is built from the compiler's
 * own JSON and a fake would only re-state what the test asserts. It costs a
 * few hundred milliseconds.
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    instantiateFaustModuleFromFile,
    LibFaust,
    FaustCompiler,
    FaustWasmInstantiator,
    FaustMonoWebAudioDsp
} from '../../dist/esm/index.js';

const ROOT = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../..'
);
const SAMPLE_RATE = 48000;
const BLOCK = 128;

const DSP_CODE = `
import("stdfaust.lib");
freq = hslider("Freq[Hz]", 440, 20, 20000, 1);
gain = hslider("Gain[dB]", -6, -60, 6, 0.1) : ba.db2linear;
process = os.osc(freq) * gain;
`;

/** @type {any} */ let compiler;
/** @type {any} */ let factory;

before(async () => {
    const faustModule = await instantiateFaustModuleFromFile(
        path.join(ROOT, 'libfaust-wasm', 'libfaust-wasm.js')
    );
    compiler = new FaustCompiler(new LibFaust(faustModule));
    factory = await compiler.createMonoDSPFactory('alias', DSP_CODE, '-ftz 2');
    assert.ok(factory, 'the fixture DSP has to compile');
});

/** A fresh DSP, so a test cannot inherit another's parameter values. */
const makeDsp = async () => {
    const instance =
        await FaustWasmInstantiator.createAsyncMonoDSPInstance(factory);
    return new FaustMonoWebAudioDsp(
        instance,
        SAMPLE_RATE,
        4,
        BLOCK,
        factory.soundfiles || {}
    );
};

/** Render one block and return it. */
const render = (dsp) => {
    const out = [new Float32Array(BLOCK)];
    dsp.start();
    dsp.compute([], out);
    dsp.stop();
    return Array.from(out[0]);
};

const near = (actual, expected, message) =>
    assert.ok(
        Math.abs(actual - expected) < 1e-4,
        message ?? `${actual} is not near ${expected}`
    );

// ------------------------------------------------------------- the compiler

test('the compiler reports a version', () => {
    // The lowest-level smoke there is, and what test/node/test.js only
    // printed: the wasm compiler loaded and answers.
    assert.match(compiler.version(), /^\d+\.\d+\.\d+/);
});

// ------------------------------------------------------------- descriptors

test('every control carries an address, a shortname and a label', async () => {
    const dsp = await makeDsp();
    const controls = dsp
        .getDescriptors()
        .filter((item) => ['hslider', 'vslider', 'nentry'].includes(item.type));
    assert.equal(controls.length, 2);
    for (const control of controls) {
        assert.ok(control.address, 'address');
        assert.ok(control.shortname, 'shortname');
        assert.ok(control.label, 'label');
    }
});

test('getParams lists the input paths', async () => {
    const dsp = await makeDsp();
    assert.deepEqual(dsp.getParams(), ['/alias/Freq', '/alias/Gain']);
});

test('a control starts at the init value the source declares', async () => {
    const dsp = await makeDsp();
    near(dsp.getParamValue('/alias/Freq'), 440);
    near(dsp.getParamValue('/alias/Gain'), -6);
});

// ------------------------------------------------------------- the aliases

test('a value set by address reads back by address', async () => {
    const dsp = await makeDsp();
    dsp.setParamValue('/alias/Freq', 123);
    near(dsp.getParamValue('/alias/Freq'), 123);
});

test('the three names address the same value', async () => {
    const dsp = await makeDsp();
    const [control] = dsp.getDescriptors();

    // Written under one name, readable under all three: this is the whole
    // point of the aliases.
    dsp.setParamValue(control.address, 0.123);
    near(dsp.getParamValue(control.address), 0.123, 'address');
    near(dsp.getParamValue(control.shortname), 0.123, 'shortname');
    near(dsp.getParamValue(control.label), 0.123, 'label');

    dsp.setParamValue(control.shortname, 0.456);
    near(dsp.getParamValue(control.address), 0.456, 'shortname -> address');

    dsp.setParamValue(control.label, 0.789);
    near(dsp.getParamValue(control.address), 0.789, 'label -> address');
});

test('the aliases of one control do not disturb another', async () => {
    const dsp = await makeDsp();
    dsp.setParamValue('Freq', 1000);
    dsp.setParamValue('Gain', -20);
    near(dsp.getParamValue('/alias/Freq'), 1000);
    near(dsp.getParamValue('/alias/Gain'), -20);
});

// ------------------------------------------------------------ the contract

test('a value outside the declared range is stored as given', async () => {
    const dsp = await makeDsp();
    // Faust declares 20..20000 for Freq, and nothing clamps: the range is
    // guidance for a UI, not a guarantee the DSP enforces. Pinned because a
    // host relying on clamping here would be wrong.
    dsp.setParamValue('/alias/Freq', 999999);
    near(dsp.getParamValue('/alias/Freq'), 999999);
    dsp.setParamValue('/alias/Freq', -999999);
    near(dsp.getParamValue('/alias/Freq'), -999999);
});

test('an unknown path is ignored rather than written somewhere', async () => {
    const reference = render(await makeDsp());

    const dsp = await makeDsp();
    // Regression: an unmapped path reached wasm as `undefined`, coerced to
    // offset 0, so this wrote over the head of the DSP struct. The first
    // sample of the next block came out as 12345 instead of 0 -- a
    // full-scale click from nothing but a typo in a parameter name.
    dsp.setParamValue('/alias/Freqq', 12345);
    assert.deepEqual(render(dsp), reference);
});

test('an unknown path reads back as zero, not as memory', async () => {
    const dsp = await makeDsp();
    // Reading alone proves little: offset 0 of a fresh DSP holds 0 anyway.
    // Writing first is what separates the two worlds -- unguarded, the write
    // landed at offset 0 and this read handed it straight back.
    dsp.setParamValue('/alias/nope', 12345);
    assert.equal(dsp.getParamValue('/alias/nope'), 0);
    dsp.setParamValue('', 999);
    assert.equal(dsp.getParamValue(''), 0);
});

test('a typo does not disturb the control it resembles', async () => {
    const dsp = await makeDsp();
    dsp.setParamValue('/alias/Freq', 880);
    dsp.setParamValue('/alias/Freqq', 12345);
    near(dsp.getParamValue('/alias/Freq'), 880);
});

test('a real path still works after an unknown one', async () => {
    const dsp = await makeDsp();
    dsp.setParamValue('/alias/nope', 1);
    dsp.setParamValue('/alias/Freq', 660);
    near(dsp.getParamValue('/alias/Freq'), 660);
});

// -------------------------------------------------------- effect on output

test('setting a parameter changes what the DSP renders', async () => {
    const quiet = await makeDsp();
    quiet.setParamValue('/alias/Gain', -60);
    const soft = render(quiet);

    const loud = await makeDsp();
    loud.setParamValue('/alias/Gain', 6);
    const hard = render(loud);

    // Otherwise every assertion above could pass against a path table that
    // stores values and never reaches the DSP.
    const peak = (block) => Math.max(...block.map(Math.abs));
    assert.ok(peak(hard) > peak(soft) * 10, 'gain did not reach the DSP');
});

test('a parameter set by shortname reaches the DSP too', async () => {
    const dsp = await makeDsp();
    dsp.setParamValue('Gain', -60);
    const soft = render(dsp);

    const other = await makeDsp();
    other.setParamValue('/alias/Gain', -60);
    // The alias must be the same write, not a parallel bookkeeping entry.
    assert.deepEqual(soft, render(other));
});
