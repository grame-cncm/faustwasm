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

(async () => {

    // To test the ScriptProcessorNode mode
    // const { faustNode, dspMeta: { name } } = await createFaustNode(audioContext, "osc", FAUST_DSP_VOICES, true);
    const { createFaustNode } = await import("./create-node.js");
    const { faustNode, dspMeta: { name } } = await createFaustNode(audioContext, "osc", FAUST_DSP_VOICES);
    if (!faustNode) throw new Error("Faust DSP not compiled");

    // Create the Faust UI
    const { createFaustUI } = await import("./create-node.js");
    await createFaustUI($divFaustUI, faustNode);

    // Connect the Faust node to the audio output
    faustNode.connect(audioContext.destination);

    // Connect the Faust node to the audio input
    if (faustNode.numberOfInputs > 0) {
        const { connectToAudioInput } = await import("./create-node.js");
        await connectToAudioInput(audioContext, null, faustNode, null);
    }

    // Function to initialize MIDI
    function initMIDI() {
        // Check if the browser supports the Web MIDI API
        if (navigator.requestMIDIAccess) {
            navigator.requestMIDIAccess().then(
                midiAccess => {
                    console.log("MIDI Access obtained.");
                    for (let input of midiAccess.inputs.values()) {
                        input.onmidimessage = (event) => faustNode.midiMessage(event.data);
                        console.log(`Connected to input: ${input.name}`);
                    }
                },
                () => console.error("Failed to access MIDI devices.")
            );
        } else {
            console.log("Web MIDI API is not supported in this browser.");
        }
    }

    // Function to resume AudioContext, activate MIDI and Sensors on user interaction
    function activateAudioMIDISensors() {

        // Resume the AudioContext
        if (audioContext.state === 'suspended') {
            audioContext.resume();
        }

        // Activate sensor listeners
        faustNode.listenSensors();

        // Initialize the MIDI setup
        if (FAUST_DSP_VOICES > 0) {
            initMIDI();
        }
    }

    // Add event listeners for user interactions
    window.addEventListener('click', activateAudioMIDISensors);
    window.addEventListener('touchstart', activateAudioMIDISensors);

})();
