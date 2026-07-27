import assert from "node:assert/strict";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

class FakeScriptProcessorNode {
    constructor(context, options = {}) {
        this.context = context;
        this.bufferSize = options.bufferSize ?? 0;
        this.channelCount = options.channelCount ?? 0;
        this.numberOfInputs = options.numberOfInputs ?? 0;
        this.numberOfOutputs = options.numberOfOutputs ?? 0;
        this.onaudioprocess = null;
    }
}

globalThis.ScriptProcessorNode = FakeScriptProcessorNode;

const FaustWasm = await import("../../dist/esm/index.js");

const compilerWasm =
    process.env.FAUST_RUST_COMPILER_WASM ||
    path.resolve(
        __dirname,
        "../../../../RUST/faust-rs/target/wasm32-unknown-unknown/release/libfaust-rs.wasm"
    );

const dspCode = `
myhost = ffunction(float myhost(float), <dummy.h>, "");
process = myhost;
`;

const rustModule = await FaustWasm.instantiateRustFaustModuleFromFile(
    compilerWasm
);
const compiler = new FaustWasm.FaustCompiler(
    new FaustWasm.LibFaust(rustModule)
);

const monoGenerator = new FaustWasm.FaustMonoDspGenerator();
const dsp = await monoGenerator.compile(
    compiler,
    "rust-ffunction-test",
    dspCode,
    "-ftz 2"
);
assert.ok(dsp?.factory, "FaustMonoDspGenerator.compile returned null");

const factory = dsp.factory;
const meta = JSON.parse(factory.json);
assert.equal(meta.inputs, 1);
assert.equal(meta.outputs, 1);
if (!meta.meta) {
    meta.meta = [];
    factory.json = JSON.stringify(meta);
}

const dspModule = await WebAssembly.compile(factory.code);
const imports = WebAssembly.Module.imports(dspModule);
assert.deepEqual(imports, [
    {
        module: "env",
        name: "myhost",
        kind: "function",
    },
]);

const fakeContext = {
    sampleRate: 48000,
    createScriptProcessor(bufferSize, numberOfInputs, numberOfOutputs) {
        return new FakeScriptProcessorNode(this, {
            bufferSize,
            numberOfInputs,
            numberOfOutputs,
            channelCount: numberOfInputs,
        });
    },
};

FaustWasm.FaustMonoDspGenerator.clearForeignFunctions();
FaustWasm.FaustMonoDspGenerator.registerForeignFunction("myhost", (x) => x * 2);

try {
    const node = await monoGenerator.createNode(
        fakeContext,
        "rust-ffunction-test",
        factory,
        true,
        128
    );

    assert.ok(node, "FaustDspGenerator.createFaustNode returned null");
    assert.equal(node.getNumInputs(), 1);
    assert.equal(node.getNumOutputs(), 1);

    const inputs = [new Float32Array(128)];
    const outputs = [new Float32Array(128)];
    inputs[0][0] = 0.5;
    const ok = node.compute(inputs, outputs);

    assert.equal(ok, true);
    assert.equal(outputs[0][0], 1);
} finally {
    FaustWasm.FaustMonoDspGenerator.clearForeignFunctions();
}

console.log("Rust ffunction wasm test passed.");
