//@ts-check
import * as fs from "fs";
import * as path from "path";
import {
    instantiateFaustModuleFromFile,
    LibFaust,
    FaustCompiler,
    FaustCmajor
} from "../dist/esm/index.js";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const __filename = fileURLToPath(import.meta.url);

/**
 * @param {string} inputFile
 * @param {string} outputDir
 * @param {string[]} [argv]
 */
const faust2CmajorFiles = async (inputFile, outputDir, argv = []) => {
    const faustModule = await instantiateFaustModuleFromFile(path.join(__dirname, "../libfaust-wasm/libfaust-wasm.js"));
    const libFaust = new LibFaust(faustModule);
    const compiler = new FaustCompiler(libFaust);
    console.log(`Faust Compiler version: ${compiler.version()}`);
    console.log(`Reading file ${inputFile}`);
    const code = fs.readFileSync(inputFile, { encoding: "utf8" });
    const { name } = path.parse(inputFile);
    const cmajor = new FaustCmajor(compiler);
    if (!argv.find(a => a === "-I")) argv.push("-I", "libraries/");
    const cmajor_file = cmajor.compile(name, code, argv.join(" "));
    console.log(`Writing files to ${outputDir}`);
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir);
    const cmajorPath = path.join(outputDir, `${name}.cmajor`);
    fs.writeFileSync(cmajorPath, cmajor_file);
    return cmajor_file;
};

export default faust2CmajorFiles;
