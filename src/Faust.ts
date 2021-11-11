import { FaustModule } from "./types";

class Faust {
    /**
     * The libfaust Wasm Emscripten Module
     */
    private libFaust: FaustModule;
    private createWasmCDSPFactoryFromString: ($name: number, $code: number, argc: number, $argv: number, $errorMsg: number, internalMemory: boolean) => number;
    private deleteAllWasmCDSPFactories: () => void;
    private expandCDSPFromString: ($name: number, $code: number, argc: number, $argv: number, $shaKey: number, $errorMsg: number) => number;
    private getCLibFaustVersion: () => number;
    private getWasmCModule: ($moduleCode: number) => number;
    private getWasmCModuleSize: ($moduleCode: number) => number;
    private getWasmCHelpers: ($moduleCode: number) => number;
    private freeWasmCModule: ($moduleCode: number) => void;
    private freeCMemory: ($: number) => number;
    private cleanupAfterException: () => void;
    private getErrorAfterException: () => number;
    private generateCAuxFilesFromString: ($name: number, $code: number, argc: number, $argv: number, $errorMsg: number) => number;
    getLibFaustVersion: () => string;
    constructor(libFaust: FaustModule) {
        this.libFaust = libFaust;
        this.importLibFaustFunctions();
    }
    private importLibFaustFunctions() {
        if (!this.libFaust) return;
        // Low-level API
        this.createWasmCDSPFactoryFromString = this.libFaust.cwrap("createWasmCDSPFactoryFromString", "number", ["number", "number", "number", "number", "number", "number"]);
        this.deleteAllWasmCDSPFactories = this.libFaust.cwrap("deleteAllWasmCDSPFactories", null, []);
        this.expandCDSPFromString = this.libFaust.cwrap("expandCDSPFromString", "number", ["number", "number", "number", "number", "number", "number"]);
        this.getCLibFaustVersion = this.libFaust.cwrap("getCLibFaustVersion", "number", []);
        this.getWasmCModule = this.libFaust.cwrap("getWasmCModule", "number", ["number"]);
        this.getWasmCModuleSize = this.libFaust.cwrap("getWasmCModuleSize", "number", ["number"]);
        this.getWasmCHelpers = this.libFaust.cwrap("getWasmCHelpers", "number", ["number"]);
        this.freeWasmCModule = this.libFaust.cwrap("freeWasmCModule", null, ["number"]);
        this.freeCMemory = this.libFaust.cwrap("freeCMemory", null, ["number"]);
        this.cleanupAfterException = this.libFaust.cwrap("cleanupAfterException", null, []);
        this.getErrorAfterException = this.libFaust.cwrap("getErrorAfterException", "number", []);
        this.generateCAuxFilesFromString = this.libFaust.cwrap("generateCAuxFilesFromString", "number", ["number", "number", "number", "number", "number"]);
        this.getLibFaustVersion = () => this.libFaust.UTF8ToString(this.getCLibFaustVersion());
    }
}

export default Faust;
