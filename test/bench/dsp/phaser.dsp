import("stdfaust.lib");
// dm.phaser2_demo (examples/phasing/phaser.dsp): pf.phaser2_stereo with Notches = 4, the demo's
// slider defaults, "Invert Internal Phaser Sum" and "Vibrato Mode" off (invert = 0, depth from
// the slider); the bypass checkbox is dropped.
speed = hslider("speed", 0.5, 0, 10, 0.001);
depth = hslider("depth", 1, 0, 1, 0.001);
fb = hslider("fb", 0, -0.999, 0.999, 0.001);
width = hslider("width", 1000, 10, 5000, 1);
frqmin = hslider("frqmin", 100, 20, 5000, 1);
frqmax = hslider("frqmax", 800, 20, 10000, 1) : max(frqmin);
fratio = hslider("fratio", 1.5, 1.1, 4, 0.001);
level = hslider("level", 0, -60, 10, 0.1) : ba.db2linear;
process = *(level), *(level) : pf.phaser2_stereo(4, width, frqmin, fratio, frqmax, speed, depth, fb, 0);
