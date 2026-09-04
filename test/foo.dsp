// Compiles only with `-I test/includes`: mylib.lib is deliberately not next
// to this file, so the include path is what makes the build work.
import("stdfaust.lib");
import("mylib.lib");

process = os.osc(440) : mygain;
