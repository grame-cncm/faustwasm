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

/**
 * @param {FaustAudioWorkletNode} faustNode 
 */
const buildAudioDeviceMenu = async (faustNode) => {
    /** @type {MediaStreamAudioSourceNode} */
    let inputStreamNode;
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
        const constraints = {
            audio: {
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false,
                deviceId: id ? { exact: id } : undefined,
            },
        };
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        if (inputStreamNode) inputStreamNode.disconnect();
        inputStreamNode = audioContext.createMediaStreamSource(stream);
        inputStreamNode.connect(faustNode);
    };

    const defaultConstraints = {
        audio: {
            echoCancellation: false,
            mozNoiseSuppression: false,
            mozAutoGainControl: false
        }
    };
    const defaultStream = await navigator.mediaDevices.getUserMedia(defaultConstraints);
    if (defaultStream) {
        inputStreamNode = audioContext.createMediaStreamSource(defaultStream);
        inputStreamNode.connect(faustNode);
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
    const { default: createFaustNode } = await import("./create-node.js");
    // To test the ScriptProcessorNode mode
    // const { faustNode, dspMeta: { name } } = await createFaustNode(audioContext, "FAUST_DSP_NAME", FAUST_DSP_VOICES, true);
    const { faustNode, dspMeta: { name } } = await createFaustNode(audioContext, "FAUST_DSP_NAME", FAUST_DSP_VOICES);
    if (!faustNode) throw new Error("Faust DSP not compiled");
    await createFaustUI(faustNode);
    faustNode.connect(audioContext.destination);
    if (faustNode.numberOfInputs) await buildAudioDeviceMenu(faustNode);
    else $spanAudioInput.hidden = true;
    if (navigator.requestMIDIAccess) await buildMidiDeviceMenu(faustNode);
    else $spanMidiInput.hidden = true;
    $buttonDsp.disabled = false;
    document.title = name;
    let motionHandlersBound = false;
    $buttonDsp.onclick = async () => {
        if (!motionHandlersBound) {
            await faustNode.listenSensors();
            motionHandlersBound = true;
        }
        if (audioContext.state === "running") {
            $buttonDsp.textContent = "Suspended";
            audioContext.suspend();
        } else if (audioContext.state === "suspended") {
            $buttonDsp.textContent = "Running";
            audioContext.resume();
        }
    }
})();
