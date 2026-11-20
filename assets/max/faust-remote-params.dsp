// The phones' interface for faust-remote-params.maxpat, in Faust: widgets
// only, labelled as the patch's parameters, with what Max parameters cannot
// say (a sensor on freq, a bargraph). No sound: its output is silence.
//   faust2wasm-ts faust-remote-params.dsp params-app -remote
// then give faust-remote.js  ui params-app/dsp-meta.json
declare name "faust-remote-params";

freq = hslider("freq [acc: 0 0 -10 0 10]", 440, 110, 880, 1);
gain = hslider("gain", 0.2, 0, 1, 0.01);
play = checkbox("play");

// attach keeps the widgets in the interface without using their values
process = attach(0, attach(0, freq + gain + play) : hbargraph("level", 0, 1));
