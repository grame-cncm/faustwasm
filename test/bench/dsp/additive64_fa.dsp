// additive64 with sin replaced by fa.fsin2pi of fastmath.lib (the phase is in turns).
import("stdfaust.lib");
freq = hslider("freq", 110, 20, 200, 0.01);
wrap(x) = x - floor(x);
partial(k) = fa.fsin2pi(ph) * (1.0/(k+1)) with { ph = (+(freq/ma.SR*(k+1)) : wrap) ~ _; };
process = sum(k, 64, partial(k)) * 0.1;
