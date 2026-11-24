import("stdfaust.lib");
// pm.clarinet_ui_MIDI (examples/physicalModeling/clarinetMIDI.dsp), line for line, except the
// gate: a slider held at 1 instead of a button, so that the benchmark plays a sustained note.
f = hslider("freq", 440, 50, 1000, 0.01);
bend = ba.semi2ratio(hslider("bend", 0, -2, 2, 0.01)) : si.polySmooth(gate, 0.999, 1);
gain = hslider("gain", 0.6, 0, 1, 0.01);
envAttack = hslider("envAttack", 1, 0, 30, 0.01)*0.001;
s = hslider("sustain", 0, 0, 1, 1);
reedStiffness = hslider("reedStiffness", 0.5, 0, 1, 0.01);
bellOpening = hslider("bellOpening", 0.5, 0, 1, 0.01);
vibratoFreq = hslider("vibratoFreq", 5, 1, 10, 0.01);
vibratoGain = hslider("vibratoGain", 0.25, 0, 1, 0.01)*0.01;
outGain = hslider("outGain", 0.5, 0, 1, 0.01);
t = hslider("gate", 1, 0, 1, 1);

gate = t+s : min(1);
vibrato = 1+os.osc(vibratoFreq)*vibratoGain*envelope;
freq = f*bend*vibrato;
envelope = gate*gain : si.smooth(ba.tau2pole(envAttack));
tubeLength = freq : pm.f2l;
pressure = envelope;
blow = pm.blower(pressure, 0.05, 2000, vibratoFreq, vibratoGain);
process = pm.clarinetModel(tubeLength, blow, reedStiffness, bellOpening)*outGain <: _, _;
