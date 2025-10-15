/**
 * @module faust-pwa
 * High-level controller around a Faust DSP node for Web Audio apps.
 *
 * ## Public surface
 * - {@link createFaustPWA} – factory function (recommended entry point)
 * - {@link FaustPWA} – class (advanced use). Methods marked @public are supported.
 *
 * ## Private surface
 * Any symbol/method/field marked `@private` or not listed as @public is internal.
 * Names prefixed with `f` (e.g. `fFaustNode`) are implementation details.
 *
 * ## Emitted events
 * Instances emit the following CustomEvent names via {@link FaustPWA#on}:
 * - `created` — when the DSP node and (optional) UI are created.
 * - `started` — when audio/MIDI/sensors are activated.
 * - `stopped` — when audio/MIDI/sensors are deactivated.
 * - `destroy` — after teardown completes.
 * - `error` — when an operational error occurs; payload in `event.detail.error`.
 */

/**
 * @typedef {import("./faustwasm").FaustAudioWorkletNode} FaustAudioWorkletNode
 * @typedef {import("./faustwasm").FaustDspMeta} FaustDspMeta
 * @typedef {import("./faustwasm").FaustUIDescriptor} FaustUIDescriptor
 * @typedef {import("./faustwasm").FaustUIGroup} FaustUIGroup
 * @typedef {import("./faustwasm").FaustUIItem} FaustUIItem
 */

/**
 * @typedef FaustPWAOptions
 * @property {string} dspName - DSP name string for createFaustNode (required).
 * @property {number} [voices=0] - Polyphony: 0 for mono, >0 for poly.
 * @property {boolean} [useScriptProcessor=false] - Fallback to ScriptProcessorNode mode.
 * @property {number} [bufferSize=512] - Buffer size for ScriptProcessorNode mode.
 * @property {HTMLElement | null} uiContainer - Where to render the Faust UI (optional).
 */

/**
 * FaustPWA class to manage Faust DSP with PWA features (service worker, MIDI, sensors, keyboard).
 */
export class FaustPWA {

    /**
    * @param {FaustPWAOptions} options;
    */

    constructor(options) {

        /** @private internal activation flags */
        this.fActive = { midi: false, sensors: false };

        /** @type {FaustPWAOptions} */
        this.fOptions = {
            voices: 0,
            useScriptProcessor: false,
            bufferSize: 512,
            uiContainer: null,
            ...options,
        };

        /** @type {AudioContext} */
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        this.fAudioContext = this.fOptions.audioContext || new AudioCtx({ latencyHint: 0.00001 })
        this.fAudioContext.destination.channelInterpretation = "discrete";
        this.fAudioContext.suspend();

        /** @type {FaustAudioWorkletNode | null} */
        this.fFaustNode = null;

        // Event system
        this.fEvents = new EventTarget();

        // MIDI and Sensor handlers state
        this.fActive.sensors = false;
        this.fActive.midi = false;

        // Keyboard to MIDI handing
        this.fKeyboard2MIDI = null;

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
    }

    // Function to start MIDI
    startMIDI() {
        // Check if the browser supports the Web MIDI API
        if (navigator.requestMIDIAccess) {
            navigator.requestMIDIAccess().then(
                midiAccess => {
                    console.log("MIDI Access obtained.");
                    for (let input of midiAccess.inputs.values()) {
                        input.onmidimessage = (event) => this.fFaustNode.midiMessage(event.data);
                        console.log(`Connected to input: ${input.name}`);
                    }
                },
                () => console.error("Failed to access MIDI devices.")
            );
        } else {
            console.log("Web MIDI API is not supported in this browser.");
        }
    }

    // Function to stop MIDI
    stopMIDI() {
        // Check if the browser supports the Web MIDI API
        if (navigator.requestMIDIAccess) {
            navigator.requestMIDIAccess().then(
                midiAccess => {
                    console.log("MIDI Access obtained.");
                    for (let input of midiAccess.inputs.values()) {
                        input.onmidimessage = null;
                        console.log(`Disconnected from input: ${input.name}`);
                    }
                },
                () => console.error("Failed to access MIDI devices.")
            );
        } else {
            console.log("Web MIDI API is not supported in this browser.");
        }
    }

    // Function to start Keyboard to MIDI
    async startKeyboard2MIDI() {
        // Import the create-node module
        const { createKey2MIDI } = await import("./create-node.js");

        this.fKeyboard2MIDI = createKey2MIDI((event) => this.fFaustNode.midiMessage(event));
        this.fKeyboard2MIDI.start();
    }

    // Function to stop Keyboard to MIDI
    stopKeyboard2MIDI() {
        this.fKeyboard2MIDI.stop();
        this.fKeyboard2MIDI = null;
    }

    /**
     * Dispatch a custom event.
     * @param {string} type
     * @param {any} detail
     * @private
     */
    dispatch(type, detail = undefined) {
        this.fEvents.dispatchEvent(new CustomEvent(type, { detail, bubbles: false, composed: true }));
    }

    // Public API

    // ---------------------- Event API ---------------------------------

    /**
     * Add a listener for a custom event.
     * @param {string} type
     * @param {(e: CustomEvent) => void} handler
     */
    on(type, handler) {
        this.fEvents.addEventListener(type, handler);
    }

    /**
     * Remove a listener for a custom event.
     * @param {string} type
     * @param {(e: CustomEvent) => void} handler
     */
    off(type, handler) {
        this.fEvents.removeEventListener(type, handler);
    }

    // ---------------------- Audio/MIDI/Sensors API ---------------------------------

    // Getters for AudioContext
    get audioContext() {
        return this.fAudioContext;
    }

    // Getter for FaustNode
    get faustNode() {
        return this.fFaustNode;
    }

    // Synchronous function to resume AudioContext, to be called first in the synchronous event listener
    resumeAudioContext() {
        if (this.fAudioContext.state === 'suspended') {
            this.fAudioContext.resume().then(() => {
                console.log('AudioContext resumed successfully');
            }).catch(error => {
                console.error('Error when resuming AudioContext:', error);
            });
        }
    }

    // Asynchronous function to suspend AudioContext
    async suspendAudioContext() {
        // Suspend the AudioContext
        if (this.fAudioContext.state === 'running') {
            await this.fAudioContext.suspend();
        }
    }

    // Function to activate MIDI and Sensors on user interaction
    async activateMIDISensors() {

        // Import the create-node module
        const { connectToAudioInput, requestPermissions } = await import("./create-node.js");

        // Request permission for sensors
        await requestPermissions();

        // Activate sensor listeners
        if (!this.fActive.sensors) {
            await this.fFaustNode.startSensors();
            this.fActive.sensors = true;
        }

        // Initialize the MIDI setup
        if (!this.fActive.midi) {
            this.startMIDI();
            await this.startKeyboard2MIDI();
            this.fActive.midi = true;
        }

        // Connect the Faust node to the audio output@
        this.fFaustNode.connect(this.fAudioContext.destination);

        // Connect the Faust node to the audio input
        if (this.fFaustNode.numberOfInputs > 0) {
            await connectToAudioInput(this.fAudioContext, null, this.fFaustNode, null);
        }
    }

    // Function to deactivate MIDI and Sensors on user interaction
    async deactivateMIDISensors() {

        // Deactivate sensor listeners
        if (this.fActive.sensors) {
            this.fFaustNode.stopSensors();
            this.fActive.sensors = false;
        }

        // Deactivate the MIDI setup
        if (this.fActive.midi && this.fOptions.voices > 0) {
            this.stopMIDI();
            this.stopKeyboard2MIDI();
            this.fActive.midi = false;
        }
    }

    /**
     * Load and initialize the Faust node and (optionally) UI.
     * @returns {Promise<void>}
     */
    async create() {

        try {
            const { createFaustNode, createFaustUI } = await import('./create-node.js');

            // Create the Faust node
            const result = await createFaustNode(
                this.fAudioContext,
                this.fOptions.dspName,
                this.fOptions.voices ?? 0,
                this.fOptions.useScriptProcessor ?? false,
                this.fOptions.bufferSize ?? 512
            );

            this.fFaustNode = result.faustNode;  // Assign to the global variable
            if (!this.fFaustNode) throw new Error("Faust DSP not compiled");

            // Create the Faust UI
            await createFaustUI(this.fOptions.uiContainer, this.fFaustNode);

            this.dispatch('created', {
                workletName: result.workletName,
                sampleRate: result.sampleRate,
                voices: this.fOptions.voices ?? 0,
            });

        } catch (err) {
            this.dispatch('error', { error: err });
            throw err;
        }
    }

    /**
     * Fully disposes audio resources and UI.
     * @returns {Promise<void>}
     */
    async destroy() {
        // Cleanup MIDI and Sensors
        this.stop();
        this.fFaustNode.destroy();
        this.dispatch('destroy', {});
    }

    /**
    * Start audio: resumes AudioContext if needed and connects to destination.
    * @returns {Promise<void>}
    */
    async start() {
        // Resume AudioContext synchronously
        this.resumeAudioContext();

        // Launch the activation of MIDI and Sensors
        this.activateMIDISensors().catch(error => {
            console.error('Error when activating audio, MIDI and sensors:', error);
        });

        // Dispatch the started event
        this.dispatch('started', { when: this.audioContext.currentTime });
    }

    /**
    * Stop audio: disconnects from destination but keeps node allocated.
    */
    stop() {

        // Deactivate MIDI and Sensors
        this.deactivateMIDISensors();
        this.fFaustNode.stop();

        // Dispatch the stopped event
        this.dispatch('stopped', { when: this.audioContext.currentTime });
    }
}

/**
 * Factory to create a {@link FaustPWA} instance.
 * @function
 * @public
 * @param {FaustPWAOptions} options
 * @returns {FaustPWA}
 */
export function createFaustPWA(options) {
    return new FaustPWA(options);
}
