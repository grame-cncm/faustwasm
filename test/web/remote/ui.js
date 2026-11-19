// @ts-check
/**
 * A faust-ui interface on anything with a node's control API: a node on the
 * host page, a `FaustRemoteDsp` on the remote control page. The same function
 * as `createFaustUI` in `assets/standalone/create-node.js`.
 */

/**
 * @param {HTMLElement} parent
 * @param {any} dsp - a Faust node, or a FaustRemoteDsp
 */
export async function createFaustUI(parent, dsp) {
    const { FaustUI } = await import("../../../assets/standalone/faust-ui/index.js");
    const container = document.createElement("div");
    container.style.position = "relative";
    container.style.overflow = "auto";
    container.style.width = "100%";
    container.style.height = "100%";
    parent.appendChild(container);
    const faustUI = new FaustUI({
        ui: dsp.getUI(),
        root: container,
        listenWindowMessage: false,
        listenWindowResize: true
    });
    faustUI.paramChangeByUI = (path, value) => dsp.setParamValue(path, value);
    dsp.setOutputParamHandler((path, value) => faustUI.paramChangeByDSP(path, value));
    dsp.setInputParamHandler((path, value) => faustUI.paramChangeByDSP(path, value));
    container.style.minWidth = `${faustUI.minWidth}px`;
    container.style.minHeight = `${faustUI.minHeight}px`;
    faustUI.resize();
    return faustUI;
}

/** A random identifier, in hex. */
export const randomHex = (bytes = 16) =>
    Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, "0")).join("");
