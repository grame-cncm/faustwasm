"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
class FaustDsp {
    constructor(mainCode, effectCode) {
        this.mainCode = mainCode;
        this.effectCode = effectCode;
    }
    /**
     * readDSPFactoryFromMachineAux
     * Compile wasm modules from dsp and effect Uint8Arrays
     */
    async compileDsp() {
        const time1 = Date.now();
        this.mainModule = await WebAssembly.compile(this.mainCode.wasmCModule);
        if (!this.mainModule) {
            throw new Error("Faust DSP factory cannot be compiled");
        }
        const time2 = Date.now();
        console.log("WASM compilation duration : " + (time2 - time1));
        try {
            const json = this.mainCode.helpers.match(/getJSON\w+?\(\)[\s\n]*{[\s\n]*return[\s\n]*'(\{.+?)';}/)[1].replace(/\\'/g, "'");
            // const base64Code = codes.dsp.helpersCode.match(/getBase64Code\w+?\(\)[\s\n]*{[\s\n]*return[\s\n]*"([A-Za-z0-9+/=]+?)";[\s\n]+}/)[1];
            const meta = JSON.parse(json);
            this.mainMeta = meta;
        }
        catch (e) {
            console.error("Error in JSON.parse: " + e.message);
            throw e;
        }
        // Possibly compile effect
        if (!this.effectCode)
            return;
        const effectModule = await WebAssembly.compile(this.effectCode.wasmCModule);
        this.effectModule = effectModule;
        // 'libfaust.js' wasm backend generates UI methods, then we compile the code
        // eval(helpers_code2);
        // factory.getJSONeffect = eval("getJSON" + factory_name2);
        // factory.getBase64Codeeffect = eval("getBase64Code" + factory_name2);
        try {
            const json = this.effectCode.helpers.match(/getJSON\w+?\(\)[\s\n]*{[\s\n]*return[\s\n]*'(\{.+?)';}/)[1].replace(/\\'/g, "'");
            // const base64Code = codes.effect.helpersCode.match(/getBase64Code\w+?\(\)[\s\n]*{[\s\n]*return[\s\n]*"([A-Za-z0-9+/=]+?)";[\s\n]+}/)[1];
            const meta = JSON.parse(json);
            this.effectMeta = meta;
        }
        catch (e) {
            console.error("Error in JSON.parse: " + e.message);
            throw e;
        }
    }
}
exports.default = FaustDsp;
//# sourceMappingURL=FaustDsp.js.map