//################################### turenas.dsp ########################################
// A simple smart phone percussion based on an additive synthesizer.
//
// ## `SmartKeyboard` Use Strategy
//
// Since the sounds generated by this synth are very short, the strategy here is to take
// advantage of the polyphony capabilities of the iOSKeyboard architecture by creating
// a new voice every time a new key is pressed. Since the `SmartKeyboard` interface has a
// large number of keys here (180), lots of sounds are generated when sliding a
// finger across the keyboard.
//
//
// ## Compilation Instructions
//
// This Faust code will compile fine with any of the standard Faust targets. However
// it was specifically designed to be used with `faust2smartkeyb`. For best results,
// we recommend to use the following parameters to compile it:
//
// ```
// faust2smartkeyb [-ios/-android] turenas.dsp
// ```
//
// ## Version/Licence
//
// Version 0.0, Feb. 2017
// Copyright Romain Michon CCRMA (Stanford University)/GRAME 2017
// MIT Licence: https://opensource.org/licenses/MIT
//########################################################################################

declare name "turenas";

import("pkg:faust/faust/stdfaust.lib@1.0.0");

//========================= Smart Keyboard Configuration =================================
// (10 keyboards with 18 keys each configured as a pitch matrix.
//========================================================================================

declare interface "SmartKeyboard{
	'Number of Keyboards':'10',
	'Keyboard 0 - Number of Keys':'18',
	'Keyboard 1 - Number of Keys':'18',
	'Keyboard 2 - Number of Keys':'18',
	'Keyboard 3 - Number of Keys':'18',
	'Keyboard 4 - Number of Keys':'18',
	'Keyboard 5 - Number of Keys':'18',
	'Keyboard 6 - Number of Keys':'18',
	'Keyboard 7 - Number of Keys':'18',
	'Keyboard 8 - Number of Keys':'18',
	'Keyboard 9 - Number of Keys':'18',
	'Keyboard 0 - Lowest Key':'50',
	'Keyboard 1 - Lowest Key':'55',
	'Keyboard 2 - Lowest Key':'60',
	'Keyboard 3 - Lowest Key':'65',
	'Keyboard 4 - Lowest Key':'70',
	'Keyboard 5 - Lowest Key':'75',
	'Keyboard 6 - Lowest Key':'80',
	'Keyboard 7 - Lowest Key':'85',
	'Keyboard 8 - Lowest Key':'90',
	'Keyboard 9 - Lowest Key':'95',
	'Keyboard 0 - Piano Keyboard':'0',
	'Keyboard 1 - Piano Keyboard':'0',
	'Keyboard 2 - Piano Keyboard':'0',
	'Keyboard 3 - Piano Keyboard':'0',
	'Keyboard 4 - Piano Keyboard':'0',
	'Keyboard 5 - Piano Keyboard':'0',
	'Keyboard 6 - Piano Keyboard':'0',
	'Keyboard 7 - Piano Keyboard':'0',
	'Keyboard 8 - Piano Keyboard':'0',
	'Keyboard 9 - Piano Keyboard':'0',
	'Keyboard 0 - Send X':'0',
	'Keyboard 1 - Send X':'0',
	'Keyboard 2 - Send X':'0',
	'Keyboard 3 - Send X':'0',
	'Keyboard 4 - Send X':'0',
	'Keyboard 5 - Send X':'0',
	'Keyboard 6 - Send X':'0',
	'Keyboard 7 - Send X':'0',
	'Keyboard 8 - Send X':'0',
	'Keyboard 9 - Send X':'0'
}";

//================================ Instrument Parameters =================================
// Creates the connection between the synth and the mobile device
//========================================================================================

// SmartKeyboard Y parameter
y = hslider("y",0,0,1,0.01);
// Smart Keyboard frequency parameter
freq = hslider("freq",400,50,2000,0.01);
// SmartKeyboard gate parameter
gate = button("gate");
// mode resonance duration is controlled with the x axis of the accelerometer
res = hslider("res[acc: 0 0 -10 0 10]",2.5,0.01,5,0.01);

//=================================== Parameters Mapping =================================
//========================================================================================

// number of modes
nModes = 6;
// distance between each mode
maxModeSpread = 5;
modeSpread = y*maxModeSpread;
// computing modes frequency ratio
modeFreqRatios = par(i,nModes,1+(i+1)/nModes*modeSpread);
// computing modes gain
minModeGain = 0.3;
modeGains = par(i,nModes,1-(i+1)/(nModes*minModeGain));
// smoothed mode resonance
modeRes = res : si.smoo;

//============================================ DSP =======================================
//========================================================================================

process = sy.additiveDrum(freq,modeFreqRatios,modeGains,0.8,0.001,modeRes,gate)*0.05;
