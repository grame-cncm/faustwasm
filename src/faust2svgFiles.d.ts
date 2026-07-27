declare const faust2svgFiles: (
    inputFile: string,
    outputDir: string,
    argv?: string[],
    options?: {
        /** Use the raw Rust compiler module instead of the Emscripten module. */
        rust?: boolean;
        /** Path to `libfaust-rs.wasm` when `rust` is true. */
        rustWasm?: string;
    }
) => Promise<Record<string, string>>;

export default faust2svgFiles;
