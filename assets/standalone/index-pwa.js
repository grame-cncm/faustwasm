// Set to > 0 if the DSP is polyphonic
const FAUST_DSP_VOICES = 0;

/**
 * @typedef {import("./faustwasm").FaustAudioWorkletNode} FaustAudioWorkletNode
 * @typedef {import("./faustwasm").FaustDspMeta} FaustDspMeta
 * @typedef {import("./faustwasm").FaustUIDescriptor} FaustUIDescriptor
 * @typedef {import("./faustwasm").FaustUIGroup} FaustUIGroup
 * @typedef {import("./faustwasm").FaustUIItem} FaustUIItem
 */

/**
 * Registers the service worker.
 */
if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
        navigator.serviceWorker.register("./service-worker.js")
            .then(reg => console.log("Service Worker registered", reg))
            .catch(err => console.log("Service Worker registration failed", err));
    });
}

/** @type {HTMLDivElement} */
const $divFaustUI = document.getElementById("div-faust-ui");

/** @type {typeof AudioContext} */
const AudioCtx = window.AudioContext || window.webkitAudioContext;
const audioContext = new AudioCtx({ latencyHint: 0.00001 });
audioContext.destination.channelInterpretation = "discrete";
audioContext.suspend();

/**
 * @param {FaustAudioWorkletNode} faustNode 
 */
const createFaustUI = async (faustNode) => {
    const { FaustUI } = await import("./faust-ui/index.js");
    const $container = document.createElement("div");
    $container.style.margin = "0";
    $container.style.position = "absolute";
    $container.style.overflow = "auto";
    $container.style.display = "flex";
    $container.style.flexDirection = "column";
    $container.style.width = "100%";
    $container.style.height = "100%";
    $divFaustUI.appendChild($container);
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

(async () => {

    const { createFaustNode } = await import("./create-node.js");

    // To test the ScriptProcessorNode mode
    // const { faustNode, dspMeta: { name } } = await createFaustNode(audioContext, "osc", FAUST_DSP_VOICES, true);
    const { faustNode, dspMeta: { name } } = await createFaustNode(audioContext, "osc", FAUST_DSP_VOICES);
    if (!faustNode) throw new Error("Faust DSP not compiled");

    // Create the Faust UI
    await createFaustUI(faustNode);

    // Connect the Faust node to the audio output
    faustNode.connect(audioContext.destination);

    // Connect the Faust node to the audio input
    if (faustNode.getNumInputs() > 0) {
        const { connectToAudioInput } = await import("./create-node.js");
        await connectToAudioInput(audioContext, null, faustNode, null);
    }

    // Activate sensor listeners
    await faustNode.listenSensors();

    // Function to initialize MIDI
    function initMIDI() {
        // Check if the browser supports the Web MIDI API
        if (navigator.requestMIDIAccess) {
            navigator.requestMIDIAccess()
                .then(onMIDISuccess, onMIDIFailure);
        } else {
            console.log("Web MIDI API is not supported in this browser.");
        }
    }

    // Success callback for requesting MIDI access
    function onMIDISuccess(midiAccess) {
        console.log("MIDI Access obtained.");
        // Iterate through all available MIDI inputs
        for (let input of midiAccess.inputs.values()) {
            // Attach the event listener to each input
            input.onmidimessage = handleMIDIMessage;
            console.log(`Connected to input: ${input.name}`);
        }
    }

    // Failure callback for requesting MIDI access
    function onMIDIFailure() {
        console.error("Failed to access MIDI devices.");
    }

    // Dummy event handler for MIDI messages
    function handleMIDIMessage(event) {
        faustNode.midiMessage(event.data);
    }

    // Initialize the MIDI setup
    if (FAUST_DSP_VOICES > 0) {
        initMIDI();
    }

})();

// Function to resume AudioContext on user interaction
function resumeAudioContext() {
    if (audioContext.state === 'suspended') {
        audioContext.resume();
    }
}

// Add event listeners for user interactions
window.addEventListener('click', resumeAudioContext);
window.addEventListener('touchstart', resumeAudioContext);

// Optional: Remove event listeners once the context is resumed
audioContext.onstatechange = function () {
    if (audioContext.state === 'running') {
        window.removeEventListener('click', resumeAudioContext);
        window.removeEventListener('touchstart', resumeAudioContext);
    }
};