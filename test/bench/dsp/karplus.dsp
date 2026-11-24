import("stdfaust.lib");
// pm.ks_ui_MIDI (examples/physicalModeling/karplus.dsp), line for line, except the gate: a
// slider held at 1 instead of a button, so that the string is plucked once at the start.
f = hslider("freq", 440, 50, 1000, 0.01);
bend = ba.semi2ratio(hslider("bend", 0, -2, 2, 0.01)) : si.polySmooth(gate, 0.999, 1);
gain = hslider("gain", 0.8, 0, 1, 0.01);
s = hslider("sustain", 0, 0, 1, 1);
damping = hslider("damping", 0.01, 0, 1, 0.01) : si.smoo;
t = hslider("gate", 1, 0, 1, 1);

gate = t+s : min(1);
freq = f*bend;
process = gate : pm.impulseExcitation*gain : pm.ks((freq : pm.f2l), damping) <: _, _;
