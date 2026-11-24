import("stdfaust.lib");
// dm.compressor_demo (examples/dynamic/compressor.dsp): co.compressor_stereo with makeup gain, same
// sliders and defaults, without the bypass checkbox and the gain meter (bargraph + attach, which
// have no audio effect).
ratio = hslider("ratio", 5, 1, 20, 0.1);
threshold = hslider("threshold", -30, -100, 10, 0.1);
attack = hslider("attack", 50, 1, 1000, 0.1) : *(0.001) : max(1/ma.SR);
release = hslider("release", 500, 1, 1000, 0.1) : *(0.001) : max(1/ma.SR);
makeupgain = hslider("makeupgain", 12, -96, 96, 0.1) : ba.db2linear;
process = co.compressor_stereo(ratio, threshold, attack, release) : *(makeupgain), *(makeupgain);
