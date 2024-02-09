import("stdfaust.lib"); 
process = pm.guitar_ui_MIDI <: _,_;
effect = *(hslider("Left", 0.1, 0, 1, 0.01)), *(hslider("Right", 0.1, 0, 1, 0.01));