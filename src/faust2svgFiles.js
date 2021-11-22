//@ts-check
const path = require("path");
const fs = require("fs");
/** @type {import("../dist")} */
const {
    instantiateFaustModule,
    LibFaust,
    FaustCompiler,
    FaustSvgDiagrams
} = require(path.join(__dirname, "../dist"));

/**
 * @param {string} inputFile
 * @param {string} outputDir
 * @param {string[]} [argv]
 */
const faust2svgFiles = async (inputFile, outputDir, argv = []) => {
    const faustModule = await instantiateFaustModule(path.join(__dirname, "../libfaust-wasm/libfaust-wasm.js"));
    const libFaust = new LibFaust(faustModule);
    const compiler = new FaustCompiler(libFaust);
    console.log(`Faust Compiler version: ${compiler.version()}`);
    console.log(`Reading file ${inputFile}`);
    const code = fs.readFileSync(inputFile, { encoding: "utf8" });

    if (!argv.find(a => a === "-I")) argv.push("-I", "libraries/");
    const { name } = path.parse(inputFile);
    const diagram = new FaustSvgDiagrams(compiler);
    const svgs = diagram.from(name, code, argv.join(" "));
    console.log(`Generated ${Object.keys(svgs).length} files.`);

    console.log(`Writing files to ${outputDir}`);
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir);
    for (const file in svgs) {
        const svgPath = path.join(outputDir, file);
        fs.writeFileSync(svgPath, svgs[file]);
    }
    return svgs;
};

module.exports = { default: faust2svgFiles };
