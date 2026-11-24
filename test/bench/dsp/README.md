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

Four of them have a twin with the suffix `_fa`, the same program with its per-sample math
functions taken from `fastmath.lib` (`fa.ftanh`, `fa.fsin`, `fa.fsin2pi`, `fa.flinear2db`,
`fa.fdb2linear`, the accurate `fast` tier): `tanh_drive_fa`, `additive64_fa`, `fm_pad_fa`,
`compressor_fa`. The wasm backend calls every C math function in JavaScript (`Math.tanh`...),
while `fastmath.lib` is written in Faust and compiles to plain wasm instructions, so each pair
shows what the library gives on the web. Their outputs stay within -100 dB of the original.

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
