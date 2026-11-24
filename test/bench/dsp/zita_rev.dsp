import("stdfaust.lib");
f1 = hslider("f1", 200, 50, 1000, 1);
f2 = hslider("f2", 6000, 1500, 23520, 1);
t60dc = hslider("t60dc", 3, 1, 8, 0.1);
t60m = hslider("t60m", 2, 1, 8, 0.1);
process = re.zita_rev1_stereo(60, f1, f2, t60dc, t60m, 48000);
