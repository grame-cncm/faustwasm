// compressor with the dB conversions of basics.lib (linear2db, db2linear), which
// compressors.lib calls at every sample, taken from fastmath.lib.
import("stdfaust.lib");
fab = library("basics.lib")[linear2db(g) = fa.flinear2db(max(ma.MIN, g)); db2linear(l) = fa.fdb2linear(l);];
fco = library("compressors.lib")[ba = fab;];
ratio = hslider("ratio", 5, 1, 20, 0.1);
threshold = hslider("threshold", -30, -100, 10, 0.1);
attack = hslider("attack", 50, 1, 1000, 0.1) : *(0.001) : max(1/ma.SR);
release = hslider("release", 500, 1, 1000, 0.1) : *(0.001) : max(1/ma.SR);
makeupgain = hslider("makeupgain", 12, -96, 96, 0.1) : ba.db2linear;
process = fco.compressor_stereo(ratio, threshold, attack, release) : *(makeupgain), *(makeupgain);
