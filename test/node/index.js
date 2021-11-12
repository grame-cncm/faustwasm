// @ts-check
const path = require("path");
const fs = require("fs/promises");

/** @type {import("../../dist")} */
const {
    instantiateLibFaust,
    Faust,
    FaustOfflineProcessor,
    WavEncoder
} = require(path.join(__dirname, "../../dist"));

(async () => {
    const libFaust = await instantiateLibFaust(path.join(__dirname, "../../libfaust-wasm/libfaust-wasm.js"));
    const faust = new Faust(libFaust);
    console.log(faust.getLibFaustVersion());
    const code = 'import("stdfaust.lib"); process = os.osc(440);';
    const dsp = await faust.compile(code, ["-I", "libraries/"]);
    await dsp.compileDsp();
    const processor = new FaustOfflineProcessor();
    const sampleRate = 48000;
    await processor.init({ dsp, sampleRate })
    const out = processor.generate(null, 48000);
    const wav = WavEncoder.encode(out, { sampleRate, bitDepth: 24 });
    const wavPath = path.join(__dirname, "out.wav");
    try {
        await fs.access(wavPath);
        await fs.rm(wavPath);
    } catch (error) {}
    await fs.writeFile(wavPath, new Uint8Array(wav));

    const dspModulePath = path.join(__dirname, "../web/dspModule.wasm");
    const dspMetaPath = path.join(__dirname, "../web/dspMeta.json");
    const effectModulePath = path.join(__dirname, "../web/effectModule.wasm");
    const effectMetaPath = path.join(__dirname, "../web/effectMeta.json");
    const { mainCode, mainMeta, effectCode, effectMeta } = dsp;

    const { wasmCModule: dspModule } = mainCode;
    const files = [dspModulePath, dspMetaPath, effectModulePath, effectMetaPath];
    for (const filePath in files) {
        try {
            await fs.access(filePath);
            await fs.rm(filePath);
        } catch (error) {}
    }
    await fs.writeFile(dspModulePath, dspModule);
    await fs.writeFile(dspMetaPath, JSON.stringify(mainMeta, null, 4));
    if (effectCode) {
        const { wasmCModule: effectModule } = effectCode;
        await fs.writeFile(effectModulePath, effectModule);
        await fs.writeFile(effectMetaPath, JSON.stringify(effectMeta, null, 4));
    }
})();
