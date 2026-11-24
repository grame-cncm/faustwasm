import("stdfaust.lib");
// examples/pitchShifting/pitchShifter.dsp: ef.transpose(window, xfade, shift) with the example's
// slider defaults and ranges, except the shift: 5 semitones instead of 0, so that the taps move.
window = hslider("window", 1000, 50, 10000, 1);
xfade = hslider("xfade", 10, 1, 10000, 1);
shift = hslider("shift", 5, -12, 12, 0.1);
process = ef.transpose(window, xfade, shift);
