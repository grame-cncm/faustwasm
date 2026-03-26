import RustLibFaust from './RustLibFaust';
import type {
    FaustCompilerModule,
    FaustInfoType,
    FaustModule,
    LibFaustWasm,
    RustFaustModule
} from './types';

const isLegacyFaustModule = (
    module: FaustCompilerModule
): module is FaustModule => typeof (module as FaustModule).libFaustWasm === 'function';

const isRustFaustModule = (
    module: FaustCompilerModule
): module is RustFaustModule =>
    typeof (module as RustFaustModule).faust_wasm_compile_dsp === 'function';

const unsupportedFs = () =>
    new Proxy(
        {},
        {
            get() {
                throw new Error(
                    'FS is not available on the Rust raw faustwasm backend'
                );
            }
        }
    ) as typeof FS;

export interface ILibFaust extends LibFaustWasm {
    module(): FaustCompilerModule;
    fs(): typeof FS;
}

class LibFaust implements ILibFaust {
    private fModule: FaustCompilerModule;
    private fCompiler: LibFaustWasm;
    private fFileSystem: typeof FS;

    constructor(module: FaustCompilerModule) {
        this.fModule = module;
        if (isLegacyFaustModule(module)) {
            this.fCompiler = new module.libFaustWasm();
            this.fFileSystem = module.FS;
        } else if (isRustFaustModule(module)) {
            this.fCompiler = new RustLibFaust(module);
            this.fFileSystem = unsupportedFs();
        } else {
            throw new Error('Unsupported Faust compiler module shape');
        }
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
    createDSPFactory(
        name: string,
        code: string,
        args: string,
        useInternalMemory: boolean
    ) {
        return this.fCompiler.createDSPFactory(
            name,
            code,
            args,
            useInternalMemory
        );
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
