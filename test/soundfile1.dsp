import ("stdfaust.lib");

declare name "DroneLAN";
declare author "Developpement Grame - CNCM par Elodie Rabibisoa et Romain Constant.";
declare soundfiles "https://raw.githubusercontent.com/grame-cncm/GameLAN/master/drone";

// 2 drones :
process = par(i, 2, (multi(i) :> _* (select_drone == i))) :>_ * on_off <:_,_;

select_drone = hslider("[1]Drones[style:radio{'1':0;'2':1}]", 0, 0, 1, 1);

on_off = checkbox("[0]ON / OFF");

// 4 sounds per drone :
multi(N) = par(i, 4, so.loop(drone(N), i) *(0.25) * volume(i));

drone(0) = soundfile("Drone_1 [url:{'Alonepad_reverb_stereo_instru1.flac'; 'Dronepad_test_stereo_instru1.flac'; 'Rain_full_stereo_instru1.flac'; 'Gouttes_eau_mono_instru1.flac'}]", 1);
drone(1) = soundfile("Drone_2 [url:{'Drone_C_filter_stereo_instru2.flac'; 'Pad_C_tremolo_stereo_instru2.flac'; 'Pedale_C_filter_stereo_instru2.flac'; 'String_freeze_stereo_instru2.flac'}]", 1);

volume(0) = hslider("Volume 0 [acc:0 0 0 0 10][hidden:1]", 0, 0, 1, 0.001) : fi.lowpass(1, 1);
volume(1) = hslider("Volume 1 [acc:0 1 -10 0 0][hidden:1]", 0, 0, 1, 0.001) : fi.lowpass(1, 1);
volume(2) = hslider("Volume 2 [acc:1 0 0 0 10][hidden:1]", 0, 0, 1, 0.001) : fi.lowpass(1, 1);
volume(3) = hslider("Volume 3 [acc:1 1 -10 0 0][hidden:1]", 0, 0, 1, 0.001) : fi.lowpass(1, 1);
