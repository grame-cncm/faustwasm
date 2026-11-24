import("stdfaust.lib");
freq = hslider("freq", 110, 20, 200, 0.01);
wrap(x) = x - floor(x);
partial(k) = sin(2*ma.PI*ph) * (1.0/(k+1)) with { ph = (+(freq/ma.SR*(k+1)) : wrap) ~ _; };
process = sum(k, 64, partial(k)) * 0.1;
