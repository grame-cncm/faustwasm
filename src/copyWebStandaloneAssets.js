//@ts-check
import * as fs from "fs";
import * as path from "path";
import { cpSync, cpSyncModify } from "../fileutils.js";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const __filename = fileURLToPath(import.meta.url);

/**
 * @param {string} outputDir - The output directory.
 * @param {string} dspName - The name of the DSP to be loaded.
 * @param {boolean} [poly] - Whether the DSP is polyphonic.
 * @param {boolean} [effect] - Whether the DSP has an effect module.
 */
const copyWebStandaloneAssets = (outputDir, dspName, poly = false, effect = false) => {
    console.log(`Writing assets files.`)
    const assetsPath = path.join(__dirname, "../assets/standalone");
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir);

    const findAndReplace = ["FAUST_DSP_NAME", dspName];
    if (poly) findAndReplace.push("FAUST_DSP_VOICES = 0", "FAUST_DSP_VOICES = 16");
    if (poly && effect) findAndReplace.push("FAUST_DSP_HAS_EFFECT = false", "FAUST_DSP_HAS_EFFECT = true");

    // Copy some files
    const createNodeJSPath = path.join(__dirname, "../assets/standalone/create-node.js");
    cpSyncModify(createNodeJSPath, outputDir + `/create-node.js`, ...findAndReplace);

    const templateJSPath = path.join(__dirname, "../assets/standalone/index.js");
    cpSyncModify(templateJSPath, outputDir + `/index.js`, ...findAndReplace);

    const templateHTMLPath = path.join(__dirname, "../assets/standalone/index.html");
    //cpSyncModify(templateHTMLPath, outputDir + `/${dspName}.html`, "FAUST_DSP_NAME", dspName);
    cpSyncModify(templateHTMLPath, outputDir + `/index.html`, ...findAndReplace);

    const templateWorkerPath = path.join(__dirname, "../assets/standalone/service-worker.js");
    cpSyncModify(templateWorkerPath, outputDir + `/service-worker.js`, ...findAndReplace);

    const templateIconPath = path.join(__dirname, "../assets/standalone/icon.png");
    cpSync(templateIconPath, outputDir + `/icon.png`);

    const faustwasmPath = path.join(__dirname, "../assets/standalone/faustwasm");
    cpSync(faustwasmPath, outputDir + "/faustwasm");

    const faustuiPath = path.join(__dirname, "../assets/standalone/faust-ui");
    cpSync(faustuiPath, outputDir + "/faust-ui");

    const templateManifestPath = path.join(__dirname, "../assets/standalone/manifest.json");
    cpSyncModify(templateManifestPath, outputDir + `/manifest.json`, ...findAndReplace);
};

/**
 * @param {string} outputDir - The output directory.
 * @param {string} dspName - The name of the DSP to be loaded.
 * @param {boolean} [poly] - Whether the DSP is polyphonic.
 * @param {boolean} [effect] - Whether the DSP has an effect module.
 */
const copyWebTemplateAssets = (outputDir, dspName, poly = false, effect = false) => {

    // Create output directory if it doesn't exist
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir);

    const findAndReplace = ["FAUST_DSP_NAME", dspName];
    if (poly) findAndReplace.push("FAUST_DSP_VOICES = 0", "FAUST_DSP_VOICES = 16");
    if (poly && effect) findAndReplace.push("FAUST_DSP_HAS_EFFECT = false", "FAUST_DSP_HAS_EFFECT = true");

    // Copy some files
    const createNodeJSPath = path.join(__dirname, "../assets/standalone/create-node.js");
    cpSyncModify(createNodeJSPath, outputDir + `/create-node.js`, ...findAndReplace);

    const templateJSPath = path.join(__dirname, "../assets/standalone/index-template.js");
    cpSyncModify(templateJSPath, outputDir + `/index.js`, ...findAndReplace);

    const templateHTMLPath = path.join(__dirname, "../assets/standalone/index-template.html");
    cpSyncModify(templateHTMLPath, outputDir + `/index.html`, "index-template.js", "index.js", ...findAndReplace);

    const faustwasmPath = path.join(__dirname, "../assets/standalone/faustwasm");
    cpSync(faustwasmPath, outputDir + "/faustwasm");
};

export { copyWebStandaloneAssets, copyWebTemplateAssets };

