declare name "Differentiable gain";
declare description "Another differentiable gain, this time to verify that exponents of the form
f(x)^{g(x)} are differentiated correctly.";

import("pkg:faust/faust/maths.lib@2.8.0");

x = hslider("gain [diff:1]", .5, 0, (ma.PI,2 : /), .001);

process = _,(sin(x),cos(x): ^): *;
