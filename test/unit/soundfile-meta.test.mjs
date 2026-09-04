/**
 * Finding the soundfiles a DSP asks for.
 *
 * `soundfile("Drone [url:{'a.flac'; 'b.flac'}]", 1)` puts a quoted, semicolon
 * separated list inside a metadata string, and `splitSoundfileNames` has to
 * get it back out before anything can be fetched. A name lost here is a file
 * never loaded, and the DSP then plays silence with no error anywhere.
 *
 * The parsing is pure, so most of this runs on strings. The extraction from a
 * whole DSP is checked against `test/soundfile1.dsp`, compiled for real, since
 * the shape of the metadata is the compiler's to decide, not ours.
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    instantiateFaustModuleFromFile,
    LibFaust,
    FaustCompiler,
    FaustBaseWebAudioDsp,
    SoundfileReader
} from '../../dist/esm/index.js';

const ROOT = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../..'
);

const split = (input) => FaustBaseWebAudioDsp.splitSoundfileNames(input);

// ------------------------------------------------------------ the splitting

test('a single quoted name comes back unquoted', () => {
    assert.deepEqual(split("{'kick.wav'}"), ['kick.wav']);
});

test('a list keeps its order', () => {
    assert.deepEqual(split("{'a.wav';'b.wav';'c.wav'}"), [
        'a.wav',
        'b.wav',
        'c.wav'
    ]);
});

test('the compiler emits its own delimiters, and that is what is parsed', () => {
    // What reaches this function is not the DSP source. The compiler
    // normalises `[url:{'a.flac'; 'b.flac'}]` into `{-a.flac-;-b.flac-}`:
    // quotes become dashes and the spacing goes. The parser is written for
    // that form.
    assert.deepEqual(split('{-a.flac-;-b.flac-}'), ['a.flac', 'b.flac']);
});

test('an entry padded with spaces keeps a delimiter', () => {
    // The first and last characters are removed before the trim, so a space
    // between the separator and the opening delimiter costs the name its
    // closing one instead. Unreachable today -- the compiler emits no such
    // spacing, as the test above shows -- but this is what would break if
    // that ever changed, and it would break silently, as a fetch for a file
    // whose name starts with a stray delimiter.
    assert.deepEqual(split("{'a.wav'; 'b.wav'}"), ['a.wav', "'b.wav"]);
});

test('names with spaces and directories survive', () => {
    assert.deepEqual(split("{'sounds/my kick.wav';'sub dir/snare.flac'}"), [
        'sounds/my kick.wav',
        'sub dir/snare.flac'
    ]);
});

test('an empty list yields nothing', () => {
    assert.deepEqual(split('{}'), []);
    assert.deepEqual(split(''), []);
});

test('empty entries are dropped rather than fetched', () => {
    // A trailing separator is easy to leave behind when editing the DSP; an
    // empty name would turn into a request for the containing directory.
    assert.deepEqual(split("{'a.wav';;'b.wav'}"), ['a.wav', 'b.wav']);
    assert.deepEqual(split("{'a.wav';''}"), ['a.wav']);
});

test('a name is stripped of one layer of quoting only', () => {
    // The first and last characters go, whatever they are, so a name that
    // was not quoted loses its ends. Pinned as the rule it is.
    assert.deepEqual(split("{'a.wav'}"), ['a.wav']);
    assert.deepEqual(split('{"a.wav"}'), ['a.wav']);
});

test('braces are optional', () => {
    assert.deepEqual(split("'a.wav';'b.wav'"), ['a.wav', 'b.wav']);
});

// -------------------------------------------------- extraction from a DSP

/** @type {any} */ let meta;

before(async () => {
    const faustModule = await instantiateFaustModuleFromFile(
        path.join(ROOT, 'libfaust-wasm', 'libfaust-wasm.js')
    );
    const compiler = new FaustCompiler(new LibFaust(faustModule));
    const code = fs.readFileSync(
        path.join(ROOT, 'test', 'soundfile1.dsp'),
        'utf8'
    );
    const factory = await compiler.createMonoDSPFactory(
        'soundfile1',
        code,
        '-ftz 2'
    );
    assert.ok(factory, 'the soundfile fixture has to compile');
    meta = JSON.parse(factory.json);
});

test('every declared soundfile is found in the metadata', () => {
    const found = Object.keys(SoundfileReader.findSoundfilesFromMeta(meta));
    // soundfile1.dsp declares two soundfiles of four names each.
    assert.equal(found.length, 8);
    assert.ok(found.includes('Alonepad_reverb_stereo_instru1.flac'));
    assert.ok(found.includes('String_freeze_stereo_instru2.flac'));
});

test('the found names are the ones to fetch, unquoted and untrimmed of path', () => {
    const found = Object.keys(SoundfileReader.findSoundfilesFromMeta(meta));
    for (const name of found) {
        assert.ok(!name.includes("'"), `${name} still carries a quote`);
        assert.equal(name, name.trim());
        assert.ok(name.length > 0);
    }
});

test('the map starts with nothing loaded', () => {
    const found = SoundfileReader.findSoundfilesFromMeta(meta);
    // Each name maps to null until something fetches it; a non-null entry
    // here would be taken for already-loaded audio.
    for (const value of Object.values(found)) assert.equal(value, null);
});

test('a DSP without soundfiles asks for none', async () => {
    const empty = { ui: [] };
    assert.deepEqual(SoundfileReader.findSoundfilesFromMeta(empty), {});
});

test('the same name declared twice is fetched once', () => {
    const twice = {
        ui: [
            {
                type: 'vgroup',
                label: 'g',
                items: [
                    { type: 'soundfile', label: 'a', url: "{'shared.wav'}" },
                    { type: 'soundfile', label: 'b', url: "{'shared.wav'}" }
                ]
            }
        ]
    };
    // The result is keyed by name, so two DSP-side references to one file
    // collapse into a single download.
    assert.deepEqual(
        Object.keys(SoundfileReader.findSoundfilesFromMeta(twice)),
        ['shared.wav']
    );
});

test('soundfiles nested in groups are found', () => {
    const nested = {
        ui: [
            {
                type: 'vgroup',
                label: 'outer',
                items: [
                    {
                        type: 'hgroup',
                        label: 'inner',
                        items: [
                            {
                                type: 'soundfile',
                                label: 's',
                                url: "{'deep.wav'}"
                            }
                        ]
                    }
                ]
            }
        ]
    };
    assert.deepEqual(
        Object.keys(SoundfileReader.findSoundfilesFromMeta(nested)),
        ['deep.wav']
    );
});

// ------------------------------------------------------------ fallback paths

test('with no location there are no fallback paths', () => {
    // In Node there is no document to be relative to, and the getter has to
    // cope rather than throw on the way to a clear error later.
    assert.deepEqual(SoundfileReader.fallbackPaths, []);
});

test('with a location the page, its folder and the origin are tried', () => {
    globalThis.location = {
        href: 'https://example.org/apps/synth/index.html',
        origin: 'https://example.org'
    };
    try {
        assert.deepEqual(SoundfileReader.fallbackPaths, [
            'https://example.org/apps/synth/index.html',
            'https://example.org/apps/synth/',
            'https://example.org'
        ]);
    } finally {
        delete globalThis.location;
    }
});
