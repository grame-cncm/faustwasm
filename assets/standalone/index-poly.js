/**
 * @typedef {import("./types").FaustDspDistribution} FaustDspDistribution
 * @typedef {import("./faustwasm").FaustAudioWorkletNode} FaustAudioWorkletNode
 * @typedef {import("./faustwasm").FaustDspMeta} FaustDspMeta
 * @typedef {import("./faustwasm").FaustUIDescriptor} FaustUIDescriptor
 * @typedef {import("./faustwasm").FaustUIGroup} FaustUIGroup
 * @typedef {import("./faustwasm").FaustUIItem} FaustUIItem
 */

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
const audioContext = new AudioCtx({ latencyHint: 0.00001, echoCancellation: false, autoGainControl: false, noiseSuppression: false });
audioContext.destination.channelInterpretation = "discrete";
audioContext.suspend();

/**
 * @param {FaustAudioWorkletNode} faustNode 
 */
const buildAudioDeviceMenu = async (faustNode) => {
    /** @type {MediaStreamAudioSourceNode} */
    let inputStreamNode;
    const handleDeviceChange = async () => {
        const devicesInfo = await navigator.mediaDevices.enumerateDevices();
        $selectAudioInput.innerHTML = '';
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

$buttonDsp.disabled = true;
$buttonDsp.onclick = () => {
    if (audioContext.state === "running") {
        $buttonDsp.textContent = "Suspended";
        audioContext.suspend();
    } else if (audioContext.state === "suspended") {
        $buttonDsp.textContent = "Running";
        audioContext.resume();
    }
}

/**
 * Creates a Faust audio node for use in the Web Audio API.
 *
 * @param {AudioContext} audioContext - The Web Audio API AudioContext to which the Faust audio node will be connected.
 * @param {string} dspName - The name of the DSP to be loaded.
 * @param {number} voices - The number of voices to be used for polyphonic DSPs.
 * @param {boolean} sp - Whether to create a ScriptProcessorNode instead of an AudioWorkletNode.
 * @returns {Object} - An object containing the Faust audio node and the DSP metadata.
 */
const createFaustNode = async (audioContext, dspName = "template", voices = 0, sp = false) => {
    // Import necessary Faust modules and data
    const { FaustMonoDspGenerator, FaustPolyDspGenerator } = await import("./faustwasm/index.js");

    // Load DSP metadata from JSON
    /** @type {FaustDspMeta} */
    const dspMeta = await (await fetch(`./${dspName}.json`)).json();

    // Compile the DSP module from WebAssembly binary data
    const dspModule = await WebAssembly.compileStreaming(await fetch(`./${dspName}.wasm`));

    // Create an object representing Faust DSP with metadata and module
    /** @type {FaustDspDistribution} */
    const faustDsp = { dspMeta, dspModule };

    /** @type {FaustAudioWorkletNode} */
    let faustNode;

    // Create either a polyphonic or monophonic Faust audio node based on the number of voices
    if (voices > 0) {

        // Try to load optional mixer and effect modules
        try {
            faustDsp.mixerModule = await WebAssembly.compileStreaming(await fetch("./mixerModule.wasm"));
            faustDsp.effectMeta = await (await fetch(`./${dspName}_effect.json`)).json();
            faustDsp.effectModule = await WebAssembly.compileStreaming(await fetch(`./${dspName}_effect.wasm`));
        } catch (e) { }

        const generator = new FaustPolyDspGenerator();
        faustNode = await generator.createNode(
            audioContext,
            voices,
            "FaustPolyDSP",
            { module: faustDsp.dspModule, json: JSON.stringify(faustDsp.dspMeta) },
            faustDsp.mixerModule,
            faustDsp.effectModule ? { module: faustDsp.effectModule, json: JSON.stringify(faustDsp.effectMeta) } : undefined,
            sp
        );
    } else {
        const generator = new FaustMonoDspGenerator();
        faustNode = await generator.createNode(
            audioContext,
            "FaustMonoDSP",
            { module: faustDsp.dspModule, json: JSON.stringify(faustDsp.dspMeta) },
            sp
        );
    }

    // Return an object with the Faust audio node and the DSP metadata
    return { faustNode, dspMeta };
}

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
    const { faustNode, dspMeta: { name } } = await createFaustNode(audioContext, "FAUST_DSP", 16);
    await createFaustUI(faustNode);
    faustNode.connect(audioContext.destination);
    if (faustNode.numberOfInputs) await buildAudioDeviceMenu(faustNode);
    else $spanAudioInput.hidden = true;
    if (navigator.requestMIDIAccess) await buildMidiDeviceMenu(faustNode);
    else $spanMidiInput.hidden = true;
    $buttonDsp.disabled = false;
    document.title = name;
})();
