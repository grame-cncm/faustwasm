// fm_pad with sin and ma.tanh replaced by fa.fsin, fa.fsin2pi and fa.ftanh of fastmath.lib.
import("stdfaust.lib");
freq = hslider("freq", 220, 20, 2000, 0.01);
ratio = hslider("ratio", 1.5, 0.25, 8, 0.01);
index = hslider("index", 3, 0, 10, 0.01);
drive = hslider("drive", 2, 1, 10, 0.01);
detune = hslider("detune", 1.003, 1, 1.02, 0.0001);
wrap(x) = x - floor(x);
ph(inc) = (+(inc) : wrap) ~ _;
op(f) = fa.ftanh(drive * fa.fsin(2*ma.PI*ph(f/ma.SR) + index*fa.fsin2pi(ph(f*ratio/ma.SR))));
process = (op(freq) + op(freq*detune)) * 0.25;
