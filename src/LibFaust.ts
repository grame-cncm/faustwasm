import RustLibFaust from './RustLibFaust';
import type {
    FaustCompilerModule,
    FaustInfoType,
    FaustModule,
    LibFaustWasm,
    RustFaustModule
} from './types';

const decoder = new TextDecoder();

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

    /**
     * Generate auxiliary files and return every produced file as a
     * `Record<string, string>` map keyed by relative path.
     *
     * For the **Rust** backend this calls `faust_wasm_generate_aux_files_json`
     * and decodes the base64 payloads in memory — no filesystem is required.
     *
     * For the **Emscripten** backend this calls the boolean
     * `generateAuxFiles(...)` and reads the produced files from the in-memory
     * `FS` directory `/<name>-svg/`.
     *
     * `process.svg` is always the first key when SVG output is requested,
     * matching the hierarchy entry-point convention used by the Rust renderer.
     *
     * @param name - logical DSP source name
     * @param code - Faust DSP source text
     * @param args - full compiler argument string including any required
     *   `-lang`, `-o`, and `-svg` flags
     */
    generateAuxFilesJson(
        name: string,
        code: string,
        args: string
    ): Record<string, string>;

    /**
     * Register or remove a named virtual source available to the Rust compiler.
     *
     * On the **Rust** backend, the source is encoded and injected as a
     * `--virtual-source name=base64` flag on every subsequent compile call,
     * so that `import("name")` resolves without a host filesystem.
     *
     * On the **Emscripten** backend this is a no-op: callers should write files
     * directly into `fs()` instead.
     *
     * @param name    - logical import name (e.g. `"ad.lib"`)
     * @param content - source text, or `null` to remove the entry
     */
    setVirtualSource(name: string, content: string | null): void;
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

    generateAuxFilesJson(
        name: string,
        code: string,
        args: string
    ): Record<string, string> {
        if (this.fCompiler instanceof RustLibFaust) {
            return this.fCompiler.generateAuxFilesJson(name, code, args);
        }
        // Emscripten path: call the boolean helper and read results from FS.
        const fs = this.fFileSystem;
        const dir = `/${name}-svg`;
        try {
            const existing: string[] = fs.readdir(dir);
            existing
                .filter((f) => f !== '.' && f !== '..')
                .forEach((f) => fs.unlink(`${dir}/${f}`));
        } catch {
            // Directory may not exist yet — that is fine.
        }
        const ok = this.fCompiler.generateAuxFiles(name, code, args);
        if (!ok) {
            throw new Error(this.fCompiler.getErrorAfterException());
        }
        const files: string[] = fs.readdir(dir);
        const result: Record<string, string> = {};
        // Ensure process.svg comes first, then alphabetical order.
        const sorted = files
            .filter((f) => f !== '.' && f !== '..')
            .sort((a, b) => {
                if (a === 'process.svg') return -1;
                if (b === 'process.svg') return 1;
                return a.localeCompare(b);
            });
        for (const file of sorted) {
            result[file] = fs.readFile(`${dir}/${file}`, {
                encoding: 'utf8'
            }) as string;
        }
        return result;
    }
    setVirtualSource(name: string, content: string | null) {
        if (this.fCompiler instanceof RustLibFaust) {
            this.fCompiler.setVirtualSource(name, content);
        }
        // Emscripten: no-op — callers write directly into fs() instead.
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
