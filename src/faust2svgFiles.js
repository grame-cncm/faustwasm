//@ts-check
const path = require("path");
const fs = require("fs");
/** @type {import("../dist")} */
const {
    instantiateLibFaust,
    Faust
} = require(path.join(__dirname, "../dist"));

/**
 * @param {string} inputFile
 * @param {string} outputDir
 * @param {string[]} [argv]
 */
const faust2svgFiles = async (inputFile, outputDir, argv = []) => {
    const libFaust = await instantiateLibFaust(path.join(__dirname, "../libfaust-wasm/libfaust-wasm.js"));
    const faust = new Faust(libFaust);
    console.log(`Faust Compiler version: ${faust.version}`);
    console.log(`Reading file ${inputFile}`);
    const code = fs.readFileSync(inputFile, { encoding: "utf8" });

    if (!argv.find(a => a === "-I")) argv.push("-I", "libraries/");
    const svgs = faust.getDiagram(code, argv);
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
