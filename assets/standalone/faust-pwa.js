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
            useScriptProcessor: undefined,
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
        this.fActive.audioConnected = false;

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

    /**
     * Choose the default audio backend for the current runtime.
     *
     * AudioWorklet is always preferred. ScriptProcessor is only requested up
     * front when the runtime has no AudioWorklet support at all. iOS/WebKit
     * cases where an AudioWorklet graph is created but stays silent are handled
     * at node-creation time by the AudioWorklet→ScriptProcessor retry in
     * `createFaustNode`, so no preemptive iOS heuristic is needed here. The
     * explicit `useScriptProcessor` option still overrides this default.
     *
     * @returns {boolean} True only when AudioWorklet is unavailable.
     */
    shouldUseScriptProcessor() {
        return !this.fAudioContext.audioWorklet;
    }

    /**
     * Prime iOS audio output inside the same user gesture used to resume audio.
     *
     * Some iOS versions report a resumed AudioContext while the hardware output
     * path remains locked until a source node is started from the activation
     * gesture. A one-sample silent buffer is enough to unlock that path without
     * producing audible sound. Failure is non-fatal because this is only a
     * compatibility assist.
     */
    unlockAudioOutput() {
        try {
            const buffer = this.fAudioContext.createBuffer(1, 1, this.fAudioContext.sampleRate);
            const source = this.fAudioContext.createBufferSource();
            const gain = this.fAudioContext.createGain();
            gain.gain.value = 0;
            source.buffer = buffer;
            source.connect(gain).connect(this.fAudioContext.destination);
            source.start(0);
            source.stop(this.fAudioContext.currentTime + 0.01);
        } catch (error) {
            console.warn("Silent audio unlock failed.", error);
        }
    }

    // Synchronous function to resume AudioContext, to be called first in the synchronous event listener
    resumeAudioContext() {
        this.unlockAudioOutput();
        if (this.fAudioContext.state === 'suspended') {
            return this.fAudioContext.resume().then(() => {
                console.log('AudioContext resumed successfully');
                return this.fAudioContext.state;
            }).catch(error => {
                console.error('Error when resuming AudioContext:', error);
                throw error;
            });
        }
        return Promise.resolve(this.fAudioContext.state);
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

        // Connect the Faust node to the audio output before optional permissions
        // so a denied MIDI/sensor/input permission cannot leave a synth silent.
        if (!this.fActive.audioConnected) {
            this.fFaustNode.connect(this.fAudioContext.destination);
            this.fActive.audioConnected = true;
        }

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

        // Connect the Faust node to the audio input
        if (this.fFaustNode.numberOfInputs > 0) {
            try {
                await connectToAudioInput(this.fAudioContext, null, this.fFaustNode, null);
            } catch (error) {
                console.error("Error when connecting audio input:", error);
            }
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
                this.fOptions.useScriptProcessor ?? this.shouldUseScriptProcessor(),
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
        await this.resumeAudioContext();
        
        // Launch the activation of MIDI and Sensors
        await this.activateMIDISensors();

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
