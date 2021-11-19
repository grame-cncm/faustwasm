random  = +(12345)~*(1103515245);
noise = random/2147483647.0;
process = noise * vslider("Volume", 0.2, 0, 1, 0.1) <: (*(0.01),*(0.01));