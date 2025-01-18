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

/** @type {HTMLSpanElement} */
const $spanAudioInput = document.getElementById("audio-input");
/** @type {HTMLSpanElement} */
const $spanMidiInput = document.getElementById("midi-input");
/** @type {HTMLSelectElement} */
const $selectAudioInput = document.getElementById("select-audio-input");
/** @type {HTMLSelectElement} */
const $selectMidiInput = document.getElementById("select-midi-input");
/** @type {HTMLSelectElement} */
const $buttonDsp = document.getElementById("button-dsp");
/** @type {HTMLDivElement} */
const $divFaustUI = document.getElementById("div-faust-ui");

/** @type {typeof AudioContext} */
const AudioCtx = window.AudioContext || window.webkitAudioContext;
const audioContext = new AudioCtx({ latencyHint: 0.00001 });
audioContext.destination.channelInterpretation = "discrete";
audioContext.suspend();

$buttonDsp.disabled = true;

(async () => {

    const { createFaustNode, connectToAudioInput, createFaustUI } = await import("./create-node.js");

    /**
    * @param {FaustAudioWorkletNode} faustNode 
    */
    const buildAudioDeviceMenu = async (faustNode) => {

        let inputStreamNode = null;
        const handleDeviceChange = async () => {
            const devicesInfo = await navigator.mediaDevices.enumerateDevices();
            $selectAudioInput.innerHTML = "";
            devicesInfo.forEach((deviceInfo, i) => {
                const { kind, deviceId, label } = deviceInfo;
                if (kind === "audioinput") {
                    const option = new Option(label || `microphone ${i + 1}`, deviceId);
                    $selectAudioInput.add(option);
                }
            });
        }
        await handleDeviceChange();
        navigator.mediaDevices.addEventListener("devicechange", handleDeviceChange)
        $selectAudioInput.onchange = async () => {
            const id = $selectAudioInput.value;
            if (faustNode.getNumInputs() > 0) {
                inputStreamNode = await connectToAudioInput(audioContext, id, faustNode, inputStreamNode);
            }
        };

        // Connect to the default audio input device
        if (faustNode.getNumInputs() > 0) {
            inputStreamNode = await connectToAudioInput(audioContext, null, faustNode, inputStreamNode);
        }
    };

    /**
     * @param {FaustAudioWorkletNode} faustNode 
     */
    const buildMidiDeviceMenu = async (faustNode) => {
        const midiAccess = await navigator.requestMIDIAccess();
        /** @type {WebMidi.MIDIInput} */
        let currentInput;
        /**
         * @param {WebMidi.MIDIMessageEvent} e
         */
        const handleMidiMessage = e => faustNode.midiMessage(e.data);
        const handleStateChange = () => {
            const { inputs } = midiAccess;
            if ($selectMidiInput.options.length === inputs.size + 1) return;
            if (currentInput) currentInput.removeEventListener("midimessage", handleMidiMessage);
            $selectMidiInput.innerHTML = '<option value="-1" disabled selected>Select...</option>';
            inputs.forEach((midiInput) => {
                const { name, id } = midiInput;
                const option = new Option(name, id);
                $selectMidiInput.add(option);
            });
        };
        handleStateChange();
        midiAccess.addEventListener("statechange", handleStateChange);
        $selectMidiInput.onchange = () => {
            if (currentInput) currentInput.removeEventListener("midimessage", handleMidiMessage);
            const id = $selectMidiInput.value;
            currentInput = midiAccess.inputs.get(id);
            currentInput.addEventListener("midimessage", handleMidiMessage);
        };
    };

    // To test the ScriptProcessorNode mode
    // const { faustNode, dspMeta: { name } } = await createFaustNode(audioContext, "FAUST_DSP_NAME", FAUST_DSP_VOICES, true);
    const { faustNode, dspMeta: { name } } = await createFaustNode(audioContext, "FAUST_DSP_NAME", FAUST_DSP_VOICES);
    if (!faustNode) throw new Error("Faust DSP not compiled");

    // Create the Faust UI
    await createFaustUI($divFaustUI, faustNode);

    // Connect the Faust node to the audio output
    faustNode.connect(audioContext.destination);

    // Build the audio device menu
    if (faustNode.numberOfInputs > 0) await buildAudioDeviceMenu(faustNode);
    else $spanAudioInput.hidden = true;

    // Build the MIDI device menu
    if (navigator.requestMIDIAccess) await buildMidiDeviceMenu(faustNode);
    else $spanMidiInput.hidden = true;

    // Set the title and enable the DSP button
    $buttonDsp.disabled = false;
    document.title = name;
    let sensorHandlersBound = false;
    $buttonDsp.onclick = async () => {
        // Activate sensor listeners
        if (!sensorHandlersBound) {
            await faustNode.startSensors();
            sensorHandlersBound = true;
        }
        if (audioContext.state === "running") {
            $buttonDsp.textContent = "Suspended";
            await audioContext.suspend();
        } else if (audioContext.state === "suspended") {
            $buttonDsp.textContent = "Running";
            await audioContext.resume();
        }
    }
})();
