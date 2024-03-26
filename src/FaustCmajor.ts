import type LibFaust from "./LibFaust";

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
    private fLibFaust: LibFaust;

    constructor(libfaust: LibFaust) {
        this.fLibFaust = libfaust;
    }

    compile(name: string, code: string, args: string) {
        const fs = this.fLibFaust.fs();
        const success = this.fLibFaust.generateAuxFiles(name, code, `-lang cmajor-hybrid -cn ${name} -o ${name}.cmajor`);
        return (success) ? fs.readFile(`${name}.cmajor`, { encoding: "utf8" }) as string : "";
    }
}

export default FaustCmajor;
