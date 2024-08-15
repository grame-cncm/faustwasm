declare name "BrassMIDI";
declare description "Simple MIDI-controllable brass instrument physical model with physical parameters.";
declare license "MIT";
declare copyright "(c)Romain Michon, CCRMA (Stanford University), GRAME";

import("pkg:faust/faust/stdfaust.lib@1.0.0");

process = pm.brass_ui_MIDI <: _,_;
