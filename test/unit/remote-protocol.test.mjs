/**
 * The remote control protocol's parsing and chunking, on their own.
 *
 * These are internals of the remote bundle -- `src/remote/index.ts` does not
 * export them -- so the module is bundled here directly, as `sensors.test.mjs`
 * does for `FaustSensors`, rather than widening what the bundle exports.
 *
 * Parsing is the host's first line of defence: everything a remote control
 * sends goes through it, and what it lets past reaches a node. Chunking is
 * what lets a DSP of any size be described over a transport whose messages
 * are not.
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
const BUNDLE = path.join(ROOT, 'test', 'out', 'internals', 'remote-protocol.mjs');

/** @type {any} */ let protocol;

before(async () => {
    await esbuild.build({
        entryPoints: [path.join(ROOT, 'src', 'remote', 'protocol.ts')],
        outfile: BUNDLE,
        bundle: true,
        format: 'esm',
        target: 'es2019',
        logLevel: 'silent'
    });
    protocol = await import(pathToFileURL(BUNDLE).href);
});

const client = (message) =>
    protocol.parseClientMessage(JSON.stringify(message));
const host = (message) => protocol.parseHostMessage(JSON.stringify(message));

// ------------------------------------------------------------ remote to host

test('well-formed messages from a remote control are accepted', () => {
    for (const message of [
        { type: 'hello', v: 1, id: 'a', mode: 'bi' },
        { type: 'hello', v: 1, id: 'a', mode: 'uni', token: 't', hash: 'h' },
        { type: 'param', i: 0, value: 0.5 },
        { type: 'param', i: 3, value: -2, seq: 7 },
        { type: 'acc', x: 0, y: -9.8, z: 0.1, invert: false, seq: 1 },
        { type: 'gyr', alpha: 10, beta: 20, gamma: 30 },
        { type: 'midi', data: [0x90, 60, 100] },
        { type: 'ping', s: 1, t0: 12.5 },
        { type: 'bye' }
    ]) {
        assert.deepEqual(client(message), message, JSON.stringify(message));
    }
});

test('anything else from a remote control is refused', () => {
    for (const text of [
        'not json',
        '42',
        'null',
        '[]',
        JSON.stringify({ type: 'unknown' }),
        JSON.stringify({ type: 'hello', v: 1, id: 'a', mode: 'both' }),
        JSON.stringify({ type: 'hello', v: 1, mode: 'bi' }),
        JSON.stringify({ type: 'param', i: 1.5, value: 0 }),
        JSON.stringify({ type: 'param', i: -1, value: 0 }),
        JSON.stringify({ type: 'param', i: 0 }),
        JSON.stringify({ type: 'param', i: 0, value: '1' }),
        // What JSON makes of NaN and Infinity
        JSON.stringify({ type: 'param', i: 0, value: NaN }),
        JSON.stringify({ type: 'param', i: 0, value: 1, seq: -1 }),
        JSON.stringify({ type: 'acc', x: 0, y: 0, z: 0 }),
        JSON.stringify({ type: 'acc', x: 0, y: 0, z: null, invert: true }),
        JSON.stringify({ type: 'gyr', alpha: 0, beta: 0 }),
        JSON.stringify({ type: 'ping', s: 1 }),
        JSON.stringify({ type: 'welcome' })
    ]) {
        assert.equal(protocol.parseClientMessage(text), null, text);
    }
});

test('only MIDI channel voice messages pass', () => {
    const accepted = [
        [0x80, 60, 0],
        [0x9f, 127, 127],
        [0xa0, 60, 10],
        [0xb3, 7, 100],
        [0xc0, 5],
        [0xd0, 64],
        [0xe0, 0, 64]
    ];
    const refused = [
        [],
        [60, 100],
        [0xf0, 0x7e, 0xf7],
        [0xf8],
        [0x90, 60],
        [0x90, 60, 100, 1],
        [0xc0, 5, 1],
        [0x90, 128, 1],
        [0x90, 60, -1],
        [0x90, 60.5, 1],
        'string'
    ];
    for (const data of accepted)
        assert.equal(protocol.isChannelVoiceMessage(data), true, `${data}`);
    for (const data of refused)
        assert.equal(protocol.isChannelVoiceMessage(data), false, `${data}`);
});

// ------------------------------------------------------------ host to remote

test('a welcome must give a value for each input and each output', () => {
    const welcome = {
        type: 'welcome',
        v: 1,
        session: 's',
        mode: 'bi',
        json: '{}',
        inputs: ['/a', '/b'],
        outputs: ['/c'],
        values: [1, 2],
        outputValues: [0],
        voices: 0,
        rates: { out: 30 }
    };
    assert.deepEqual(host(welcome), welcome);
    assert.equal(host({ ...welcome, values: [1] }), null);
    assert.equal(host({ ...welcome, outputValues: [] }), null);
    assert.equal(host({ ...welcome, mode: 'x' }), null);
    assert.equal(host({ ...welcome, rates: null }), null);
});

test('a partial bargraph update must pair each value with an index', () => {
    assert.ok(host({ type: 'out', values: [0.1, 0.2] }));
    assert.ok(host({ type: 'out', values: [0.1], i: [3] }));
    assert.equal(host({ type: 'out', values: [0.1, 0.2], i: [3] }), null);
    assert.equal(host({ type: 'out', values: [null] }), null);
});

// ----------------------------------------------------------------- chunking

/** A text with every kind of character JSON or UTF-8 makes longer. */
const AWKWARD = 'quote " backslash \\ é 漢 \u0001 \n 🎛 '.repeat(200);

test('a message that fits is left whole', () => {
    assert.deepEqual(protocol.splitMessage('{"type":"bye"}', 1024, 1), [
        '{"type":"bye"}'
    ]);
});

test('a long message comes back whole from chunks that all fit', () => {
    for (const maxSize of [256, 1000, 16 * 1024]) {
        const chunks = protocol.splitMessage(AWKWARD, maxSize, 7);
        assert.ok(chunks.length > 1 || maxSize === 16 * 1024);
        for (const chunk of chunks) {
            const size = new TextEncoder().encode(chunk).length;
            assert.ok(size <= maxSize, `${size} bytes over ${maxSize}`);
        }
        if (chunks.length === 1) continue;
        const assembler = new protocol.FaustRemoteChunkAssembler();
        let whole = null;
        for (const chunk of chunks) {
            assert.equal(whole, null, 'the message was complete too early');
            whole = assembler.push(protocol.parseHostMessage(chunk));
        }
        assert.equal(whole, AWKWARD);
    }
});

test('chunks out of sequence are dropped, not spliced', () => {
    const chunks = protocol
        .splitMessage(AWKWARD, 512, 1)
        .map((chunk) => protocol.parseHostMessage(chunk));
    const assembler = new protocol.FaustRemoteChunkAssembler();
    assembler.push(chunks[0]);
    assert.equal(assembler.push(chunks[2]), null);
    // The rest of the broken message cannot complete it
    for (const chunk of chunks.slice(3)) assert.equal(assembler.push(chunk), null);
    // A message started afresh still assembles
    let whole = null;
    for (const chunk of chunks) whole = assembler.push(chunk);
    assert.equal(whole, AWKWARD);
});

test('an assembly past its size limit is abandoned', () => {
    const chunks = protocol
        .splitMessage(AWKWARD, 512, 1)
        .map((chunk) => protocol.parseHostMessage(chunk));
    const assembler = new protocol.FaustRemoteChunkAssembler(1000);
    let whole = null;
    for (const chunk of chunks) whole = assembler.push(chunk);
    assert.equal(whole, null);
});
