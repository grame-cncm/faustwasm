
import("stdfaust.lib");
process = os.osc(freq)*vol
with {
    freq = hslider("Freq[midi:ctrl 1 ]", 200, 200, 2000, 0.01);
    vol = hslider("Volume[midi:ctrl 7 ]", 0.5, 0, 1, 0.01);
};