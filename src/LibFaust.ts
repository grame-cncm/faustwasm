import type { FaustModule, LibFaustWasm, FaustInfoType } from "./types";

export interface ILibFaust extends LibFaustWasm {
    module(): FaustModule;
    fs(): typeof FS;
}

class LibFaust implements ILibFaust {
    private fModule: FaustModule;
    private fCompiler: LibFaustWasm;
    private fFileSystem: typeof FS;

    constructor(module: FaustModule) {
        this.fModule = module;
        this.fCompiler = new module.libFaustWasm();
        this.fFileSystem = this.fModule.FS;
    }
    module() {
        return this.fModule;
    }
    fs() {
        return this.fFileSystem;
    }
    version() {
        return this.fCompiler.version();
    }
    createDSPFactory(name: string, code: string, args: string, useInternalMemory: boolean) {
        return this.fCompiler.createDSPFactory(name, code, args, useInternalMemory);
    }
    deleteDSPFactory(cFactory: number) {
        return this.fCompiler.deleteDSPFactory(cFactory);
    }
    expandDSP(name: string, code: string, args: string) {
        return this.fCompiler.expandDSP(name, code, args);
    }
    generateAuxFiles(name: string, code: string, args: string) {
        return this.fCompiler.generateAuxFiles(name, code, args);
    }
    deleteAllDSPFactories() {
        return this.fCompiler.deleteAllDSPFactories();
    }
    getErrorAfterException() {
        return this.fCompiler.getErrorAfterException();
    }
    cleanupAfterException() {
        return this.fCompiler.cleanupAfterException();
    }
    getInfos(what: FaustInfoType) {
        return this.fCompiler.getInfos(what);
    }
    toString() {
        return `LibFaust module: ${this.fModule}, compiler: ${this.fCompiler}`;
    }

}

export default LibFaust;
