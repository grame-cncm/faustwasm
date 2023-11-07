//@ts-check
import * as fs from "fs";
import * as path from "path";
import { cpSync } from "../fileutils.js";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const __filename = fileURLToPath(import.meta.url);

/**
 * @param {string} outputDir
 */
const copyWebStandaloneAssets = (outputDir) => {
    console.log(`Writing assets files.`)
    const assetsPath = path.join(__dirname, "../assets/standalone");
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir);
    cpSync(assetsPath, outputDir);
};

/**
 * @param {string} outputDir
 */
const copyTemplate = (outputDir, poly = false) => {
    console.log(`Writing index file.`)
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir);
    const templateJSPath = path.join(__dirname, "../assets/standalone/template.js");
    const templateHTMLPath = (poly) ? path.join(__dirname, "../assets/standalone/template-poly.html") : path.join(__dirname, "../assets/standalone/template.html");
    const faustwasmPath = path.join(__dirname, "../assets/standalone/faustwasm");
    cpSync(templateJSPath, outputDir + "/template.js");
    cpSync(templateHTMLPath, outputDir + "/template.html");
    cpSync(faustwasmPath, outputDir + "/faustwasm");
};

export { copyWebStandaloneAssets, copyTemplate };

