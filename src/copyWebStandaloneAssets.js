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

export default copyWebStandaloneAssets;
