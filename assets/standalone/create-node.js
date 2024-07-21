// @ts-check

/**
 * @typedef {{ dspModule: WebAssembly.Module; dspMeta: FaustDspMeta; effectModule?: WebAssembly.Module; effectMeta?: FaustDspMeta; mixerModule?: WebAssembly.Module }} FaustDspDistribution
 * @typedef {import("./faustwasm").FaustDspMeta} FaustDspMeta
 * @typedef {import("./faustwasm").FaustMonoAudioWorkletNode} FaustMonoAudioWorkletNode
 * @typedef {import("./faustwasm").FaustPolyAudioWorkletNode} FaustPolyAudioWorkletNode
 * @typedef {import("./faustwasm").FaustMonoScriptProcessorNode} FaustMonoScriptProcessorNode
 * @typedef {import("./faustwasm").FaustPolyScriptProcessorNode} FaustPolyScriptProcessorNode
 * @typedef {FaustMonoAudioWorkletNode | FaustPolyAudioWorkletNode | FaustMonoScriptProcessorNode | FaustPolyScriptProcessorNode} FaustNode
 */

/**
 * Creates a Faust audio node for use in the Web Audio API.
 *
 * @param {AudioContext} audioContext - The Web Audio API AudioContext to which the Faust audio node will be connected.
 * @param {string} [dspName] - The name of the DSP to be loaded.
 * @param {number} [voices] - The number of voices to be used for polyphonic DSPs.
 * @param {boolean} [sp] - Whether to create a ScriptProcessorNode instead of an AudioWorkletNode.
 * @returns {Promise<{ faustNode: FaustNode | null; dspMeta: FaustDspMeta }>} - An object containing the Faust audio node and the DSP metadata.
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

    /** @type {FaustNode | null} */
    let faustNode = null;

    // Create either a polyphonic or monophonic Faust audio node based on the number of voices
    if (voices > 0) {

        // Try to load optional mixer and effect modules
        faustDsp.mixerModule = await WebAssembly.compileStreaming(await fetch("./mixer-module.wasm"));

        if (FAUST_DSP_HAS_EFFECT) {
            faustDsp.effectMeta = await (await fetch("./effect-meta.json")).json();
            faustDsp.effectModule = await WebAssembly.compileStreaming(await fetch("./effect-module.wasm"));
        }

        // Create a polyphonic Faust audio node
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
        // Create a standard Faust audio node
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

/**
 * Connects an audio input stream to a Faust audio node.
 * 
 * @param {AudioContext} audioContext - The Web Audio API AudioContext to which the Faust audio node is connected.
 * @param {string} id - The ID of the audio input device to connect.
 * @param {FaustNode} faustNode - The Faust audio node to which the audio input stream will be connected.
 * @param {MediaStreamAudioSourceNode} inputStreamNode - The audio input stream node to be disconnected from the Faust audio node.
 * @returns {Promise<MediaStreamAudioSourceNode>} - The audio input stream node connected to the Faust audio node.
 */
async function connectToAudioInput(audioContext, id, faustNode, inputStreamNode) {
    // Create an audio input stream node
    const constraints = {
        audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
            deviceId: id ? { exact: id } : undefined,
        },
    };
    // Get the audio input stream
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    if (stream) {
        if (inputStreamNode) inputStreamNode.disconnect();
        inputStreamNode = audioContext.createMediaStreamSource(stream);
        inputStreamNode.connect(faustNode);
    }
    return inputStreamNode;
};

/**
 * @param {FaustAudioWorkletNode} faustNode 
 */
async function createFaustUI(divFaustUI, faustNode) {
    const { FaustUI } = await import("./faust-ui/index.js");
    const $container = document.createElement("div");
    $container.style.margin = "0";
    $container.style.position = "absolute";
    $container.style.overflow = "auto";
    $container.style.display = "flex";
    $container.style.flexDirection = "column";
    $container.style.width = "100%";
    $container.style.height = "100%";
    divFaustUI.appendChild($container);
    const faustUI = new FaustUI({
        ui: faustNode.getUI(),
        root: $container,
        listenWindowMessage: false,
        listenWindowResize: true,
    });
    faustUI.paramChangeByUI = (path, value) => faustNode.setParamValue(path, value);
    faustNode.setOutputParamHandler((path, value) => faustUI.paramChangeByDSP(path, value));
    $container.style.minWidth = `${faustUI.minWidth}px`;
    $container.style.minHeight = `${faustUI.minHeight}px`;
    faustUI.resize();
};

// Export the functions
export { createFaustNode, createFaustUI, connectToAudioInput };

