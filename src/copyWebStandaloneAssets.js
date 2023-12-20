//@ts-check
import * as fs from "fs";
import * as path from "path";
import { cpSync, cpSyncModify, rmSync } from "../fileutils.js";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const __filename = fileURLToPath(import.meta.url);

/**
 * @param {string} outputDir - The output directory.
 * @param {string} dspName - The name of the DSP to be loaded.
 * @param {boolean} [poly] - Whether the DSP is polyphonic.
 */
const copyWebStandaloneAssets = (outputDir, dspName, poly = false) => {
    console.log(`Writing assets files.`)
    const assetsPath = path.join(__dirname, "../assets/standalone");
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir);

    // Copy some files
    const templateJSPath = (poly) ? path.join(__dirname, "../assets/standalone/index-poly.js") : path.join(__dirname, "../assets/standalone/index.js");
    cpSyncModify(templateJSPath, outputDir + `/${dspName}.js`, "FAUST_DSP", dspName);

    const templateHTMLPath = path.join(__dirname, "../assets/standalone/index.html");
    //cpSyncModify(templateHTMLPath, outputDir + `/${dspName}.html`, "FAUST_DSP", dspName);
    cpSyncModify(templateHTMLPath, outputDir + `/index.html`, "FAUST_DSP", dspName);

    const templateServerJSPath = path.join(__dirname, "../assets/standalone/service-worker.js");
    cpSyncModify(templateServerJSPath, outputDir + `/service-worker.js`, "FAUST_DSP", dspName);

    const templateIconPath = path.join(__dirname, "../assets/standalone/icon.png");
    cpSync(templateServerJSPath, outputDir + `/icon.png`);

    const faustwasmPath = path.join(__dirname, "../assets/standalone/faustwasm");
    cpSync(faustwasmPath, outputDir + "/faustwasm");

    const faustuiPath = path.join(__dirname, "../assets/standalone/faust-ui");
    cpSync(faustuiPath, outputDir + "/faust-ui");

    const templateManifestPath = path.join(__dirname, "../assets/standalone/manifest.json");
    cpSyncModify(templateManifestPath, outputDir + `/manifest.json`, "FAUST_DSP", dspName);
};

/**
 * @param {string} outputDir - The output directory.
 * @param {string} dspName - The name of the DSP to be loaded.
 * @param {boolean} [poly] - Whether the DSP is polyphonic.
 */
const copyWebTemplateAssets = (outputDir, dspName, poly = false) => {

    // Create output directory if it doesn't exist
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir);

    // Copy some files
    const templateJSPath = path.join(__dirname, "../assets/standalone/template.js");
    cpSync(templateJSPath, outputDir + `/${dspName}.js`);

    const templateHTMLPath = (poly) ? path.join(__dirname, "../assets/standalone/template-poly.html") : path.join(__dirname, "../assets/standalone/template.html");
    cpSyncModify(templateHTMLPath, outputDir + `/${dspName}.html`, "FAUST_DSP", dspName);

    const faustwasmPath = path.join(__dirname, "../assets/standalone/faustwasm");
    cpSync(faustwasmPath, outputDir + "/faustwasm");
};

export { copyWebStandaloneAssets, copyWebTemplateAssets };

