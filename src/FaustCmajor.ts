import type FaustCompiler from "./FaustCompiler";

interface IFaustCmajor {
    /**
     * Generates auxiliary files from Faust code. The output depends on the compiler options.
     *
     * @param name - the DSP's name
     * @param code - Faust code
     * @param args - compilation args
     * @returns the Cmajor compiled string
     */
    compile(name: string, code: string, args: string): string;
}

class FaustCmajor implements IFaustCmajor {
    private compiler: FaustCompiler;

    constructor(compiler: FaustCompiler) {
        this.compiler = compiler;
    }

    compile(name: string, code: string, args: string) {
        const fs = this.compiler.fs();
        const success = this.compiler.generateAuxFiles(name, code, `-lang cmajor-hybrid -cn ${name} -o ${name}.cmajor`);
        return (success) ? fs.readFile(`${name}.cmajor`, { encoding: "utf8" }) as string : "";
    }
}

export default FaustCmajor;
