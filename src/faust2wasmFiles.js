//@ts-check
import * as fs from 'fs';
import * as path from 'path';
import {
    instantiateFaustModuleFromFile,
    LibFaust,
    FaustCompiler,
    FaustMonoDspGenerator,
    FaustPolyDspGenerator
} from '../dist/esm/index.js';
import { fileURLToPath } from 'url';

// Include handling overview (WASM compiler only sees its in-memory FS):
// 1) Grab the Faust FS via compiler.fs() and compute inputDir from inputFile.
// 2) Parse include args with parseIncludeArgs(argv):
//    - Collects only `-I <dir>` into includeDirs.
//    - Preserves non-include args as otherArgs.
// 3) Helper utilities:
//    - ensureFsDir(dir) creates in-memory directories via mkdirTree (errors ignored).
//    - isFaustSource(filePath) filters to .lib/.dsp files.
//    - copyIncludeDirToFs(srcDir, destDir) mirrors Faust sources into the in-memory FS.
// 4) Build include list:
//    - Always add inputDir.
//    - Add any user-provided `-I` dirs.
//    - Classify each include as host (disk) or fs (already in-memory).
// 5) Mirror host includes into the in-memory FS:
//    - Map each host include to /faust/user/incN.
//    - Copy sources into that path.
//    - Record the mapped in-memory include dir.
// 6) Rewrite argv to only use in-memory include dirs:
//    - Clear argv.
//    - Add `-I /faust/user/incN` (and any original fs include dirs).
//    - Append otherArgs, then `-ftz 2` as usual.

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 *  Script to compile a Faust DSP file to WebAssembly and write the output to files.
 *
 * @param {string} inputFile : The path to the Faust DSP file.
 * @param {string} outputDir : The path to the output directory.
 * @param {string[]} [argv] : An array of command-line arguments to pass to the Faust compiler.
 * @param {boolean} [poly] : Whether to compile the DSP as a polyphonic instrument.
 */
const faust2wasmFiles = async (
    inputFile,
    outputDir,
    argv = [],
    poly = false
) => {
    const faustModule = await instantiateFaustModuleFromFile(
        path.join(__dirname, '../libfaust-wasm/libfaust-wasm.js')
    );
    const libFaust = new LibFaust(faustModule);
    const compiler = new FaustCompiler(libFaust);
    console.log(`Faust Compiler version: ${compiler.version()}`);
    console.log(`Reading file ${inputFile}`);
    const code = fs.readFileSync(inputFile, { encoding: 'utf8' });

    // Step 1: get the compiler's in-memory FS (host FS is not visible to WASM).
    const faustFs = compiler.fs();
    const inputDir = path.dirname(path.resolve(inputFile));
    // Step 2: split include flags from other args so we can remap include paths.
    const parseIncludeArgs = (args) => {
        const includeDirs = [];
        const otherArgs = [];
        for (let i = 0; i < args.length; i += 1) {
            const arg = args[i];
            if (arg === '-I' && args[i + 1]) {
                includeDirs.push(args[i + 1]);
                i += 1;
                continue;
            }
            otherArgs.push(arg);
        }
        return { includeDirs, otherArgs };
    };
    // Step 3: helpers to build the in-memory include tree.
    const ensureFsDir = (dir) => {
        try {
            faustFs.mkdirTree(dir);
        } catch {
            // Already present, or created concurrently: either is fine.
        }
    };
    const isFaustSource = (filePath) => {
        const ext = path.extname(filePath).toLowerCase();
        return ext === '.lib' || ext === '.dsp';
    };
    // Step 4: mirror a host include directory into the in-memory FS.
    const copyIncludeDirToFs = (srcDir, destDir) => {
        if (!fs.existsSync(srcDir) || !fs.statSync(srcDir).isDirectory())
            return;
        const entries = fs.readdirSync(srcDir, { withFileTypes: true });
        for (const entry of entries) {
            const srcPath = path.join(srcDir, entry.name);
            const destPath = path.posix.join(destDir, entry.name);
            if (entry.isDirectory()) {
                copyIncludeDirToFs(srcPath, destPath);
                continue;
            }
            if (!entry.isFile() || !isFaustSource(srcPath)) continue;
            ensureFsDir(path.posix.dirname(destPath));
            faustFs.writeFile(destPath, fs.readFileSync(srcPath));
        }
    };
    // Step 5: parse include args and build a unified include list.
    const { includeDirs: rawIncludeDirs, otherArgs } = parseIncludeArgs(argv);
    const includeDirs = [];
    const seenHostDirs = new Set();
    const seenFsDirs = new Set();
    const addIncludeDir = (dir) => {
        if (!dir) return;
        const resolved = path.resolve(dir);
        if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
            if (seenHostDirs.has(resolved)) return;
            seenHostDirs.add(resolved);
            includeDirs.push({ type: 'host', path: resolved });
            return;
        }
        if (seenFsDirs.has(dir)) return;
        seenFsDirs.add(dir);
        includeDirs.push({ type: 'fs', path: dir });
    };
    // Step 6: always include the DSP's directory, then user-provided -I dirs.
    addIncludeDir(inputDir);
    rawIncludeDirs.forEach(addIncludeDir);
    // Step 7: map host include dirs into /faust/user/incN in the in-memory FS.
    const memfsIncludeDirs = [];
    let includeIndex = 0;
    for (const includeDir of includeDirs) {
        if (includeDir.type === 'fs') {
            memfsIncludeDirs.push(includeDir.path);
            continue;
        }
        const memfsDir = path.posix.join(
            '/faust',
            'user',
            `inc${includeIndex}`
        );
        includeIndex += 1;
        copyIncludeDirToFs(includeDir.path, memfsDir);
        memfsIncludeDirs.push(memfsDir);
    }
    // Step 8: rewrite argv to use only in-memory include paths.
    argv.length = 0;
    memfsIncludeDirs.forEach((dir) => argv.push('-I', dir));
    argv.push(...otherArgs);
    // Flush to zero to avoid costly denormalized numbers
    argv.push('-ftz', '2');
    const dspModulePath = path.join(outputDir, `dsp-module.wasm`);
    const dspMetaPath = path.join(outputDir, `dsp-meta.json`);
    const effectModulePath = path.join(outputDir, `effect-module.wasm`);
    const effectMetaPath = path.join(outputDir, `effect-meta.json`);
    const mixerModulePath = path.join(outputDir, 'mixer-module.wasm');
    /** @type {Uint8Array} */
    let dspModule;
    /** @type {import("./types").FaustDspMeta} */
    let dspMeta;
    /** @type {Uint8Array | null} */
    let effectModule = null;
    /** @type {import("./types").FaustDspMeta | null} */
    let effectMeta = null;
    /** @type {Uint8Array | null} */
    let mixerModule = null;
    const { name } = path.parse(inputFile);
    if (poly) {
        const generator = new FaustPolyDspGenerator();
        const t1 = Date.now();
        const dsp = await generator.compile(
            compiler,
            name,
            code,
            argv.join(' ')
        );
        if (!dsp) throw new Error('Faust DSP not compiled');
        const { voiceFactory, effectFactory, mixerBuffer } = dsp;
        if (!voiceFactory) throw new Error('Faust DSP Factory not compiled');
        console.log(`Compilation successful (${Date.now() - t1} ms).`);
        dspModule = voiceFactory.code;
        dspMeta = JSON.parse(voiceFactory.json);
        mixerModule = mixerBuffer;
        if (effectFactory) {
            effectModule = effectFactory.code;
            effectMeta = JSON.parse(effectFactory.json);
        }
    } else {
        const generator = new FaustMonoDspGenerator();
        const t1 = Date.now();
        const dsp = await generator.compile(
            compiler,
            name,
            code,
            argv.join(' ')
        );
        if (!dsp) throw new Error('Faust DSP not compiled');
        const { factory } = dsp;
        if (!factory) throw new Error('Faust DSP Factory not compiled');
        console.log(`Compilation successful (${Date.now() - t1} ms).`);
        dspModule = factory.code;
        dspMeta = JSON.parse(factory.json);
    }
    // Every file this script may write, whether or not this run writes it:
    // a mono build in a directory that held a poly one has to take the effect
    // and mixer modules away, or they stay behind next to a mono index.js.
    const outputs = [
        dspModulePath,
        dspMetaPath,
        effectModulePath,
        effectMetaPath,
        mixerModulePath
    ];

    console.log(`Writing files to ${outputDir}`);
    fs.mkdirSync(outputDir, { recursive: true });
    for (const filePath of outputs) {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }
    fs.writeFileSync(dspModulePath, dspModule);
    fs.writeFileSync(dspMetaPath, JSON.stringify(dspMeta, null, 4));
    if (effectModule && effectMeta) {
        fs.writeFileSync(effectModulePath, effectModule);
        fs.writeFileSync(effectMetaPath, JSON.stringify(effectMeta, null, 4));
    }
    if (mixerModule) fs.writeFileSync(mixerModulePath, mixerModule);
    return { dspMeta, effectMeta };
};

export default faust2wasmFiles;
