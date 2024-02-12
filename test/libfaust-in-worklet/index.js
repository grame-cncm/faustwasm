//@ts-check
const div = document.getElementById("log");
const log = (/** @type {string} */str) => div.innerHTML += str.replace("\n", "<br />") + "<br />";
const options = "-ftz 2";

(async () => {
    const ctx = new AudioContext();
    globalThis.ctx = ctx;
    globalThis.faustModule = await faustwasm.instantiateFaustModule();
    const post = async () => {
        const {
            instantiateFaustModule,
            LibFaust,
            getFaustAudioWorkletProcessor,
            WavEncoder,
            FaustWasmInstantiator,
            FaustMonoDspGenerator,
            FaustPolyDspGenerator,
            FaustMonoWebAudioDsp,
            FaustOfflineProcessor,
            FaustCompiler,
            FaustSvgDiagrams
        } = faustwasm;
        const faustModule = await instantiateFaustModule();
        const code = `import("stdfaust.lib");
		process = os.osc(440);`;
        const gen = new FaustMonoDspGenerator();
        const libFaust = new LibFaust(faustModule);
        const compiler = new FaustCompiler(libFaust);
        console.log(compiler.version());
        await gen.compile(compiler, 'dsp', code, "-ftz 0");

        console.log(await gen.createAudioWorkletProcessor());
        const processor = await gen.createOfflineProcessor(48000, 128);
        console.log(processor);
        console.log(processor.render([], 48000));
    };
    await ctx.audioWorklet.addModule("../../dist/cjs-bundle/index.js");
    await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([`(${post.toString()})()`], { type: "application/javascript" })));
})();
