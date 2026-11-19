/**
 * The QR code a host page shows for its pairing link, decoded.
 *
 * A QR code that looks right and decodes to nothing, or to the wrong link, is
 * the failure that matters here: the phone's camera would simply not react.
 * So the test reads the SVG back with a small decoder written for it, from
 * the QR Code standard (ISO/IEC 18004) rather than from the encoder: format
 * bits (both copies, and their BCH code), mask, the zigzag placement of the
 * codewords, the block interleaving, and the data segment. Error correction
 * is not exercised -- a freshly drawn code has no errors to correct -- so the
 * ECC codewords are only skipped.
 *
 * The decoder handles versions 1 to 10, byte and alphanumeric segments: what
 * a pairing link needs, and enough to fail loudly on anything else.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { qrCodeSvg } from '../../dist/remote/index.js';

// ------------------------------------------------------------------ decoder

/** The SVG's modules, with `border: 0`: grid[y][x] is true when dark. */
const modulesOf = (svg) => {
    const size = Number(svg.match(/viewBox="0 0 (\d+) \1"/)?.[1]);
    assert.ok(size > 0, 'no square viewBox');
    const grid = Array.from({ length: size }, () => Array(size).fill(false));
    for (const [, x, y] of svg.matchAll(/M(\d+),(\d+)h1v1h-1z/g))
        grid[Number(y)][Number(x)] = true;
    return grid;
};

/** Alignment pattern centres, versions 1 to 10 (ISO/IEC 18004, annex E). */
const ALIGNMENT = [
    null,
    [],
    [6, 18],
    [6, 22],
    [6, 26],
    [6, 30],
    [6, 34],
    [6, 22, 38],
    [6, 24, 42],
    [6, 26, 46],
    [6, 28, 50]
];

/** [ECC codewords per block, blocks], by level then version 1 to 10. */
const BLOCKS = {
    L: [null, [7, 1], [10, 1], [15, 1], [20, 1], [26, 1], [18, 2], [20, 2], [24, 2], [30, 2], [18, 4]],
    M: [null, [10, 1], [16, 1], [26, 1], [18, 2], [24, 2], [16, 4], [18, 4], [22, 4], [22, 5], [26, 5]],
    Q: [null, [13, 1], [22, 1], [18, 2], [26, 2], [18, 4], [24, 4], [18, 6], [22, 6], [20, 8], [24, 8]],
    H: [null, [17, 1], [28, 1], [22, 2], [16, 4], [22, 4], [28, 4], [26, 5], [26, 6], [24, 8], [28, 8]]
};

/** The level a format's two bits name. */
const LEVEL = { 0b01: 'L', 0b00: 'M', 0b11: 'Q', 0b10: 'H' };

const MASKS = [
    (x, y) => (x + y) % 2 === 0,
    (x, y) => y % 2 === 0,
    (x) => x % 3 === 0,
    (x, y) => (x + y) % 3 === 0,
    (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
    (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
    (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
    (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0
];

/** Whether 15 format bits are a valid BCH(15,5) codeword once unmasked. */
const validFormat = (bits) => {
    let rem = bits ^ 0x5412;
    for (let i = 14; i >= 10; i--) if ((rem >> i) & 1) rem ^= 0x537 << (i - 10);
    return rem === 0;
};

/** Decode a QR code's modules into its text, and tell what it was made of. */
const decode = (grid) => {
    const n = grid.length;
    const version = (n - 17) / 4;
    assert.ok(Number.isInteger(version) && version >= 1, `size ${n}`);
    assert.ok(version <= 10, `version ${version}: beyond this decoder`);
    const at = (x, y) => (grid[y][x] ? 1 : 0);

    // Format: two copies, which must agree and be a valid codeword
    let first = 0;
    let second = 0;
    const firstCopy = [
        [8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8],
        [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8]
    ];
    firstCopy.forEach(([x, y], i) => (first |= at(x, y) << i));
    for (let i = 0; i < 8; i++) second |= at(n - 1 - i, 8) << i;
    for (let i = 8; i < 15; i++) second |= at(8, n - 15 + i) << i;
    assert.equal(first, second, 'the two format copies disagree');
    assert.ok(validFormat(first), 'format bits fail their BCH check');
    const format = (first ^ 0x5412) >> 10;
    const level = LEVEL[format >> 3];
    const mask = format & 7;

    // Function modules: finders with separators and format areas, timing,
    // alignment patterns, version areas
    const fn = Array.from({ length: n }, () => Array(n).fill(false));
    const mark = (x0, y0, x1, y1) => {
        for (let y = y0; y <= y1; y++)
            for (let x = x0; x <= x1; x++) fn[y][x] = true;
    };
    mark(0, 0, 8, 8);
    mark(n - 8, 0, n - 1, 8);
    mark(0, n - 8, 8, n - 1);
    mark(6, 0, 6, n - 1);
    mark(0, 6, n - 1, 6);
    const centres = ALIGNMENT[version] ?? [];
    for (const cx of centres)
        for (const cy of centres) {
            const last = centres.length - 1;
            const onFinder =
                (cx === centres[0] && cy === centres[0]) ||
                (cx === centres[0] && cy === centres[last]) ||
                (cx === centres[last] && cy === centres[0]);
            if (!onFinder) mark(cx - 2, cy - 2, cx + 2, cy + 2);
        }
    if (version >= 7) {
        mark(n - 11, 0, n - 9, 5);
        mark(0, n - 11, 5, n - 9);
    }

    // Codeword bits: column pairs from the right, the first going up, then
    // alternating, the timing column skipped; mask removed on the way
    const bits = [];
    let upward = true;
    for (let right = n - 1; right >= 1; right -= 2) {
        if (right === 6) right = 5;
        for (let step = 0; step < n; step++) {
            const y = upward ? n - 1 - step : step;
            for (const x of [right, right - 1]) {
                if (fn[y][x]) continue;
                bits.push(at(x, y) ^ (MASKS[mask](x, y) ? 1 : 0));
            }
        }
        upward = !upward;
    }
    const raw = Math.floor(bits.length / 8);
    const codewords = Array.from({ length: raw }, (_, i) =>
        bits.slice(i * 8, i * 8 + 8).reduce((byte, bit) => (byte << 1) | bit, 0)
    );

    // Blocks: data codewords interleaved first, short blocks first
    const [eccPerBlock, blocks] = BLOCKS[level][version] ?? [0, 0];
    const shortBlocks = blocks - (raw % blocks);
    const shortData = Math.floor(raw / blocks) - eccPerBlock;
    const dataLength = (j) => shortData + (j < shortBlocks ? 0 : 1);
    const perBlock = Array.from(
        { length: blocks },
        () => /** @type {number[]} */ ([])
    );
    let k = 0;
    for (let i = 0; i <= shortData; i++)
        for (let j = 0; j < blocks; j++)
            if (i < dataLength(j)) perBlock[j].push(codewords[k++]);
    const data = perBlock.flat();

    // The segment
    let position = 0;
    const read = (count) => {
        let value = 0;
        for (let i = 0; i < count; i++) {
            const byte = data[(position + i) >> 3];
            value = (value << 1) | ((byte >> (7 - ((position + i) & 7))) & 1);
        }
        position += count;
        return value;
    };
    const mode = read(4);
    if (mode === 0b0100) {
        const length = read(version <= 9 ? 8 : 16);
        const bytes = Uint8Array.from({ length }, () => read(8));
        return { text: new TextDecoder().decode(bytes), version, level, mode: 'byte' };
    }
    if (mode === 0b0010) {
        const CHARSET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';
        let length = read(version <= 9 ? 9 : 11);
        let text = '';
        for (; length >= 2; length -= 2) {
            const pair = read(11);
            text += CHARSET[Math.floor(pair / 45)] + CHARSET[pair % 45];
        }
        if (length === 1) text += CHARSET[read(6)];
        return { text, version, level, mode: 'alphanumeric' };
    }
    assert.fail(`segment mode ${mode} is beyond this decoder`);
};

// -------------------------------------------------------------------- tests

/** What a host page shows: its address, the PWA, a 6-byte room, a 16-byte token. */
const PAIRING =
    'https://192.168.1.43:8443/remote/index.html#room=2bc5b6557a35&token=0e8f8f8d2ab3da8bb37ae2f2e69494e3';

test('a pairing link decodes back to itself', () => {
    const decoded = decode(modulesOf(qrCodeSvg(PAIRING, { border: 0 })));
    assert.equal(decoded.text, PAIRING);
    assert.equal(decoded.mode, 'byte');
});

test('texts of other kinds and lengths decode back to themselves', () => {
    for (const text of [
        'faust',
        'http://localhost:8443/remote/index.html#room=a&token=b',
        // Alphanumeric mode: upper case, digits and a few symbols only
        'HTTPS://FAUST.GRAME.FR/',
        // UTF-8 in byte mode
        'Télécommande Faust 🎛',
        `https://host.example.org:8443/remote/index.html#room=${'a'.repeat(12)}&token=${'0'.repeat(32)}&extra=${'x'.repeat(30)}`
    ]) {
        const decoded = decode(modulesOf(qrCodeSvg(text, { border: 0 })));
        assert.equal(decoded.text, text, `version ${decoded.version}`);
    }
});

test('every error correction level decodes', () => {
    for (const ecc of /** @type {const} */ (['low', 'medium', 'quartile', 'high'])) {
        const decoded = decode(modulesOf(qrCodeSvg(PAIRING, { border: 0, ecc })));
        assert.equal(decoded.text, PAIRING, ecc);
    }
});

test('the code is surrounded by its quiet zone, and scales', () => {
    const plain = modulesOf(qrCodeSvg(PAIRING, { border: 0 })).length;
    const svg = qrCodeSvg(PAIRING);
    assert.match(svg, new RegExp(`viewBox="0 0 ${plain + 8} ${plain + 8}"`));
    assert.match(svg, /shape-rendering="crispEdges"/);
    assert.doesNotMatch(svg, /width="\d+px"/);
});

test('the link is encoded, never written into the SVG', () => {
    const svg = qrCodeSvg('https://x/#token="/><script>alert(1)</script>');
    assert.doesNotMatch(svg, /script|token|alert/);
});

test('what cannot be drawn is refused', () => {
    assert.throws(() => qrCodeSvg(PAIRING, { dark: '"/><script>' }), RangeError);
    assert.throws(() => qrCodeSvg(PAIRING, { light: 'red"' }), RangeError);
    assert.throws(() => qrCodeSvg(PAIRING, { border: -1 }), RangeError);
    // Beyond what the largest QR code holds
    assert.throws(() => qrCodeSvg('x'.repeat(8000)), RangeError);
    // Colours as CSS writes them are accepted
    assert.ok(qrCodeSvg('x', { dark: 'rgb(10, 20, 30)', light: '#ffffff' }));
});
