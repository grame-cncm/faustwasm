//@ts-check
import * as fs from 'fs';
import * as path from 'path';
import {
    instantiateFaustModuleFromFile,
    instantiateRustFaustModuleFromFile,
    LibFaust,
    FaustCompiler,
    FaustSvgDiagrams
} from '../dist/esm/index.js';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * @param {string} inputFile
 * @param {string} outputDir
 * @param {string[]} [argv]
 * @param {{ rust?: boolean, rustWasm?: string }} [options]
 */
const faust2svgFiles = async (inputFile, outputDir, argv = [], options = {}) => {
    let faustModule;
    if (options.rust) {
        // Raw Rust compiler path — no Emscripten FS required.
        const wasmFile =
            options.rustWasm ||
            path.join(
                __dirname,
                '../../../RUST/faust-rs/target/wasm32-unknown-unknown/release/libfaust-rs.wasm'
            );
        faustModule = await instantiateRustFaustModuleFromFile(wasmFile);
    } else {
        faustModule = await instantiateFaustModuleFromFile(
            path.join(__dirname, '../libfaust-wasm/libfaust-wasm.js')
        );
    }
    const libFaust = new LibFaust(faustModule);
    const compiler = new FaustCompiler(libFaust);
    console.log(`Faust Compiler version: ${compiler.version()}`);
    console.log(`Reading file ${inputFile}`);
    const code = fs.readFileSync(inputFile, { encoding: 'utf8' });
    const { name } = path.parse(inputFile);
    const diagram = new FaustSvgDiagrams(compiler);
    const svgs = diagram.from(name, code, argv.join(' '));
    console.log(`Generated ${Object.keys(svgs).length} files.`);
    console.log(`Writing files to ${outputDir}`);
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
    for (const file in svgs) {
        const svgPath = path.join(outputDir, file);
        fs.writeFileSync(svgPath, svgs[file]);
    }
    return svgs;
};

export default faust2svgFiles;
