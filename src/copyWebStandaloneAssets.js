//@ts-check
import * as fs from "fs";
import * as path from "path";
import { cpSync, rmSync } from "../fileutils.js";
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
    // Copy all files
    cpSync(assetsPath, outputDir);
    // Then remove template files
    rmSync(path.join(outputDir, "/template.js"));
    rmSync(path.join(outputDir, "/template.html"));
    rmSync(path.join(outputDir, "/template-poly.html"));
};

/**
 * @param {string} outputDir
 */
const copyTemplate = (outputDir, poly = false) => {
    console.log(`Writing index file.`)
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir);
    // Copy some files
    const templateJSPath = path.join(__dirname, "../assets/standalone/template.js");
    const templateHTMLPath = (poly) ? path.join(__dirname, "../assets/standalone/template-poly.html") : path.join(__dirname, "../assets/standalone/template.html");
    const faustwasmPath = path.join(__dirname, "../assets/standalone/faustwasm");
    cpSync(templateJSPath, outputDir + "/template.js");
    cpSync(templateHTMLPath, outputDir + "/template.html");
    cpSync(faustwasmPath, outputDir + "/faustwasm");
};

export { copyWebStandaloneAssets, copyTemplate };

