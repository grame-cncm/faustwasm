// Set to > 0 is the DSP is polyphonic
const FAUST_DSP_VOICES = 0;

/**
 * @typedef {import("./types").FaustDspDistribution} FaustDspDistribution
 * @typedef {import("./faustwasm").FaustAudioWorkletNode} FaustAudioWorkletNode
 * @typedef {import("./faustwasm").FaustDspMeta} FaustDspMeta
*/

/**
 * Creates a Faust audio node for use in the Web Audio API.
 *
 * @param {AudioContext} audioContext - The Web Audio API AudioContext to which the Faust audio node will be connected.
 * @param {string} [dspName] - The name of the DSP to be loaded.
 * @param {number} [voices] - The number of voices to be used for polyphonic DSPs.
 * @param {boolean} [sp] - Whether to create a ScriptProcessorNode instead of an AudioWorkletNode.
 * @returns {Promise<any>} - An object containing the Faust audio node and the DSP metadata.
 */
const createFaustNode = async (audioContext, dspName = "template", voices = 0, sp = false) => {
    // Set to true if the DSP has an effect
    const FAUST_DSP_HAS_EFFECT = false;

    // Import necessary Faust modules and data
    const { FaustMonoDspGenerator, FaustPolyDspGenerator } = await import("./faustwasm/index.js");

    // Load DSP metadata from JSON
    /** @type {FaustDspMeta} */
    const dspMeta = await (await fetch("./dsp-meta.json")).json();

    // Compile the DSP module from WebAssembly binary data
    const dspModule = await WebAssembly.compileStreaming(await fetch("./dsp-module.wasm"));

    // Create an object representing Faust DSP with metadata and module
    /** @type {FaustDspDistribution} */
    const faustDsp = { dspMeta, dspModule };

    /** @type {FaustAudioWorkletNode} */
    let faustNode;

    // Create either a polyphonic or monophonic Faust audio node based on the number of voices
    if (voices > 0) {

        // Try to load optional mixer and effect modules
        faustDsp.mixerModule = await WebAssembly.compileStreaming(await fetch("./mixer-module.wasm"));

        if (FAUST_DSP_HAS_EFFECT) {
            faustDsp.effectMeta = await (await fetch("./effect-meta.json")).json();
            faustDsp.effectModule = await WebAssembly.compileStreaming(await fetch("./effect-module.wasm"));
        }

        const generator = new FaustPolyDspGenerator();
        faustNode = await generator.createNode(
            audioContext,
            voices,
            dspName,
            { module: faustDsp.dspModule, json: JSON.stringify(faustDsp.dspMeta), soundfiles: {} },
            faustDsp.mixerModule,
            faustDsp.effectModule ? { module: faustDsp.effectModule, json: JSON.stringify(faustDsp.effectMeta), soundfiles: {} } : undefined,
            sp
        );
    } else {
        const generator = new FaustMonoDspGenerator();
        faustNode = await generator.createNode(
            audioContext,
            dspName,
            { module: faustDsp.dspModule, json: JSON.stringify(faustDsp.dspMeta), soundfiles: {} },
            sp
        );
    }

    // Return an object with the Faust audio node and the DSP metadata
    return { faustNode, dspMeta };
}