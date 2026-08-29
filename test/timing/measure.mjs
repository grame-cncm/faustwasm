/**
 * Ask a Faust device to sound on a particular sample, and check that it did.
 *
 *   npm run measure
 *   npm run measure -- --runtime ../faustwasm-master/dist/esm/index.js
 *
 * The unit tests under test/unit cover the arithmetic in plain Node. This is
 * the other half: a real AudioWorklet in a real browser, rendering offline, so
 * what gets measured is the frame a control took effect on rather than the
 * frame the code intended.
 *
 * The device under test is compiled here and is one line:
 *
 *   process = button("gate");
 *
 * so the rendered signal is the gate itself, and an onset is a sample that
 * went from 0 to 1 -- no threshold to tune. What is under test is the wrapper,
 * and a DSP with an envelope would only add its attack to every number below.
 *
 * Three measurements:
 *
 *   onsets     gate.setValueAtTime(1, t) at non-block-aligned t
 *   retrigger  the same, with the gate dropped a few samples before the next
 *              hit so the 1 -> 0 -> 1 falls inside one 128-frame block
 *   keyOn      a polyphonic voice triggered by keyOn(ch, note, vel, time)
 *
 * Against 0.17.1 as published, the first is 0 to 127 frames late, the second
 * loses every hit whose gate drop shares a block with the hit after it, and
 * the third has no `time` to pass. Point --runtime at that build to see it;
 * without it, dist/esm/index.js is measured.
 *
 * Chromium comes from Playwright, which is not a dependency of this package:
 * `npm i -D playwright && npx playwright install chromium` to run this.
 */
import {
    instantiateFaustModuleFromFile,
    LibFaust,
    FaustCompiler
} from '../../dist/esm/index.js';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const SAMPLE_RATE = 48000;
const QUANTUM = 128;

/**
 * 6000 frames is 46.875 blocks, so the hits move through every phase of the
 * block rather than landing on the one alignment that would pass by luck.
 */
const SPACING = 6000;
const HITS = 16;

/** Wide enough that the gate is clearly down before the next hit. */
const GATE_WIDTH = 3 * QUANTUM;

/** Tight enough that the drop and the next hit share a block. */
const TIGHT_GAP = 8;

const runtimeArg = process.argv.indexOf('--runtime');
const RUNTIME = resolve(
    ROOT,
    runtimeArg === -1 ? 'dist/esm/index.js' : process.argv[runtimeArg + 1]
);

const PROBE = `declare name "Probe";
process = button("gate");
`;

let chromium;
try {
    ({ chromium } = await import('playwright'));
} catch {
    fail(
        'This needs a browser, and Playwright is not a dependency of this package:\n' +
            '  npm i -D playwright && npx playwright install chromium'
    );
}

// ---------------------------------------------------------------------------
// Compile the probe, and lift the voice mixer out of libfaust

const faustModule = await instantiateFaustModuleFromFile(
    join(ROOT, 'libfaust-wasm', 'libfaust-wasm.js')
);
const compiler = new FaustCompiler(new LibFaust(faustModule));

const mono = await compiler.createMonoDSPFactory('probe', PROBE, '-ftz 2');
if (!mono) fail(`probe failed to compile:\n${compiler.getErrorMessage()}`);
const poly = await compiler.createPolyDSPFactory('probe', PROBE, '-ftz 2');
if (!poly) fail(`probe poly failed to compile:\n${compiler.getErrorMessage()}`);
const mixer = compiler
    .fs()
    .readFile('/usr/rsrc/mixer32.wasm', { encoding: 'binary' });

// ---------------------------------------------------------------------------
// Serve it, plus the runtime under test

const files = {
    '/faustwasm.js': ['text/javascript', readFileSync(RUNTIME)],
    '/probe.wasm': ['application/wasm', Buffer.from(mono.code)],
    '/probe.json': ['application/json', Buffer.from(mono.json)],
    '/probe-poly.wasm': ['application/wasm', Buffer.from(poly.code)],
    '/probe-poly.json': ['application/json', Buffer.from(poly.json)],
    '/mixer32.wasm': ['application/wasm', Buffer.from(mixer)],
    // An AudioWorklet needs a document, and a module script needs an origin.
    '/': ['text/html', Buffer.from('<!doctype html><meta charset=utf-8>')]
};

const server = createServer((req, res) => {
    const entry = files[req.url];
    if (!entry) {
        res.writeHead(404).end();
        return;
    }
    res.writeHead(200, { 'content-type': entry[0] }).end(entry[1]);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

// ---------------------------------------------------------------------------
// Render

const browser = await chromium.launch();
const page = await browser.newPage();
page.on('console', (m) => {
    if (m.type() === 'error') console.error(`  page: ${m.text()}`);
});
await page.goto(origin);

const measured = await page.evaluate(measure, {
    sampleRate: SAMPLE_RATE,
    spacing: SPACING,
    hits: HITS,
    gateWidth: GATE_WIDTH,
    tightGap: TIGHT_GAP,
    quantum: QUANTUM
});

await browser.close();
server.close();

// ---------------------------------------------------------------------------
// Report

const expected = Array.from({ length: HITS }, (_, k) => k * SPACING);

console.log(relative(ROOT, RUNTIME));
console.log(
    `${HITS} hits, ${SPACING} frames apart (${(SPACING / QUANTUM).toFixed(3)} blocks), ${SAMPLE_RATE} Hz`
);

let failed = false;
for (const [name, onsets] of Object.entries(measured)) {
    if (onsets.error) {
        console.log(`  ${name.padEnd(10)} unavailable: ${onsets.error}`);
        // A runtime with no `time` to pass cannot be asked this question.
        // That is the finding, not a broken harness.
        if (name !== 'keyOn') failed = true;
        continue;
    }
    const errors = expected.map((frame, i) =>
        i < onsets.length ? onsets[i] - frame : null
    );
    const exact = errors.filter((e) => e === 0).length;
    const worst = Math.max(
        0,
        ...errors.filter((e) => e !== null).map(Math.abs)
    );
    console.log(
        `  ${name.padEnd(10)} ${onsets.length} of ${HITS} sounded, ` +
            `${exact} on the sample they asked for` +
            (worst ? `, worst ${worst} frames late` : '')
    );
    for (let i = 0; i < expected.length; i++) {
        if (errors[i] === null)
            console.log(`             hit ${i} never sounded`);
        else if (errors[i] !== 0)
            console.log(`             hit ${i} out by ${errors[i]} frames`);
    }
    if (onsets.length !== HITS || exact !== HITS) failed = true;
}

process.exit(failed ? 1 : 0);

// ---------------------------------------------------------------------------

/**
 * Everything below runs in the page.
 *
 * One function, because `page.evaluate` serialises it and nothing outside its
 * body is in scope over there -- which is why the config arrives as an
 * argument.
 */
async function measure({
    sampleRate,
    spacing,
    hits,
    gateWidth,
    tightGap,
    quantum
}) {
    const runtime = await import('/faustwasm.js');
    const length = (hits + 1) * spacing;

    const load = async (name) => {
        const [wasm, json] = await Promise.all([
            fetch(`/${name}.wasm`).then((r) => r.arrayBuffer()),
            fetch(`/${name}.json`).then((r) => r.text())
        ]);
        return {
            cfactory: 0,
            code: new Uint8Array(wasm),
            module: await WebAssembly.compile(wasm),
            json,
            poly: false,
            shaKey: name
        };
    };

    /**
     * The frames where the rendered gate went up.
     *
     * The render starts from silence, so frame 0 counts as an edge if the gate
     * is already up. A hit on the first sample is the one alignment every
     * implementation gets right, and omitting it would shift every later hit
     * by one and hide the error.
     */
    const risingEdges = (buffer) => {
        const data = buffer.getChannelData(0);
        const edges = [];
        let previous = 0;
        for (let i = 0; i < data.length; i++) {
            if (data[i] > 0.5 && previous <= 0.5) edges.push(i);
            previous = data[i];
        }
        return edges;
    };

    const context = () =>
        new OfflineAudioContext({ numberOfChannels: 1, length, sampleRate });

    const monoFactory = await load('probe');

    /** Schedule the gate as an AudioParam, the way a mono voice plays. */
    const renderMono = async (gap) => {
        const ctx = context();
        const generator = new runtime.FaustMonoDspGenerator();
        generator.name = 'probe';
        const node = await generator.createNode(ctx, 'probe', {
            ...monoFactory,
            // A fresh key per render: otherwise the second reuses the worklet
            // processor the first registered, AudioParams included.
            shaKey: `probe-${gap}`
        });
        node.connect(ctx.destination);
        const gate = node.parameters.get('/Probe/gate');
        for (let k = 0; k < hits; k++) {
            const on = k * spacing;
            gate.setValueAtTime(1, on / sampleRate);
            gate.setValueAtTime(
                0,
                (on + Math.min(gap, spacing - 1)) / sampleRate
            );
        }
        return risingEdges(await ctx.startRendering());
    };

    const results = {};

    try {
        results.onsets = await renderMono(gateWidth);
    } catch (e) {
        results.onsets = { error: String(e.message || e) };
    }

    try {
        results.retrigger = await renderMono(spacing - tightGap);
    } catch (e) {
        results.retrigger = { error: String(e.message || e) };
    }

    // A polyphonic voice is triggered by message, not by AudioParam: `gate`
    // is one of the paths the poly wrapper reserves. So this is the half of
    // the question `setValueAtTime` cannot ask.
    try {
        const polyFactory = await load('probe-poly');
        const mixer = await WebAssembly.compile(
            await fetch('/mixer32.wasm').then((r) => r.arrayBuffer())
        );
        const ctx = context();
        const generator = new runtime.FaustPolyDspGenerator();
        generator.name = 'probe-poly';
        const node = await generator.createNode(
            ctx,
            16,
            'probe-poly',
            polyFactory,
            mixer
        );
        node.connect(ctx.destination);
        if (node.keyOn.length < 4) {
            throw new Error('keyOn takes no time argument');
        }
        for (let k = 0; k < hits; k++) {
            const on = k * spacing;
            node.keyOn(0, 60, 100, on / sampleRate);
            node.keyOff(0, 60, 0, (on + gateWidth) / sampleRate);
        }
        // The messages must cross the port before rendering starts:
        // OfflineAudioContext renders as fast as it can and waits for
        // nothing.
        await new Promise((resolve) => setTimeout(resolve, 100 + quantum));
        results.keyOn = risingEdges(await ctx.startRendering());
    } catch (e) {
        results.keyOn = { error: String(e.message || e) };
    }

    return results;
}

function fail(message) {
    console.error(message);
    process.exit(1);
}
