/**
 * Smoke test: ensure setParamValue/getParamValue accept path, shortname, and label.
 */
import * as FaustWasm from "../../dist/esm/index.js";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const dspCode = `
import("stdfaust.lib");

freq = hslider("Freq[Hz]", 440, 20, 20000, 1);
gain = hslider("Gain[dB]", -6, -60, 6, 0.1) : ba.db2linear;

process = os.osc(freq) * gain;
`;

const assertClose = (actual, expected, label) => {
    const delta = Math.abs(actual - expected);
    if (delta > 1e-4) {
        throw new Error(`${label} expected ${expected} got ${actual}`);
    }
};

const faustModule = await FaustWasm.instantiateFaustModuleFromFile(
    path.join(__dirname, "../../libfaust-wasm/libfaust-wasm.js")
);
const libFaust = new FaustWasm.LibFaust(faustModule);
const compiler = new FaustWasm.FaustCompiler(libFaust);

const factory = await compiler.createMonoDSPFactory(
    "alias-test",
    dspCode,
    "-ftz 2"
);
if (!factory) {
    throw new Error("Faust compilation failed");
}

const instance = await FaustWasm.FaustWasmInstantiator.createAsyncMonoDSPInstance(factory);
const monoDsp = new FaustWasm.FaustMonoWebAudioDsp(
    instance,
    48000,
    4,
    128,
    factory.soundfiles || {}
);

const descriptors = monoDsp.getDescriptors();
const control = descriptors.find((item) =>
    ["hslider", "vslider", "nentry"].includes(item.type)
);
if (!control) {
    throw new Error("No control parameter found");
}

if (!control.address || !control.shortname || !control.label) {
    throw new Error("Missing address/shortname/label in descriptor");
}

monoDsp.setParamValue(control.address, 0.123);
assertClose(monoDsp.getParamValue(control.address), 0.123, "address");

monoDsp.setParamValue(control.shortname, 0.456);
assertClose(monoDsp.getParamValue(control.address), 0.456, "shortname->address");
assertClose(monoDsp.getParamValue(control.shortname), 0.456, "shortname");

monoDsp.setParamValue(control.label, 0.789);
assertClose(monoDsp.getParamValue(control.address), 0.789, "label->address");
assertClose(monoDsp.getParamValue(control.label), 0.789, "label");

console.log("Param alias test passed.");
