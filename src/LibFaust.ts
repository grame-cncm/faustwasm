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
    /**
     * Return the underlying embedded compiler-module object.
     *
     * This may be either the historical Emscripten module or the raw Rust
     * compiler module.
     */
    module(): FaustCompilerModule;

    /**
     * Return the compiler filesystem facade.
     *
     * Historical Emscripten modules expose a real `FS`; the raw Rust compiler
     * path returns a proxy that throws, because no compiler-side filesystem is
     * available there.
     */
    fs(): typeof FS;
}

/**
 * Small compatibility adapter that normalizes compiler-module differences for
 * the rest of `faustwasm`.
 *
 * Downstream code keeps calling the historical `LibFaustWasm`-style methods,
 * while this wrapper dispatches either to the Emscripten-backed compiler or to
 * the raw Rust service adapter.
 */
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
            // The Rust compiler path intentionally does not emulate an
            // Emscripten filesystem. Callers must not assume `FS` exists there.
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
