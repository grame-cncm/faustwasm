// tanh_drive with ma.tanh replaced by fa.ftanh of fastmath.lib.
import("stdfaust.lib");
drive = hslider("drive", 4, 1, 20, 0.01);
process = _ * drive : fa.ftanh : *(0.5);
