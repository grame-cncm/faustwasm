# Programs of `npm run bench`

A subset of the 38 programs of [audio-dsl-bench](https://github.com/sletz/audio-dsl-bench)
(`dsp/NAME.dsp`, copied unchanged), at least one per category:

| Category | Programs |
| --- | --- |
| Oscillators and sources | `additive64`, `fm_pad` |
| Nonlinearities and dynamics | `tanh_drive`, `compressor` |
| Filters | `biquad8`, `moog_vcf` |
| Modulation and pitch | `phaser`, `pitch_shifter` |
| Spatialization and mixing | `hoa_octo` |
| Delays and reverbs | `zita_rev`, `greyhole` |
| Physical models | `clarinet`, `karplus` |

They are written for a benchmark: the gate of an instrument is a slider held at 1 rather than a
button, bypass switches are dropped, and defaults that would make a program trivial are changed
(see the README of audio-dsl-bench). `test/bench/wasm-vs-cpp.mjs` leaves every control at its
default, so a program added here must sound with its defaults.

To measure all 38, point the script at a checkout of audio-dsl-bench:

```bash
npm run bench -- ../audio-dsl-bench/dsp
```

These files are not in the `.dsp` sweep of `test/cli` (it reads `test/` only, not its
subdirectories).
