/**
 * The accelerometer and gyroscope mapping.
 *
 * `[acc:0 1 -10 0 10]` on a slider means "drive me from the x axis, with the
 * Down curve, over this range". Turning that into a parameter value is pure
 * arithmetic in `FaustSensors`, roughly seven hundred lines of it, and nothing
 * exercised any of it. A wrong curve or an inverted segment produces no error
 * anywhere: the control simply responds backwards, or sticks, and only a
 * player notices.
 *
 * `FaustSensors` is internal -- `src/exports.ts` does not re-export it -- so it
 * is bundled here on its own rather than reached through `dist/esm`. That
 * keeps the test on the real source without widening the package's public API
 * just to be testable.
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';

const ROOT = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../..'
);
const BUNDLE = path.join(ROOT, 'test', 'out', 'internals', 'FaustSensors.mjs');

/** @type {any} */ let FaustSensors;
/** @type {any} */ let Axis;
/** @type {any} */ let Curve;

before(async () => {
    await esbuild.build({
        entryPoints: [path.join(ROOT, 'src', 'FaustSensors.ts')],
        outfile: BUNDLE,
        bundle: true,
        format: 'esm',
        target: 'es2019',
        logLevel: 'silent'
    });
    const mod = await import(pathToFileURL(BUNDLE).href);
    FaustSensors = mod.default;
    Axis = mod.Axis;
    Curve = mod.Curve;
});

/** Assert two numbers agree to within floating-point noise. */
const near = (actual, expected, message) =>
    assert.ok(
        Math.abs(actual - expected) < 1e-6,
        message ?? `${actual} is not near ${expected}`
    );

// ------------------------------------------------------------- enum decoding

test('an axis number maps to its axis', () => {
    assert.equal(FaustSensors.convertToAxis(0), Axis.x);
    assert.equal(FaustSensors.convertToAxis(1), Axis.y);
    assert.equal(FaustSensors.convertToAxis(2), Axis.z);
});

test('an unknown axis number falls back to x', () => {
    // Metadata comes from the DSP source and can say anything; the mapping
    // degrades to an axis rather than producing undefined.
    assert.equal(FaustSensors.convertToAxis(7), Axis.x);
    assert.equal(FaustSensors.convertToAxis(-1), Axis.x);
});

test('a curve number maps to its curve', () => {
    assert.equal(FaustSensors.convertToCurve(0), Curve.Up);
    assert.equal(FaustSensors.convertToCurve(1), Curve.Down);
    assert.equal(FaustSensors.convertToCurve(2), Curve.UpDown);
    assert.equal(FaustSensors.convertToCurve(3), Curve.DownUp);
});

test('an unknown curve number falls back to Up', () => {
    assert.equal(FaustSensors.convertToCurve(9), Curve.Up);
});

// -------------------------------------------------------------------- Range

test('a range orders its bounds', () => {
    const range = new FaustSensors.Range(10, -10);
    // Written high-to-low, which acc metadata does allow.
    assert.equal(range.fLo, -10);
    assert.equal(range.fHi, 10);
});

test('a range clips to its bounds and passes the inside through', () => {
    const range = new FaustSensors.Range(-1, 1);
    assert.equal(range.clip(-5), -1);
    assert.equal(range.clip(5), 1);
    assert.equal(range.clip(0.25), 0.25);
    // The bounds themselves are inside.
    assert.equal(range.clip(-1), -1);
    assert.equal(range.clip(1), 1);
});

// -------------------------------------------------------------- Interpolator

test('an interpolator maps its endpoints exactly', () => {
    const lerp = new FaustSensors.Interpolator(0, 10, 100, 200);
    near(lerp.returnMappedValue(0), 100);
    near(lerp.returnMappedValue(10), 200);
    near(lerp.returnMappedValue(5), 150);
});

test('an interpolator clips outside its range', () => {
    const lerp = new FaustSensors.Interpolator(0, 10, 100, 200);
    // Past the end the value holds rather than extrapolating: a sensor
    // reading beyond the declared range must not drive the parameter out of
    // its own bounds.
    near(lerp.returnMappedValue(-100), 100);
    near(lerp.returnMappedValue(1000), 200);
});

test('an interpolator maps downwards as readily as upwards', () => {
    const lerp = new FaustSensors.Interpolator(0, 10, 200, 100);
    near(lerp.returnMappedValue(0), 200);
    near(lerp.returnMappedValue(10), 100);
    near(lerp.returnMappedValue(5), 150);
});

test('a degenerate interpolator returns the midpoint instead of dividing by zero', () => {
    const lerp = new FaustSensors.Interpolator(5, 5, 100, 200);
    // lo === hi would be a division by zero; the value settles halfway.
    near(lerp.returnMappedValue(5), 150);
    near(lerp.returnMappedValue(-1000), 150);
    assert.ok(Number.isFinite(lerp.returnMappedValue(0)));
});

test('an interpolator reports the range it settled on', () => {
    const lerp = new FaustSensors.Interpolator(10, -10, 0, 1);
    assert.deepEqual(lerp.getLowHigh(0, 0), { amin: -10, amax: 10 });
});

// ----------------------------------------------------------- Interpolator3pt

test('a three-point interpolator hits all three points', () => {
    const lerp = new FaustSensors.Interpolator3pt(0, 5, 10, 0, 100, 0);
    near(lerp.returnMappedValue(0), 0);
    near(lerp.returnMappedValue(5), 100);
    near(lerp.returnMappedValue(10), 0);
});

test('a three-point interpolator is linear inside each segment', () => {
    const lerp = new FaustSensors.Interpolator3pt(0, 10, 20, 0, 10, 30);
    near(lerp.returnMappedValue(5), 5); // first segment: 0 -> 10
    near(lerp.returnMappedValue(15), 20); // second: 10 -> 30
});

test('the two segments agree at the midpoint', () => {
    const lerp = new FaustSensors.Interpolator3pt(0, 5, 10, 0, 50, 100);
    // Continuity: whichever segment claims the midpoint, the value is the
    // same, so the mapping has no step in it.
    near(lerp.returnMappedValue(5), 50);
    near(lerp.returnMappedValue(4.999), 49.99, 'just below the midpoint');
    near(lerp.returnMappedValue(5.001), 50.01, 'just above the midpoint');
});

test('the midpoint belongs to the upper segment', () => {
    // With amin === amid the lower segment is degenerate and answers with
    // its own midpoint, so the two segments finally disagree and the `x <
    // fMid` boundary becomes observable. This is not a contrived shape:
    // test/soundfile.dsp declares `[acc:0 0 0 0 10]`, which produces it.
    const lerp = new FaustSensors.Interpolator3pt(0, 0, 10, 100, 200, 300);
    // Degenerate lower segment would give (100 + 200) / 2 = 150.
    near(lerp.returnMappedValue(0), 200, 'the upper segment answers');
});

// -------------------------------------------------------------- the 4 curves

/** The four curves, with what each has to produce at min, mid and max. */
const CURVES = [
    // acc low -> parameter low, acc high -> parameter high
    { name: 'Up', curve: () => Curve.Up, at: [0, 50, 100] },
    // the mirror image
    { name: 'Down', curve: () => Curve.Down, at: [100, 50, 0] },
    // a peak in the middle
    { name: 'UpDown', curve: () => Curve.UpDown, at: [0, 100, 0] },
    // a trough in the middle
    { name: 'DownUp', curve: () => Curve.DownUp, at: [100, 0, 100] }
];

for (const { name, curve, at } of CURVES) {
    test(`the ${name} curve maps min, mid and max as it should`, () => {
        // Acc range -10..10 with 0 in the middle; parameter 0..100 with 50
        // as its init, which is the shape `[acc:0 c -10 0 10]` produces.
        const handler = FaustSensors.buildHandler(
            curve(),
            -10,
            0,
            10,
            0,
            50,
            100
        );
        near(handler.uiToFaust(-10), at[0], `${name} at min`);
        near(handler.uiToFaust(0), at[1], `${name} at mid`);
        near(handler.uiToFaust(10), at[2], `${name} at max`);
    });

    test(`the ${name} curve clips beyond the declared acc range`, () => {
        const handler = FaustSensors.buildHandler(
            curve(),
            -10,
            0,
            10,
            0,
            50,
            100
        );
        // A phone can report well past the range the DSP declared.
        near(handler.uiToFaust(-1000), at[0], `${name} far below`);
        near(handler.uiToFaust(1000), at[2], `${name} far above`);
    });
}

test('Up and Down are mirror images of each other', () => {
    const up = FaustSensors.buildHandler(Curve.Up, -10, 0, 10, 0, 50, 100);
    const down = FaustSensors.buildHandler(Curve.Down, -10, 0, 10, 0, 50, 100);
    for (const x of [-10, -7.5, -2, 0, 3, 8, 10]) {
        near(up.uiToFaust(x) + down.uiToFaust(x), 100, `mirror at ${x}`);
    }
});

test('UpDown and DownUp are mirror images of each other', () => {
    const upDown = FaustSensors.buildHandler(
        Curve.UpDown,
        -10,
        0,
        10,
        0,
        50,
        100
    );
    const downUp = FaustSensors.buildHandler(
        Curve.DownUp,
        -10,
        0,
        10,
        0,
        50,
        100
    );
    for (const x of [-10, -4, 0, 6, 10]) {
        near(upDown.uiToFaust(x) + downUp.uiToFaust(x), 100, `mirror at ${x}`);
    }
});

test('an unknown curve builds an Up handler', () => {
    const fallback = FaustSensors.buildHandler(42, -10, 0, 10, 0, 50, 100);
    const up = FaustSensors.buildHandler(Curve.Up, -10, 0, 10, 0, 50, 100);
    for (const x of [-10, 0, 10]) {
        near(fallback.uiToFaust(x), up.uiToFaust(x));
    }
});

// ------------------------------------------------------- the return journey

test('Up round-trips a parameter value back to the sensor range', () => {
    const handler = FaustSensors.buildHandler(Curve.Up, -10, 0, 10, 0, 50, 100);
    // faustToUi is what puts a parameter changed elsewhere back on the
    // sensor's scale, so the two directions have to agree.
    for (const x of [-10, -5, 0, 5, 10]) {
        near(handler.faustToUi(handler.uiToFaust(x)), x, `round trip at ${x}`);
    }
});

test('Down round-trips too', () => {
    const handler = FaustSensors.buildHandler(
        Curve.Down,
        -10,
        0,
        10,
        0,
        50,
        100
    );
    for (const x of [-10, -5, 0, 5, 10]) {
        near(handler.faustToUi(handler.uiToFaust(x)), x, `round trip at ${x}`);
    }
});

test('the folded curves map back over the whole range, not one half', () => {
    const handler = FaustSensors.buildHandler(
        Curve.UpDown,
        -10,
        0,
        10,
        0,
        50,
        100
    );
    // UpDown sends two sensor values to each parameter value, so it cannot be
    // inverted. The way back is a plain line across the range instead.
    near(handler.faustToUi(0), -10);
    near(handler.faustToUi(100), 10);
    near(handler.faustToUi(50), 0);
});

// -------------------------------------------------------------- active state

test('a handler starts active and can be switched off', () => {
    const handler = FaustSensors.buildHandler(Curve.Up, -10, 0, 10, 0, 50, 100);
    assert.equal(handler.getActive(), true);
    handler.setActive(false);
    assert.equal(handler.getActive(), false);
    handler.setActive(true);
    assert.equal(handler.getActive(), true);
});

// ------------------------------------------------------------- remapping

test('a handler can be given a new mapping after the fact', () => {
    const handler = FaustSensors.buildHandler(Curve.Up, -10, 0, 10, 0, 50, 100);
    near(handler.uiToFaust(10), 100);
    // This is what happens when a UI lets the player re-range a control.
    handler.setMappingValues(0, 5, 10, 0, 0.5, 1);
    near(handler.uiToFaust(0), 0);
    near(handler.uiToFaust(5), 0.5);
    near(handler.uiToFaust(10), 1);
});

test('a handler reports the acc range it is working over', () => {
    const handler = FaustSensors.buildHandler(Curve.Up, -10, 0, 10, 0, 50, 100);
    assert.deepEqual(handler.getMappingValues(-10, 0, 10), {
        amin: -10,
        amid: 0,
        amax: 10
    });
});
