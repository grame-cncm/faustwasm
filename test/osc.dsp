import("stdfaust.lib");
vol = hslider("volume [unit:dB]", 0, -96, 0, 0.1) : ba.db2linear : si.smoo;
freq = hslider("freq [unit:Hz]", 500, 20, 24000, 1);
process = vgroup("Oscillator", os.osc(freq) * vol);