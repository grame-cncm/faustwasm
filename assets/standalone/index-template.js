// Set to > 0 if the DSP is polyphonic
const FAUST_DSP_VOICES = 0;

// Declare faustNode as a global variable
let faustNode;

// Create audio context activation button
/** @type {HTMLButtonElement} */
const $buttonDsp = document.getElementById("button-dsp");

// Create audio context
const AudioCtx = window.AudioContext || window.webkitAudioContext;
const audioContext = new AudioCtx({ latencyHint: 0.00001 });

// Activate AudioContext and Sensors on user interaction
$buttonDsp.disabled = true;
let sensorHandlersBound = false;
$buttonDsp.onclick = async () => {

    // Import the requestPermissions function
    const { requestPermissions } = await import("./create-node.js");

    // Request permission for sensors
    await requestPermissions();

    // Activate sensor listeners
    if (!sensorHandlersBound) {
        await faustNode.startSensors();
        sensorHandlersBound = true;
    }

    // Activate or suspend the AudioContext
    if (audioContext.state === "running") {
        $buttonDsp.textContent = "Suspended";
        await audioContext.suspend();
    } else if (audioContext.state === "suspended") {
        $buttonDsp.textContent = "Running";
        await audioContext.resume();
        if (FAUST_DSP_VOICES) play(faustNode);
    }
}

// Called at load time
(async () => {

    const { createFaustNode, connectToAudioInput } = await import("./create-node.js");

    const play = (node) => {
        node.keyOn(0, 60, 100);
        setTimeout(() => node.keyOn(0, 64, 100), 1000);
        setTimeout(() => node.keyOn(0, 67, 100), 2000);
        setTimeout(() => node.allNotesOff(), 5000);
        setTimeout(() => play(node), 7000);
    }

    // Create Faust node
    const result = await createFaustNode(audioContext, "FAUST_DSP_NAME", FAUST_DSP_VOICES);
    faustNode = result.faustNode;  // Assign to the global variable
    if (!faustNode) throw new Error("Faust DSP not compiled");

    // Connect the Faust node to the audio output
    faustNode.connect(audioContext.destination);

    // Connect the Faust node to the audio input
    if (faustNode.getNumInputs() > 0) {
        await connectToAudioInput(audioContext, null, faustNode, null);
    }

    // Create Faust node activation button
    $buttonDsp.disabled = false;

    // Set page title to the DSP name
    document.title = name;

})();
