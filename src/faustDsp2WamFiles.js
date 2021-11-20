//@ts-check
const fs = require("fs");
const path = require("path");

/**
 * @param {import("./types").FaustDspMeta} dspMeta
 * @param {import("./types").FaustDspMeta} effectMeta
 * @param {boolean} [poly]
 * @returns {Record<string, any>}
 */
const faustDspToWam2Descriptor = (dspMeta, effectMeta, poly = false) => {
    /** @type {Record<string, any>} */
    const flatMeta = {};
    for (const metaItem of dspMeta.meta) {
        for (const key in metaItem) {
            flatMeta[key] = metaItem[key];
        }
    }
    const { name, author, description, version, keywords, isInstrument, website } = flatMeta;
    return {
        name: name || "Faust User",
        vendor: author,
        description: description || "",
        version: version || "1.0.0",
        apiVersion: "2.0.0",
        keywords: keywords ? keywords.split(", ") : [],
        isInstrument: isInstrument === "true",
        website: website || "",
        faustMeta: {
            poly,
            effect: !!effectMeta
        }
    }
};

/**
 * @param {import("./types").FaustDspMeta} dspMeta
 * @param {import("./types").FaustDspMeta} effectMeta
 * @param {string} outputDir
 * @param {boolean} [poly]
 */
const faustDsp2wam2Files = async (dspMeta, effectMeta, outputDir, poly = false) => {
    console.log(`Writing WAM2 assets files.`)
    const assetsPath = path.join(__dirname, "../assets/wam2");
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir);
    fs.cpSync(assetsPath, outputDir, { force: true, recursive: true });
    console.log(`Writing Descriptor file.`)
    const descriptorPath = path.join(outputDir, "descriptor.json");
    if (fs.existsSync(descriptorPath)) fs.rmSync(descriptorPath);
    fs.writeFileSync(descriptorPath, JSON.stringify(faustDspToWam2Descriptor(dspMeta, effectMeta, poly), null, 4));
};

module.exports = { default: faustDsp2wam2Files, faustDspToWam2Descriptor };


