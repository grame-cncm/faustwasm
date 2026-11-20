// A DSP of test/cli/remote-native.test.mjs for the policies of several
// remote controls: one group per player, each with a control on the
// accelerometer, and a control outside the groups.
declare name "remote_groups";
p1 = hgroup("p1", hslider("x [acc: 0 0 -10 0 10]", 0.5, 0, 1, 0.01));
p2 = hgroup("p2", hslider("x [acc: 0 0 -10 0 10]", 0.5, 0, 1, 0.01));
free = hslider("free", 0, 0, 1, 0.01);
process = p1 + p2 + free : hbargraph("level", 0, 3);
