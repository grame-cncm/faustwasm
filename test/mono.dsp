declare name "Oscillator440";
declare version "1.0";
declare author "Fr0stbyteR";
declare license "BSD";
declare copyright "shren2021";
declare description "This is an oscillator";
import("stdfaust.lib");
process = os.osc(440);
