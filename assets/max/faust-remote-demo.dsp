// The DSP of faust-remote-demo.maxpat, to generate the phones' remote
// control with the same DSP (and play it on the phone with "Play locally"):
//   faust2wasm-ts faust-remote-demo.dsp app -remote
declare name "faust-remote-demo";
import("stdfaust.lib");

freq = hslider("freq [acc: 0 0 -10 0 10]", 440, 110, 880, 1);
gain = hslider("gain", 0.2, 0, 1, 0.01);
play = checkbox("play");
level = an.amp_follower(0.1) : hbargraph("level", 0, 1);

process = os.osc(freq) * gain * play <: attach(_, level), _;
