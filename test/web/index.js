//@ts-check
const div = document.getElementById("log");
const log = (/** @type {string} */str) => div.innerHTML += str.replace("\n", "<br />") + "<br />";
const svg = (/** @type {string} */str, /** @type {string} */name) => log(str);
const options = "-ftz 2 -I libraries/";
const errCode = "foo";
const effectCode = 'process = _*(hslider("Left", 0.1, 0, 1, 0.01)), _*(hslider("Right", 0.0, 0, 1, 0.01));';


(async () => {
    const {
        instantiateFaustModule,
        LibFaust,
        WavEncoder,
        FaustWasmInstantiator,
        FaustMonoDspGenerator,
        FaustPolyDspGenerator,
        FaustMonoWebAudioDsp,
        FaustOfflineProcessor,
        FaustCompiler,
        FaustSvgDiagrams
    } = await import("../../dist/esm-bundle/index.js");
    const faustModule = await instantiateFaustModule();

    const libFaust = new LibFaust(faustModule);
    globalThis.libFaust = libFaust;

    /**
     * @param {InstanceType<FaustCompiler>} faust
     * @param {(msg: string) => any} log
     * @param {string} code
     */
    const misc = (faust, log, code) => {
        let exp;
        try {
            exp = faust.expandDSP(code, options);
        } catch (e) {
            log("  expandDSP             " + exp || e.message);
        }

        let res;
        try {
            res = faust.generateAuxFiles("test", code, options + " -svg");
        } catch (e) {
            log("  generateAuxFiles      " + res ? "done" : e.message);
        }
    }
    /**
     * @param {InstanceType<FaustCompiler>} faust
     * @param {(msg: string) => any} log
     * @param {string} code
     */
    const createDsp = async (faust, log, code) => {
        log("createMonoDSPFactory: ");
        let factory = await faust.createMonoDSPFactory("test", code, options);
        if (factory) {
            log("factory JSON: " + factory.json);
            log("factory poly: " + factory.poly);
        } else {
            log("factory is null");
            return;
        }
        log("deleteDSPFactory");
        faust.deleteDSPFactory(factory);

        log("createSyncMonoDSPInstance: ");
        let instance1 = FaustWasmInstantiator.createSyncMonoDSPInstance(factory);
        if (instance1) {
            log("  getNumInputs : " + instance1.api.getNumInputs(0));
            log("  getNumOutputs: " + instance1.api.getNumOutputs(0));
            log("  JSON: " + instance1.json);
        } else {
            log("instance1 is null");
        }

        log("createAsyncMonoDSPInstance: ");
        let instance2 = await FaustWasmInstantiator.createAsyncMonoDSPInstance(factory);
        if (instance2) {
            log("  getNumInputs : " + instance2.api.getNumInputs(0));
            log("  getNumOutputs: " + instance2.api.getNumOutputs(0));
            log("  JSON: " + instance2.json);
        } else {
            log("instance2 is null");
        }
    }
    /**
     * @param {InstanceType<FaustCompiler>} faust
     * @param {(msg: string) => any} log
     * @param {string} voiceCode
     * @param {string} effectCode
     */
    const createPolyDsp = async (faust, log, voiceCode, effectCode) => {
        const { mixerModule } = await faust.getAsyncInternalMixerModule();
        log("createPolyDSPFactory for voice: ");
        let voiceFactory = await faust.createPolyDSPFactory("voice", voiceCode, options);
        if (voiceFactory) {
            log("voice factory JSON: " + voiceFactory.json);
            log("voice factory poly: " + voiceFactory.poly);
        } else {
            log("voice_factory is null");
            return;
        }
        log("createPolyDSPFactory for effect: ");
        let effectFactory = await faust.createPolyDSPFactory("effect", effectCode, options);
        if (effectFactory) {
            log("effect factory JSON: " + effectFactory.json);
            log("effect factory poly: " + effectFactory.poly);
        } else {
            log("effect_factory is null");
        }

        log("createSyncPolyDSPInstance: ");
        let polyInstance1 = FaustWasmInstantiator.createSyncPolyDSPInstance(voiceFactory, mixerModule, 8, effectFactory);
        if (polyInstance1) {
            log("  voice_api getNumInputs : " + polyInstance1.voiceAPI.getNumInputs(0));
            log("  voice_api getNumOutputs: " + polyInstance1.voiceAPI.getNumOutputs(0));
            log("  JSON: " + polyInstance1.voiceJSON);
            log("  effect_api getNumInputs : " + polyInstance1.voiceAPI.getNumInputs(0));
            log("  effect_api getNumOutputs: " + polyInstance1.voiceAPI.getNumOutputs(0));
            log("  JSON: " + polyInstance1.effectJSON);
        } else {
            log("poly_instance1 is null");
        }

        log("createAsyncPolyDSPInstance: ");
        let polyInstance2 = await FaustWasmInstantiator.createAsyncPolyDSPInstance(voiceFactory, mixerModule, 8, effectFactory);
        if (polyInstance2) {
            log("  voice_api getNumInputs : " + polyInstance2.voiceAPI.getNumInputs(0));
            log("  voice_api getNumOutputs: " + polyInstance2.voiceAPI.getNumOutputs(0));
            log("  JSON: " + polyInstance2.voiceJSON);
            log("  effect_api getNumInputs : " + polyInstance2.effectAPI.getNumInputs(0));
            log("  effect_api getNumOutputs: " + polyInstance2.effectAPI.getNumOutputs(0));
            log("  JSON: " + polyInstance2.effectJSON);
        } else {
            log("poly_instance2 is null");
        }
    }

    /**
     * @param {InstanceType<FaustCompiler>} compiler
     * @param {(msg: string) => any} log
     * @param {string} code
     */
    const svgdiagrams = (compiler, log, code) => {
        const filter = "import(\"stdfaust.lib\");\nprocess = dm.oscrs_demo;";
        const SvgDiagrams = new FaustSvgDiagrams(compiler);

        let svg1 = SvgDiagrams.from("TestSVG1", code, options);
        log(`<div>${svg1["process.svg"]}</div>`);

        let svg2 = SvgDiagrams.from("TestSVG2", filter, options)
        log(`<div>${svg2["process.svg"]}</div>`);
    }

    /**
     * @param {InstanceType<FaustCompiler>} faust
     * @param {(msg: string) => any} log
     */
    const offlineProcessor = async (faust, log) => {

        let signal = "import(\"stdfaust.lib\");\nprocess = 0.25,0.33, 0.6;";
        let factory = await faust.createMonoDSPFactory("test", signal, options);
        const instance = await FaustWasmInstantiator.createAsyncMonoDSPInstance(factory);
        const dsp = new FaustMonoWebAudioDsp(instance, 48000, 4, 33);

        log("offlineProcessor");
        let offline = new FaustOfflineProcessor(dsp, 33);
        let plotted = offline.render(null, 100);
        for (let chan = 0; chan < plotted.length; chan++) {
            for (let frame = 0; frame < 100; frame++) {
                console.log("Chan %d sample %f\n", chan, plotted[chan][frame])
            }
        }
    }
    /**
     * 
     * @param {InstanceType<LibFaust>} libFaust
     * @param {(msg: string) => any} log
     * @param {string} code
     * @param {AudioContext} context
     */
    const run = async (libFaust, log, code, context) => {
        const compiler = new FaustCompiler(libFaust);
        log("libfaust version: " + compiler.version());

        log("\n-----------------\nMisc tests" + compiler.version());
        misc(compiler, log, code);
        log("\n-----------------\nMisc tests with error code");
        misc(compiler, log, errCode);

        log("\n-----------------\nCreating DSP instance:");
        await createDsp(compiler, log, code);

        log("\n-----------------\nCreating Poly DSP instance:");
        await createPolyDsp(compiler, log, code, effectCode);

        log("\n-----------------\nCreating DSP instance with error code:");
        await createDsp(compiler, log, errCode).catch(e => { log(e.message); });

        log("\n-----------------\nCreating Poly DSP instance with error code:");
        await createPolyDsp(compiler, log, errCode, effectCode).catch(e => { log(e.message); });

        log("\n-----------------\nTest SVG diagrams: ");
        svgdiagrams(compiler, log, code);

        log("\n-----------------\nTest Offline processor ");
        offlineProcessor(compiler, log);

        const gen = new FaustPolyDspGenerator()
        await gen.compile(compiler, "mydsp2", code, options, effectCode);
        const node = await gen.createNode(ctx, 8);
        console.log(node);
        console.log(node.getParams());
        console.log(node.getMeta());
        node.connect(ctx.destination);
        node.keyOn(0, 60, 50);
        node.keyOn(0, 64, 50);
        node.keyOn(0, 67, 50);
        node.keyOn(0, 71, 50);
        node.keyOn(0, 76, 50);

        log("\nEnd of API tests");
    };
    const sampleRate = 48000;
    const code1Fetch = await fetch("../organ.dsp");
    const code1 = await code1Fetch.text();
    const name1 = "pdj";
    const code2Fetch = await fetch("../rev.dsp");
    const code2 = await code2Fetch.text();

    const ctx = new AudioContext();

    await run(libFaust, log, code1, ctx);
    globalThis.ctx = ctx;
})();
