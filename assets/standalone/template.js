/**
 * @typedef {import("./types").FaustDspDistribution} FaustDspDistribution
 * @typedef {import("./faustwasm").FaustAudioWorkletNode} FaustAudioWorkletNode
 * @typedef {import("./faustwasm").FaustDspMeta} FaustDspMeta
*/

/**
 * Creates a Faust audio node for use in the Web Audio API.
 *
 * @param {AudioContext} audioContext - The Web Audio API AudioContext to which the Faust audio node will be connected.
 * @returns {Object} - An object containing the Faust audio node, the number of voices (if polyphonic), and the DSP metadata.
 */
const createFaustNode = async (audioContext) => {
    // Import necessary Faust modules and data
    const { FaustMonoDspGenerator, FaustPolyDspGenerator } = await import("./faustwasm/index.js");

    // Load DSP metadata from JSON
    /** @type {FaustDspMeta} */
    const dspMeta = await (await fetch("./dspMeta.json")).json();

    // Compile the DSP module from WebAssembly binary data
    const dspModule = await WebAssembly.compileStreaming(await fetch("./dspModule.wasm"));

    // Create an object representing Faust DSP with metadata and module
    /** @type {FaustDspDistribution} */
    const faustDsp = { dspMeta, dspModule };

    // Try to load optional mixer and effect modules
    try {
        faustDsp.mixerModule = await WebAssembly.compileStreaming(await fetch("./mixerModule.wasm"));
        faustDsp.effectMeta = await (await fetch("./effectMeta.json")).json();
        faustDsp.effectModule = await WebAssembly.compileStreaming(await fetch("./effectModule.wasm"));
    } catch (e) { }

    // Determine the number of voices based on the mixer module
    const voices = faustDsp.mixerModule ? 64 : 0;

    /** @type {FaustAudioWorkletNode} */
    let faustNode;

    // Create either a polyphonic or monophonic Faust audio node based on the number of voices
    if (voices) {
        const generator = new FaustPolyDspGenerator();
        faustNode = await generator.createNode(
            audioContext,
            voices,
            "FaustPolyDSP",
            { module: faustDsp.dspModule, json: JSON.stringify(faustDsp.dspMeta) },
            faustDsp.mixerModule,
            faustDsp.effectModule ? { module: faustDsp.effectModule, json: JSON.stringify(faustDsp.effectMeta) } : undefined
        );
    } else {
        const generator = new FaustMonoDspGenerator();
        faustNode = await generator.createNode(
            audioContext,
            "FaustMonoDSP",
            { module: faustDsp.dspModule, json: JSON.stringify(faustDsp.dspMeta) }
        );
    }

    // Return an object with the Faust audio node, the number of voices, and the DSP metadata
    return { faustNode, voices, dspMeta };
}