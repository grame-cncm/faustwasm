/**
 * What each `faust2wasm.js` mode is supposed to leave on disk.
 *
 * The four modes differ only by which template assets get copied next to the
 * compiled wasm, and that copying is a chain of `cpSync` calls that nothing
 * verified. Pinning the exact file set here turns "the PWA lost its service
 * worker" into a failing test rather than a bug report from someone whose
 * offline app stopped installing.
 *
 * Sets are sorted and directories carry a trailing `/`, matching `listDir`.
 */

/** Written for every DSP, in every mode. */
const DSP_FILES = ['dsp-meta.json', 'dsp-module.wasm'];

/** Added by `-poly`: the voice mixer, always. */
const POLY_FILES = ['mixer-module.wasm'];

/** Added by `-poly` only when the DSP source defines an `effect`. */
const EFFECT_FILES = ['effect-meta.json', 'effect-module.wasm'];

/** The web assets each mode copies, keyed by the flag that selects it. */
const MODE_ASSETS = {
    // No flag: enough to open index.html against a local server.
    template: ['create-node.js', 'faustwasm/', 'index.html', 'index.js'],
    // `-no-template`: the compiled DSP and nothing else.
    'no-template': [],
    // `-standalone`: adds the UI, the icon, the manifest and the worker.
    standalone: [
        'create-node.js',
        'faust-ui/',
        'faustwasm/',
        'icon.png',
        'index.html',
        'index.js',
        'manifest.json',
        'service-worker.js'
    ],
    // `-pwa`: standalone plus the install/update logic.
    pwa: [
        'create-node.js',
        'faust-pwa.js',
        'faust-ui/',
        'faustwasm/',
        'icon.png',
        'index.html',
        'index.js',
        'manifest.json',
        'service-worker.js'
    ]
};

/** The modes, as the flags that select them (`template` is the no-flag one). */
export const MODES = Object.keys(MODE_ASSETS);

/**
 * The CLI flags that select a mode.
 *
 * @param {string} mode - One of `MODES`.
 * @returns {string[]}
 */
export const modeFlags = (mode) => (mode === 'template' ? [] : [`-${mode}`]);

/**
 * The full sorted file set for one mode.
 *
 * `effect` is only meaningful together with `poly`: a mono build of a DSP that
 * defines an `effect` ignores it, and asserting that is part of the point.
 *
 * @param {string} mode - One of `MODES`.
 * @param {{ poly?: boolean, effect?: boolean }} [options]
 * @returns {string[]}
 */
export const expectedFiles = (mode, options = {}) => {
    const { poly = false, effect = false } = options;
    const files = [...DSP_FILES, ...MODE_ASSETS[mode]];
    if (poly) {
        files.push(...POLY_FILES);
        if (effect) files.push(...EFFECT_FILES);
    }
    return files.sort();
};
