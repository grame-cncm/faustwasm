declare name "FluteMIDI";
declare version "1.0";
declare author "Romain Michon";
declare description "Simple MIDI-controllable flute physical model with physical parameters.";
declare license "MIT";
declare copyright "(c)Romain Michon, CCRMA (Stanford University), GRAME";
declare isInstrument "true";

import("stdfaust.lib");

process = pm.clarinet_ui_MIDI <: _,_;

effect = dm.freeverb_demo;
