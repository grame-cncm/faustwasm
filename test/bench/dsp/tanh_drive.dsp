import("stdfaust.lib");
drive = hslider("drive", 4, 1, 20, 0.01);
process = _ * drive : ma.tanh : *(0.5);
