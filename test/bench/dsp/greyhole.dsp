import("stdfaust.lib");
// dm.greyhole_demo (examples/reverb/greyhole.dsp): re.greyhole with the demo's default controls,
// the sliders of the demo without their groups.
dt = hslider("delayTime", 0.2, 0.001, 1.45, 0.0001);
damp = hslider("damping", 0, 0, 0.99, 0.001);
size = hslider("size", 1, 0.5, 3, 0.0001);
early_diff = hslider("diffusion", 0.5, 0, 0.99, 0.0001);
feedback = hslider("feedback", 0.9, 0, 1, 0.01);
mod_depth = hslider("modDepth", 0.1, 0, 1, 0.001);
mod_freq = hslider("modFreq", 2, 0, 10, 0.01);
process = re.greyhole(dt, damp, size, early_diff, feedback, mod_depth, mod_freq);
