declare name "DroneLAN";
declare author "Developpement Grame - CNCM par Elodie Rabibisoa et Romain Constant.";
declare soundfiles "https://raw.githubusercontent.com/grame-cncm/GameLAN/master/drone/";

import ("stdfaust.lib");

// 2 drones :
process = par(i, 1, (multi(i) :> _));

// 4 sounds per drone :
multi(N) = par(i, 2, so.loop(drone(N), i) *(0.25) * volume(i));
drone(0) = soundfile("Drone_1 [url:{'Alonepad_reverb_stereo_instru1.flac'; 'Dronepad_test_stereo_instru1.flac'}]", 1);

volume(0) = hslider("Volume 0 [acc:0 0 0 0 10][hidden:1]", 1, 0, 1, 0.001) : fi.lowpass(1, 1);
volume(1) = hslider("Volume 1 [acc:0 1 -10 0 0][hidden:1]", 0, 0, 1, 0.001) : fi.lowpass(1, 1);