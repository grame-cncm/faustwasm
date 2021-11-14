//@ts-check
const fs = require("fs");
const path = require("path");

/**
 * @param {import("./types").FaustDspMeta} faustDspMeta
 * @returns {import("@webaudiomodules/api").WamDescriptor}
 */
const faustMetaToWam2Descriptor = (faustDspMeta) => {
    const flatMeta = {};
    for (const metaItem of faustDspMeta.meta) {
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
        // @ts-ignore
        apiVersion: "2.0.0",
        keywords: keywords ? keywords.split(", ") : [],
        isInstrument: isInstrument === "true",
        website: website || ""
    }
};

/**
 * @param {import("./types").FaustDspMeta} dspMeta
 * @param {string} outputDir
 * @param {boolean} [poly]
 */
const faustDsp2wam2Files = async (dspMeta, outputDir, poly = false) => {
    console.log(`Writing WAM2 assets files.`)
    const assetsPath = path.join(__dirname, "../assets/wam2");
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir);
    fs.cpSync(assetsPath, outputDir, { force: true, recursive: true });
    const mixerPath = path.join(outputDir, "./mixerModule.wasm");
    if (!poly) fs.rmSync(mixerPath);
    console.log(`Writing Descriptor file.`)
    const descriptorPath = path.join(outputDir, "descriptor.json");
    if (fs.existsSync(descriptorPath)) fs.rmSync(descriptorPath);
    fs.writeFileSync(descriptorPath, JSON.stringify(faustMetaToWam2Descriptor(dspMeta), null, 4));
};

module.exports = { default: faustDsp2wam2Files, faustMetaToWam2Descriptor };


