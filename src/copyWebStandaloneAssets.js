//@ts-check
const fs = require("fs");
const path = require("path");
const { cpSync } = require("../fileutils");

/**
 * @param {string} outputDir
 */
const copyWebStandaloneAssets = (outputDir) => {
    console.log(`Writing assets files.`)
    const assetsPath = path.join(__dirname, "../assets/standalone");
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir);
    cpSync(assetsPath, outputDir);
};

module.exports = { default: copyWebStandaloneAssets };
