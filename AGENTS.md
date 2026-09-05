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
  - `sensors.test.mjs` covers a module `src/exports.ts` does not re-export, so it bundles `src/FaustSensors.ts` with esbuild into `test/out/internals/` and imports that. Do the same for other internals: never widen `src/exports.ts` to make something testable, since anything exported becomes a compatibility commitment.
  - `script-processor.test.mjs` installs a fake `globalThis.ScriptProcessorNode` *before* importing the bundle, because `FaustScriptProcessorNode` extends that global at module evaluation time. It also redefines `navigator` with `Object.defineProperty`: Node 22 owns that global as a getter-only accessor, so assignment throws.
  - `node-render.test.mjs` is the end-to-end one: it creates real nodes with `createNode` -- both kinds, mono and poly -- and renders them, asserting they produce samples rather than silence. `test/unit/web-audio.mjs` supplies the missing browser half (an `AudioContext`, `AudioWorkletNode`, `ScriptProcessorNode`, `AudioParam`, and an `audioWorklet.addModule` that evaluates the generated processor source in-process), so the serialisation of the DSP classes into the worklet module is exercised for real. Same rule as above: the globals go in before the bundle is imported, hence the dynamic import. It has no graph -- `renderNode` calls a node's own render entry point block by block, which is all the browser does to a connected node.
  - `FaustSensors` in particular should stay internal. The public sensor API is on the node (`hasAccInput`/`hasGyrInput`, `propagateAcc`/`propagateGyr`, `startSensors`/`stopSensors`) and it is complete on its own. The handlers `buildHandler` produces are closures pushed into the `protected` `fAcc`/`fGyr` on `FaustBaseWebAudioDsp`, reachable from nowhere else, and under AudioWorklet the mapping runs on the audio thread: the node sends raw sensor values through the communicator and the processor applies them, with `FaustSensors` injected into the generated processor as source text rather than imported. An exported copy on the main thread would duplicate the mapping, not drive it. If a host ever needs the curve (to draw it, say), that wants a purpose-built API, not this class.
- `npm run lint-tests` type-checks `test/unit` and `test/cli` (tsconfig.test.json). It catches, before anything runs, a wrong argument the callee happens to tolerate -- the mistake that a green test hides best. Run it alongside `npm run lint`.
- `npm run test-mutants` breaks `src/` on purpose, one edit at a time, and requires the named test file to go red for each. A survivor means that test proves less than its name claims; both times it found one here, the test was the thing that needed rewriting. The list in `test/mutants.mjs` is curated, not generated -- add to it when a test is written for a bug worth never seeing again. On demand, not per commit.
- CLI tests (`test/cli`) spawn the scripts in `scripts/` as real processes and assert on what they write to disk: the output-mode matrix of `faust2wasm.js`, every `.dsp` in `test/` (compiled, then reloaded from the generated artifacts and rendered offline), and the include/argument/failure edges. They take a few seconds and write under `test/out`, which `test/cleanup.mjs` removes afterwards (wired as `posttest`/`posttest-cli`, and as `prepack` so a scratch directory can never reach a tarball). npm skips a post hook when the script failed, so a failing run keeps its output for inspection. `faust2svg`, `faust2cmajor` and `faust2sndfile` are covered as well. Run `npm run test-cli` after touching `scripts/`, any `src/faust2*Files.js`, `src/copyWebStandaloneAssets.js` or `assets/standalone/`.
  - The `.dsp` fixtures are discovered, not listed: dropping one into `test/` adds it to the sweep. A fixture that needs extra flags to compile goes in `DSP_EXTRA_ARGS` in `test/cli/runner.mjs` (as `foo.dsp` does, which needs `-I test/includes`).
  - The expected file set per mode lives in `test/cli/expected.mjs`; adding an asset to `assets/standalone/` means updating it.
- `npm run measure` needs Playwright, which is deliberately **not** a dependency: `npm i --no-save playwright && npx playwright install chromium`. Keep it that way.
- `test/web` holds manual browser pages; they are not part of `npm test`. (`test/node` used to hold smoke scripts no npm script ran; they are now `test/unit/param-api.test.mjs`.)
- `instantiateFaustModuleFromFile` writes a uniquely-named wrapper module next to `libfaust-wasm.js` and deletes it after import. The unique name is what makes concurrent compilations safe; do not go back to a fixed one.

## Conventions and invariants

- Formatting is prettier's; run `npm run lint` before committing.
- No new runtime dependencies without explicit maintainer approval; the package is meant to stay lean.
- `FaustAudioWorkletProcessor` code runs on the audio thread: no allocation in the per-block path (buffers and event arrays are reused), no throwing out of `process` (a throw kills the node for good).
- Timed events must keep these invariants: events taken off the queue are always applied, even when `compute` returns early; timestamps are finite whole frames; a panic (CC 120/123, `instanceClear`, `stop`, `destroy`) flushes pending events.
- Polyphony: voice stealing picks the voice with the smallest global allocation date (`fDate` on `FaustPolyWebAudioDsp`); stolen voices render their crossfade over the whole block. Regression tests in `test/unit/voice-steal.test.mjs` and `voice-legato.test.mjs`.
- `test/unit/paths-agree.test.mjs` renders the same DSP down two routes and requires them to match sample for sample: offline against AudioWorklet, and the mono DSP against one polyphonic voice. It tests the glue rather than the wasm, and needs no regenerating when libfaust moves, since both sides move together. Note what it cannot catch: a change in code *shared* by both routes shifts them equally and stays green, which is what the direct unit tests above are for.
- The mono/poly behavior is expected to stay bit-identical to the published package unless the change is deliberate — `npm run measure` and the unit tests are the safety net.

## Related repositories

The C++ Faust compiler lives in [grame-cncm/faust](https://github.com/grame-cncm/faust); fixes to shared logic (e.g. `architecture/faust/dsp/poly-dsp.h` voice allocation) usually need porting between the two, in both directions. Check whether a change here has a C++ counterpart, and say so in the commit message.
