# Feature flags memory Optimization

This change introduces minimal plumbing that lets the Faust worklet runtime know
which optional helpers (MIDI, accelerometer, gyroscope and soundfiles) are
actually needed by a compiled patch.

## What changed

- `types.ts` now exposes a `FaustFeatureFlags` shape describing the five feature
  switches (MIDI, accelerometer, gyroscope, soundfiles and polyphonic mode).
- `FaustBaseWebAudioDsp` gained `detectFeatures` and `mergeFeatureFlags`
  helpers. They reuse the existing UI traversal code to sniff metadata and
  soundfile widgets directly from the Faust JSON description.
- `FaustDspGenerator` calls the detector for every mono and poly factory. The
  resulting flags are serialized into `faustData` so the AudioWorklet side can
  make decisions without parsing JSON again.
- `FaustAudioWorkletProcessor` receives those flags and only installs the sensor
  communicator when accelerometer or gyroscope bindings are present. Polyphonic
  bindings can also toggle whether the poly processor class is serialized.
- `FaustDspGenerator` also rewrites the `processorCode` templates so runtime
  helpers are injected on demand: `Soundfile`/`WasmAllocator` only land when
  `soundfile` UI items exist, and the sensor communicator stack is skipped when
  accelerometer/gyroscope metadata is absent. It also aliases every runtime
  helper back to its public name so the processor code keeps working even when
  bundlers mangle class names. This keeps per-DSP blobs small _and_ reliable.

These additions are intentionally lightweight so that subsequent changes can
toggle code generation (for example skipping the sensor classes entirely) using
the same flags.

## Impact

Representative `processorCode` byte sizes (from `test/node/test-features.js`
on the current codebase). Percent values show reduction versus the unoptimized
baseline:

| hasMidi | hasAcc | hasGyr | hasSoundFile | hasPoly | unoptimized | optimized | % |
|---------|--------|--------|--------------|---------|-------------|-----------|---|
| no      | no     | no     | no           | no      | ~70 kB      | ~47 kB    | 33% |
| no      | no     | no     | yes          | no      | ~70 kB      | ~56 kB    | 20% |
| no      | yes    | yes    | no           | no      | ~70 kB      | ~61 kB    | 13% |
| yes     | no     | no     | no           | no      | ~70 kB      | ~47 kB    | 33% |
| yes     | no     | no     | no           | yes     | ~86 kB      | ~63 kB    | 27% |
| yes     | no     | no     | yes          | yes     | ~86 kB      | ~73 kB    | 15% |
| yes     | yes    | no     | yes          | yes     | ~86 kB      | ~80 kB    | 7% |
| yes     | no     | yes    | yes          | yes     | ~86 kB      | ~80 kB    | 7% |
| yes     | yes    | yes    | yes          | yes     | ~87 kB      | ~87 kB    | ~0% |

This optimization significantly reduces the memory footprint and initial load time
for DSPs that don't use all features, addressing the concerns raised in issue #32.
