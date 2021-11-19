import FaustCompiler from "./FaustCompiler";
import type LibFaust from "./LibFaust";

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

class FaustSvgDiagrams {
    private fLibFaust: LibFaust;
    private compiler: FaustCompiler;

    constructor(libfaust: LibFaust) {
        this.fLibFaust = libfaust;
        this.compiler = new FaustCompiler(libfaust);
    }
    
    from(name: string, code: string, args: string) {
        const fs = this.fLibFaust.fs();
        try {
            const files: string[] = fs.readdir(`/${name}-svg/`);
            files.filter(file => file !== "." && file !== "..").forEach(file => fs.unlink(`/${name}-svg/${file}`));
        } catch {}
        const success = this.compiler.generateAuxFiles(name, code, `-lang wasm -svg ${args}`);
        if (!success) throw new Error(this.compiler.getErrorMessage());
        const svgs: Record<string, string> = {};
        const files: string[] = fs.readdir(`/${name}-svg/`);
        files.filter(file => file !== "." && file !== "..").forEach(file => svgs[file] = fs.readFile(`/${name}-svg/${file}`, { encoding: "utf8" }) as string);
        return svgs;
    }
}

export default FaustSvgDiagrams;
