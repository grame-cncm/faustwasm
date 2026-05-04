import type FaustCompiler from './FaustCompiler';

interface IFaustSvgDiagrams {
    /**
     * Generates auxiliary files from Faust code. The output depends on the compiler options.
     *
     * @param name - the DSP's name
     * @param code - Faust code
     * @param args - compilation args
     * @returns the svg diagrams as a filename - svg string map
     */
    from(name: string, code: string, args: string): Record<string, string>;
}

/**
 * Helper that compiles a Faust DSP to SVG block diagrams and returns the
 * complete file hierarchy as an in-memory map.
 *
 * The returned `Record<string, string>` is keyed by relative SVG path (e.g.
 * `"process.svg"`, `"process_0x1234.svg"`).  `process.svg` is always the
 * first key: it is the hierarchy entry point and contains `href` links to
 * the sub-diagram files.
 *
 * ## Navigation model
 *
 * SVG `href` attributes use relative paths that match the map keys, so
 * drill-down navigation can be implemented with a simple path stack:
 *
 * 1. Initialise stack to `["process.svg"]`; render the top entry.
 * 2. On `<a>` click: push the clicked `href` value onto the stack and render
 *    the new top.
 * 3. On background click (outside any block): pop the stack and render the
 *    new top (go up one level).
 *
 * This matches the classic Faust IDE block-diagram browser behaviour.
 *
 * ## Backend transparency
 *
 * `from(...)` calls `FaustCompiler.generateAuxFilesJson(...)`, which works
 * with both the Emscripten and raw Rust compiler backends:
 * - **Rust**: retrieves all SVG files in-memory through the JSON ABI, no
 *   filesystem required.
 * - **Emscripten**: reads the SVG files from the in-memory `FS` directory.
 */
class FaustSvgDiagrams implements IFaustSvgDiagrams {
    private compiler: FaustCompiler;

    constructor(compiler: FaustCompiler) {
        this.compiler = compiler;
    }

    from(name: string, code: string, args: string) {
        const allFiles = this.compiler.generateAuxFilesJson(
            name,
            code,
            `-lang wasm -o binary -svg ${args}`
        );
        // Return only the SVG files (generateAuxFilesJson may include other
        // artifact types such as .json or .wasm when additional flags are passed).
        const svgs: Record<string, string> = {};
        for (const [path, content] of Object.entries(allFiles)) {
            if (path.endsWith('.svg')) {
                svgs[path] = content;
            }
        }
        return svgs;
    }
}

export default FaustSvgDiagrams;
