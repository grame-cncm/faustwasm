import("stdfaust.lib");
// dm.moog_vcf_demo (examples/filtering/moogVCF.dsp), default branch only: the bypass checkbox is
// dropped and the "Use Biquads" switch is held at 0, so ve.moog_vcf(res^4, freq) then the output gain.
freq = hslider("freq [unit:PK]", 25, 1, 88, 0.01) : ba.pianokey2hz : si.smoo;
res = hslider("res", 0.9, 0, 1, 0.01);
outgain = hslider("outgain [unit:dB]", 5, -60, 20, 0.1) : ba.db2linear : si.smoo;
process = ve.moog_vcf(res^4, freq) : *(outgain);
