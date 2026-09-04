# AGENTS.md

Guidance for AI coding agents working in this repository.

## What this is

`@grame/faustwasm` is the WebAssembly version of the [Faust](https://faust.grame.fr) compiler: it compiles Faust DSP source code to wasm in the browser or Node, and wraps the result in Web Audio nodes (AudioWorklet or ScriptProcessor, mono and polyphonic, plus FFT and offline processors). The npm package ships prebuilt bundles in `dist/`; the wasm compiler itself is the prebuilt `libfaust-wasm/` binary, not built from this repo.

## Layout

- `src/` — all TypeScript sources. Key files:
  - `FaustCompiler.ts`, `LibFaust.ts`, `FaustDspGenerator.ts` — compiling Faust code to wasm and creating nodes.
  - `FaustWebAudioDsp.ts` — the DSP runtime: mono/poly compute, voice allocation and stealing, sample-accurate event rendering.
  - `FaustAudioWorkletProcessor.ts` / `FaustAudioWorkletNode.ts` — the AudioWorklet pair; timed events queue on the processor side.
  - `FaustFFTAudioWorkletProcessor.ts` — FFT variant (block-granular control, not sample-accurate, by design).
- `scripts/` — CLI tools (`faust2wasm-ts`, `faust2svg-ts`, …) declared in `package.json` `bin`.
- `dist/` — build output (esbuild). Gitignored, so a fresh clone has none: build before running anything that imports it (the test scripts do it for you). It is *not* in `.npmignore`, so it is what the npm package actually ships. Do not edit by hand; rebuild instead.
- `test/` — see below.

## Build, test, lint

```bash
npm run build      # full build: cjs, esm, bundled variants, .d.ts
npm run build-esm  # fast build, enough for the unit tests
npm test           # build-esm + Node's test runner on test/unit/*.test.mjs
npm run test-cli   # build-esm + Node's test runner on test/cli/*.test.mjs
npm run test-all   # both suites
npm run lint       # prettier --check && eslint on src
npm run measure    # sample-accuracy measurement in headless Chromium
```

- Unit tests (`test/unit`) run in plain Node against `dist/esm`, with fakes for the wasm instance and the AudioWorklet scope (`test/unit/harness.mjs`). No browser needed. Always run `npm test` after touching `src/`.
- CLI tests (`test/cli`) spawn the scripts in `scripts/` as real processes and assert on what they write to disk: the output-mode matrix of `faust2wasm.js`, every `.dsp` in `test/` (compiled, then reloaded from the generated artifacts and rendered offline), and the include/argument/failure edges. They take a few seconds and write under `test/out`. `faust2svg`, `faust2cmajor` and `faust2sndfile` are covered as well. Run `npm run test-cli` after touching `scripts/`, any `src/faust2*Files.js`, `src/copyWebStandaloneAssets.js` or `assets/standalone/`.
  - The `.dsp` fixtures are discovered, not listed: dropping one into `test/` adds it to the sweep. A fixture that needs extra flags to compile goes in `DSP_EXTRA_ARGS` in `test/cli/runner.mjs` (as `foo.dsp` does, which needs `-I test/includes`).
  - The expected file set per mode lives in `test/cli/expected.mjs`; adding an asset to `assets/standalone/` means updating it.
- `npm run measure` needs Playwright, which is deliberately **not** a dependency: `npm i --no-save playwright && npx playwright install chromium`. Keep it that way.
- `test/node` holds standalone smoke scripts (`node test/node/test.js`) and `test/web` manual browser pages; they are not part of `npm test`.
- `instantiateFaustModuleFromFile` writes a uniquely-named wrapper module next to `libfaust-wasm.js` and deletes it after import. The unique name is what makes concurrent compilations safe; do not go back to a fixed one.

## Conventions and invariants

- Formatting is prettier's; run `npm run lint` before committing.
- No new runtime dependencies without explicit maintainer approval; the package is meant to stay lean.
- `FaustAudioWorkletProcessor` code runs on the audio thread: no allocation in the per-block path (buffers and event arrays are reused), no throwing out of `process` (a throw kills the node for good).
- Timed events must keep these invariants: events taken off the queue are always applied, even when `compute` returns early; timestamps are finite whole frames; a panic (CC 120/123, `instanceClear`, `stop`, `destroy`) flushes pending events.
- Polyphony: voice stealing picks the voice with the smallest global allocation date (`fDate` on `FaustPolyWebAudioDsp`); stolen voices render their crossfade over the whole block. Regression tests in `test/unit/voice-steal.test.mjs` and `voice-legato.test.mjs`.
- The mono/poly behavior is expected to stay bit-identical to the published package unless the change is deliberate — `npm run measure` and the unit tests are the safety net.

## Related repositories

The C++ Faust compiler lives in [grame-cncm/faust](https://github.com/grame-cncm/faust); fixes to shared logic (e.g. `architecture/faust/dsp/poly-dsp.h` voice allocation) usually need porting between the two, in both directions. Check whether a change here has a C++ counterpart, and say so in the commit message.
