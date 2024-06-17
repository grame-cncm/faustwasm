import("stdfaust.lib");

vol = hslider("volume [unit:dB][acc:1 1 -10 0 10]", 0, -96, 0, 0.1) : ba.db2linear : si.smoo;
freq = hslider("freq [unit:Hz][acc:0 1 -10 0 10]", 500, 20, 2500, 1) : si.smoo;

process = vgroup("Oscillator", os.osc(freq) * vol);