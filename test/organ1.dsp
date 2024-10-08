import("stdfaust.lib");

timbre(f) = os.osc(f)*0.5 + os.osc(f*2)*0.25 + os.osc(f*3)*0.125;
effect = _*(hslider("Left", 0.1, 0, 1, 0.01)), _*(hslider("Right", 0.1, 0, 1, 0.01));

process = timbre(hslider("freq", 440, 20, 3000, 1))
	* hslider("gain", 0.5, 0, 1, 0.01)
	* (button("gate") : en.adsr(0.1,0.1,0.98,1.5));
