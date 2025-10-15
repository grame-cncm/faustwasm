
/**
 * @file index-pwa.js
 * Entry point for initializing and managing the Faust PWA instance.
 *
 * ## Overview
 * This script dynamically imports {@link createFaustPWA} from `faust-pwa.js`,
 * creates the Faust PWA controller, and manages user-activation of the
 * Web Audio API (click/touch) as well as visibility-based suspension.
 *
 * ## Responsibilities
 * - Dynamically import `createFaustPWA` (ES module)
 * - Create the PWA instance for the selected DSP
 * - Resume/suspend AudioContext on user interaction or page visibility changes
 * - Activate/deactivate MIDI and sensors
 *
 * ## Emitted Events (from FaustPWA)
 * - `created` — DSP and UI successfully initialized
 * - `started` — Audio, MIDI, and sensors activated
 * - `stopped` — Audio, MIDI, and sensors deactivated
 * - `destroy` — Resources released
 * - `error` — Operational error; see event.detail.error
 *
 * @module index-pwa
 */

// Set to > 0 if the DSP is polyphonic
const FAUST_DSP_VOICES = 0;

(async () => {

    const { FaustPWA } = await import("./faust-pwa.js");

    /** @type {HTMLDivElement} */
    const divFaustUI = document.getElementById("div-faust-ui");

    // Declare faustNode as a global variable
    const pwa = new FaustPWA({ dspName: "FAUST_DSP_NAME", voices: FAUST_DSP_VOICES, uiContainer: divFaustUI });

    // Create PWA and UI
    await pwa.create();

    // Event listener to handle user interaction
    function handleUserInteraction() {

        // Resume AudioContext synchronously
        pwa.resumeAudioContext();

        // Activate MIDI and Sensors
        pwa.activateMIDISensors()
    }

    // Activate AudioContext, MIDI and Sensors on user interaction
    window.addEventListener('click', handleUserInteraction);
    window.addEventListener('touchstart', handleUserInteraction);

    // Deactivate AudioContext, MIDI and Sensors on user interaction
    window.addEventListener('visibilitychange', function () {
        if (window.visibilityState === 'hidden') {

            // Suspend AudioContext
            pwa.suspendAudioContext();

            // Deactivate MIDI and Sensors
            pwa.deactivateMIDISensors();
        }
    });

})();
