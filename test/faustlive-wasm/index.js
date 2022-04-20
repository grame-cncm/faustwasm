//@ts-check
/** @type {typeof AudioContext} */
const AudioContextConstructor = globalThis.AudioContext || globalThis.webkitAudioContext;
const audio_context = new AudioContextConstructor({ latencyHint: 0.00001 });
audio_context.destination.channelInterpretation = "discrete";

const isWasm = typeof WebAssembly !== "undefined";
const workletAvailable = typeof AudioWorklet !== "undefined";

/** @type {HTMLDivElement} */
const faustUIRoot = document.getElementById("faust-ui");

/** @type {import("./faustwasm").FaustCompiler} */
let faust_compiler = null;
/** @type {import("./faustwasm").FaustMonoDspGenerator} */
let faust_mono_factory = null;
/** @type {import("./faustwasm").FaustPolyDspGenerator} */
let faust_poly_factory = null;
let isPoly = false;
let buffer_size = 1024;
let audio_input = null;
let factory = null;
/** @type {import("./faustwasm").FaustAudioWorkletNode<any> | import("./faustwasm").FaustScriptProcessorNode<any>} */
let DSP = null;
/** @type {string} */
let dsp_code = null;
/** @type {typeof import("./faust-ui/index").FaustUI} */
let FaustUI;
/** @type {import("./faust-ui/index").FaustUI} */
let faustUI;
let poly_flag = "OFF";
let ftz_flag = "2";
let sample_format = "float";
let poly_nvoices = 16;
let rendering_mode = "ScriptProcessor";
/**
 * @param {string} path
 * @param {number} value
 */
let output_handler = (path, value) => faustUI.paramChangeByDSP(path, value);

/**
 * @param {HTMLSelectElement} bs_item 
 */
const setBufferSize = (bs_item) => {
    buffer_size = parseInt(bs_item.options[bs_item.selectedIndex].value);
    if (buffer_size === 128 && rendering_mode === "ScriptProcessor") {
        console.log("buffer_size cannot be set to 128 in ScriptProcessor mode !");
        buffer_size = 256;
        restoreMenu("selectedBuffer", buffer_size.toString());
    }
    compileDSP();
}

/**
 * @param {HTMLSelectElement} poly_item 
 */
const setPoly = (poly_item) => {
    poly_flag = poly_item.options[poly_item.selectedIndex].value;
    compileDSP();
}

/**
 * @param {HTMLSelectElement} voices_item 
 */
const setPolyVoices = (voices_item) => {
    poly_nvoices = parseInt(voices_item.options[voices_item.selectedIndex].value);
    compileDSP();
}

/**
 * @param {HTMLSelectElement} rendering_item 
 */
const setRenderingMode = (rendering_item) => {
    rendering_mode = rendering_item.options[rendering_item.selectedIndex].value;
    /** @type {HTMLSelectElement} */
    const selectedBuffer = document.getElementById("selectedBuffer");
    if (rendering_mode === "AudioWorklet") {
        buffer_size = 128;
        restoreMenu("selectedBuffer", buffer_size.toString());
        selectedBuffer.disabled = true;
    } else {
        buffer_size = 1024;
        restoreMenu("selectedBuffer", buffer_size.toString());
        selectedBuffer.disabled = false;
    }
    compileDSP();
}

/**
 * @param {HTMLSelectElement} ftz_item 
 */
const setFTZ = (ftz_item) => {
    ftz_flag = ftz_item.options[ftz_item.selectedIndex].value;
    compileDSP();
}

/**
 * @param {HTMLSelectElement} sample_item 
 */
const setSampleFormat = (sample_item) => {
    sample_format = sample_item.options[sample_item.selectedIndex].value;
    compileDSP();
}

// MIDI input handling

/**
 * @param {number} channel
 * @param {number} pitch
 * @param {number} velocity
 */
const keyOn = (channel, pitch, velocity) => {
    if (DSP && isPoly) {
        DSP.keyOn(channel, pitch, velocity);
    }
}

/**
 * @param {number} channel
 * @param {number} pitch
 * @param {number} velocity
 */
const keyOff = (channel, pitch, velocity) => {
    if (DSP && isPoly) {
        DSP.keyOff(channel, pitch, velocity);
    }
}

/**
 * @param {number} channel
 * @param {number} bend
 */
const pitchWheel = (channel, bend) => {
    if (DSP) {
        DSP.pitchWheel(channel, bend);
    }
}

/**
 * @param {number} channel
 * @param {number} ctrl
 * @param {number} value
 */
const ctrlChange = (channel, ctrl, value) => {
    if (DSP) {
        DSP.ctrlChange(channel, ctrl, value);
    }
}

/**
 * @param {MessageEvent} ev
 */
const midiMessageReceived = (ev) => {
    var cmd = ev.data[0] >> 4;
    var channel = ev.data[0] & 0xf;
    var data1 = ev.data[1];
    var data2 = ev.data[2];

    if (channel === 9) {
        return;
    } else if (cmd === 8 || ((cmd === 9) && (data2 === 0))) {
        keyOff(channel, data1, data2);
    } else if (cmd === 9) {
        keyOn(channel, data1, data2);
    } else if (cmd === 11) {
        ctrlChange(channel, data1, data2);
    } else if (cmd === 14) {
        pitchWheel(channel, (data2 * 128.0 + data1));
    }

    /*
    // Direct message
    if (DSP && isPoly) {
        DSP.midiMessage(ev.data);
    }
    */
}
/**
 * @param {Error} error 
 */
const onerrorcallback = (error) => {
    console.log(error);
}

const onsuccesscallbackStandard = (access) => {
    access.onstatechange = function (e) {
        if (e.port.type === "input") {
            if (e.port.state === "connected") {
                console.log(e.port.name + " is connected");
                e.port.onmidimessage = midiMessageReceived;
            } else if (e.port.state === "disconnected") {
                console.log(e.port.name + " is disconnected");
                e.port.onmidimessage = null;
            }
        }
    }

    for (const input of access.inputs.values()) {
        input.onmidimessage = midiMessageReceived;
        console.log(input.name + " is connected");
    }
}

const activateMIDIInput = () => {
    console.log("activateMIDIInput");
    if (typeof (navigator.requestMIDIAccess) !== "undefined") {
        navigator.requestMIDIAccess().then(onsuccesscallbackStandard, onerrorcallback);
    } else {
        alert("MIDI input cannot be activated, either your browser still does't have it, or you need to explicitly activate it.");
    }
}

/** Audio input handling */
const activateAudioInput = () => {
    console.log("activateAudioInput");
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false } })
            .then(getDevice)
            .catch((e) => {
                alert('Error getting audio input');
                console.log(e);
                audio_input = null;
            });
    } else {
        alert('Audio input API not available');
    }
}

/**
 * @param {MediaStream} device 
 */
const getDevice = (device) => {
    // Create an AudioNode from the stream.
    audio_input = audio_context.createMediaStreamSource(device);

    // Connect it to the destination.
    audio_input.connect(DSP);
}

const setLocalStorage = (state) => {
    console.log(state);
    setStorageItemValue('FaustLibTester', 'FaustLocalStorage', ((state) ? "on" : "off"));
}

/**
 * Save/Load functions using local storage
 * 
 * @param {string} id 
 * @param {string} value 
 */
const restoreMenu = (id, value) => {
    /** @type {HTMLSelectElement} */
    const menu = document.getElementById(id);
    for (let i = 0; i < menu.length; i++) {
        // Weak comparison here
        if (menu.options[i].value == value) {
            menu.selectedIndex = i;
            break;
        }
    }
}

/**
 * set item from local storage 'item_key' key
 * 
 * @param {string} item_key 
 * @param {string} key 
 * @returns 
 */
const getStorageItemValue = (item_key, key) => {
    if (localStorage.getItem(item_key)) {
        var item_value = JSON.parse(localStorage.getItem(item_key));
        var item_index = item_value.findIndex((obj => obj[0] === key));
        return (item_index >= 0) ? item_value[item_index][1] : null;
    } else {
        return null;
    }
}

/**
 * get [key, value] in local storage item_key key
 * @param {string} item_key 
 * @param {string} key 
 * @param {string} value 
 */
const setStorageItemValue = (item_key, key, value) => {
    var item_value;
    if (localStorage.getItem(item_key)) {
        item_value = JSON.parse(localStorage.getItem(item_key));
    } else {
        item_value = [];
    }

    // Possibly update an existing 'key'
    var item_index = item_value.findIndex((obj => obj[0] === key));
    if (item_index >= 0) {
        item_value[item_index][1] = value;
        // Otherwise push a new [key, value]
    } else {
        item_value.push([key, value]);
    }

    localStorage.setItem(item_key, JSON.stringify(item_value));
}

const saveDSPState = () => {
    var params = DSP.getParams();
    for (var i = 0; i < params.length; i++) {
        setStorageItemValue('DSP', params[i], DSP.getParamValue(params[i]).toString());
    }
}

const loadDSPState = () => {
    var params = DSP.getParams();
    for (var i = 0; i < params.length; i++) {
        var value = getStorageItemValue('DSP', params[i]);
        if (value) {
            // Restore DSP state
            DSP.setParamValue(params[i], Number(value));
            // Restore GUI state
            output_handler(params[i], Number(value));
        }
    }
}

const savePageState = () => {
    if (getStorageItemValue('FaustLibTester', 'FaustLocalStorage') === "on") {
        setStorageItemValue('FaustLibTester', 'buffer_size', buffer_size.toString());
        setStorageItemValue('FaustLibTester', 'poly_flag', poly_flag);
        setStorageItemValue('FaustLibTester', 'ftz_flag', ftz_flag);
        setStorageItemValue('FaustLibTester', 'sample_format', sample_format);
        setStorageItemValue('FaustLibTester', 'poly_nvoices', poly_nvoices.toString());
        setStorageItemValue('FaustLibTester', 'rendering_mode', rendering_mode);
    }
}

const loadPageState = () => {
    if (getStorageItemValue('FaustLibTester', 'FaustLocalStorage') === "on") {
        buffer_size = (getStorageItemValue('FaustLibTester', 'buffer_size') ? getStorageItemValue('FaustLibTester', 'buffer_size') : 256);
        poly_flag = (getStorageItemValue('FaustLibTester', 'poly_flag') ? getStorageItemValue('FaustLibTester', 'poly_flag') : "OFF");
        poly_nvoices = (getStorageItemValue('FaustLibTester', 'poly_nvoices') ? getStorageItemValue('FaustLibTester', 'poly_nvoices') : 16);
        ftz_flag = (getStorageItemValue('FaustLibTester', 'ftz_flag') ? getStorageItemValue('FaustLibTester', 'ftz_flag') : 2);
        sample_format = (getStorageItemValue('FaustLibTester', 'sample_format') ? getStorageItemValue('FaustLibTester', 'sample_format') : "float");
        rendering_mode = (getStorageItemValue('FaustLibTester', 'rendering_mode') ? getStorageItemValue('FaustLibTester', 'rendering_mode') : "ScriptProcessor");

        // Restore menus
        restoreMenu("selectedBuffer", buffer_size.toString());
        restoreMenu("selectedPoly", poly_flag);
        restoreMenu("polyVoices", poly_nvoices.toString());
        restoreMenu("selectedFTZ", ftz_flag);
        restoreMenu("selectedSampleFormat", sample_format);
        restoreMenu("selectedRenderingMode", rendering_mode);

        if (rendering_mode === "AudioWorklet") {
            document.getElementById("selectedBuffer").disabled = true;
        }
    }
}

/**
 * @param {DragEvent | InputEvent} e 
 */
const fileDragHover = (e) => {
    e.stopPropagation();
    e.preventDefault();
    e.target.className = (e.type === "dragover" ? "hover" : "");
}

/**
 * @param {InputEvent} e 
 */
const fileSelectHandler = (e) => {
    fileDragHover(e);
    /** @type {FileList} */
    const files = e.target.files || e.dataTransfer.files;
    uploadFile(files[0]);
}

/**
 * @param {DragEvent} e
 */
const uploadOn = (e) => {
    return new Promise((callback, reject) => {
        if (!isWasm) {
            alert("WebAssembly is not supported in this browser !");
            reject("WebAssembly is not supported in this browser !");
        }
    
        // CASE 1 : THE DROPPED OBJECT IS A URL TO SOME FAUST CODE
        if (e.dataTransfer.getData('URL') && e.dataTransfer.getData('URL').split(':').shift() != "file") {
            const url = e.dataTransfer.getData('URL');
            let filename = url.toString().split('/').pop();
            filename = filename.toString().split('.').shift();
            const xmlhttp = new XMLHttpRequest();
    
            xmlhttp.onreadystatechange = () => {
                if (xmlhttp.readyState === 4 && xmlhttp.status === 200) {
                    dsp_code = xmlhttp.responseText;
                    callback(dsp_code);
                }
            }
    
            try {
                xmlhttp.open("GET", url, false);
                // Avoid error "mal formé" on firefox
                xmlhttp.overrideMimeType('text/html');
                xmlhttp.send();
            } catch (err) {
                alert(err);
                reject(err);
            }
    
        } else if (e.dataTransfer.getData('URL').split(':').shift() != "file") {
            dsp_code = e.dataTransfer.getData('text');
    
            // CASE 2 : THE DROPPED OBJECT IS SOME FAUST CODE
            if (dsp_code) {
                callback(dsp_code);
            }
            // CASE 3 : THE DROPPED OBJECT IS A FILE CONTAINING SOME FAUST CODE
            else {
                /** @type {FileList} */
                const files = e.target.files || e.dataTransfer.files;
                const file = files[0];
    
                if (location.host.indexOf("sitepointstatic") >= 0) return;
    
                const request = new XMLHttpRequest();
                if (request.upload) {
    
                    const reader = new FileReader();
                    const ext = file.name.toString().split('.').pop();
                    const filename = file.name.toString().split('.').shift();
                    let type;
    
                    if (ext === "dsp") {
                        type = "dsp";
                        reader.readAsText(file);
                    } else if (ext === "json") {
                        type = "json";
                        reader.readAsText(file);
                    }
    
                    reader.onloadend = (e) => {
                        dsp_code = reader.result;
                        callback(dsp_code);
                    };
                }
            }
        }
        // CASE 4 : ANY OTHER STRANGE THING
        else {
            window.alert("This object is not Faust code...");
            reject(new Error("This object is not Faust code..."));
        }
    });
}

const checkPolyphonicDSP = (json) => {
    if (!(((json.indexOf("/freq") !== -1) || (json.indexOf("/key") !== -1))
        && (json.indexOf("/gate") !== -1)
        && ((json.indexOf("/gain") !== -1) || (json.indexOf("/vel") !== -1) || (json.indexOf("/velocity") !== -1)))) {
        alert("Faust DSP code is not Polyphonic, it will probably not work correctly in this mode...")
    }
}

const deleteDSP = () => {
    if (DSP) {
        if (audio_input) {
            audio_input.disconnect(DSP);
        }
        DSP.disconnect(audio_context.destination);
        DSP.destroy();
        faustUIRoot.innerHTML = "";
        DSP = null;
        faustUI = null;
    }
}

const activateMonoDSP = (dsp) => {
    if (!dsp) {
        alert(faust_compiler.getErrorMessage());
        return;
    }

    DSP = dsp;
    if (DSP.getNumInputs() > 0) {
        activateAudioInput();
    } else {
        audio_input = null;
    }

    // Setup UI
    faustUI = new FaustUI({ ui: DSP.getUI(), root: faustUIRoot });
    faustUI.paramChangeByUI = (path, value) => DSP.setParamValue(path, value);
    DSP.setOutputParamHandler(output_handler);
    console.log(DSP.getNumInputs());
    console.log(DSP.getNumOutputs());
    //DSP.metadata({ declare: function(key, value) { console.log("key = " + key + " value = " + value); }});
    DSP.connect(audio_context.destination);
    // DSP has to be explicitly started
    DSP.start();
    loadDSPState();
}

const activatePolyDSP = (dsp) => {
    if (!dsp) {
        alert(faust_compiler.getErrorMessage());
        return;
    }
    checkPolyphonicDSP(dsp.getJSON());
    DSP = dsp;

    if (DSP.getNumInputs() > 0) {
        activateAudioInput();
    } else {
        audio_input = null;
    }

    // Setup UI
    faustUI = new FaustUI({ ui: DSP.getUI(), root: faustUIRoot });
    faustUI.paramChangeByUI = (path, value) => DSP.setParamValue(path, value);
    DSP.setOutputParamHandler(output_handler);
    console.log(DSP.getNumInputs());
    console.log(DSP.getNumOutputs());
    //DSP.metadata({ declare: function(key, value) { console.log("key = " + key + " value = " + value); }});
    DSP.connect(audio_context.destination);
    // DSP has to be explicitly started
    DSP.start();
    loadDSPState();
}

const compileDSP = async () => {
    if (!dsp_code) {
        return;
    }

    deleteDSP();

    // Prepare argv list
    var argv = "-ftz " + ftz_flag.toString() + " -" + sample_format;
    console.log(argv);

    if (poly_flag === "ON") {
        isPoly = true;
        console.log("Poly DSP");
        await faust_poly_factory.compile(faust_compiler, "FaustDSP", dsp_code, argv);
        DSP = await faust_poly_factory.createNode(audio_context, poly_nvoices, undefined, undefined, undefined, undefined, (rendering_mode === "ScriptProcessor"), buffer_size);
        activatePolyDSP(DSP);
    } else {
        isPoly = false;
        console.log("Mono DSP");
        await faust_mono_factory.compile(faust_compiler, "FaustDSP", dsp_code, argv);
        DSP = await faust_mono_factory.createNode(audio_context, undefined, undefined, (rendering_mode === "ScriptProcessor"), buffer_size);
        activateMonoDSP(DSP);
    }
}

/**
 * @param {DragEvent} e 
 */
const uploadFile = async (e) => {
    fileDragHover(e);
    await uploadOn(e);
    compileDSP()
}

const initPage = () => {
    // Restore 'save' checkbox state
    document.getElementById("localstorage").checked = (getStorageItemValue('FaustLibTester', 'FaustLocalStorage') === "on");

    // Load page state
    loadPageState();
}

const init = async () => {
    const {
        instantiateFaustModuleFromFile,
        FaustCompiler,
        FaustMonoDspGenerator,
        FaustPolyDspGenerator,
        LibFaust
    } = await import("./faustwasm/index.js");
    FaustUI = (await import("./faust-ui/index.js")).FaustUI;
    // Init Faust compiler and node factory 
    const module = await instantiateFaustModuleFromFile(new URL("../../libfaust-wasm/libfaust-wasm.js", location.href).href);
    // const module = await instantiateFaustModule();
    const libFaust = new LibFaust(module);
    faust_compiler = new FaustCompiler(libFaust);
    faust_mono_factory = new FaustMonoDspGenerator();
    faust_poly_factory = new FaustPolyDspGenerator();

    // Check AudioWorklet support
    if (!workletAvailable) {
        document.getElementById("selectedRenderingMode").disabled = true;
        alert("AudioWorklet is not supported, ScriptProcessor model only will be available");
    }

    activateMIDIInput();

    const filedrag1 = document.getElementById("filedrag");
    filedrag1.addEventListener("dragover", fileDragHover, false);
    filedrag1.addEventListener("dragleave", fileDragHover, false);
    filedrag1.addEventListener("drop", uploadFile, false);
    filedrag1.textContent = "Drop a Faust .dsp file or URL here (compiled using libfaust version " + faust_compiler.version() + ")";
}

// Init page
initPage();

// Timer to save page and DSP state to local storage
setInterval(() => { savePageState(); if (DSP) { saveDSPState(); } }, 1000);

// Init Faust part
init();

// To activate audio on iOS
window.addEventListener('touchstart', function () {

    // create empty buffer
    var buffer = audio_context.createBuffer(1, 1, 22050);
    var source = audio_context.createBufferSource();
    source.buffer = buffer;

    // connect to output (your speakers)
    source.connect(audio_context.destination);

    // play the file
    source.start();

}, false);

// On desktop
window.addEventListener("mousedown", () => {
    if (audio_context.state !== "suspended") return;
    audio_context.resume().then(() => console.log("Audio resumed"))
});
