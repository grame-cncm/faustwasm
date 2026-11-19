// @ts-check
import { createFaustUI } from "./ui.js";

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));

/** iOS asks for the motion sensors from a user gesture, before they are read. */
const requestPermissions = async () => {
    for (const Event of [window.DeviceMotionEvent, window.DeviceOrientationEvent]) {
        const request = /** @type {any} */ (Event)?.requestPermission;
        if (typeof request !== "function") continue;
        try {
            const state = await request.call(Event);
            if (state !== "granted") console.warn("sensor permission:", state);
        } catch (error) {
            console.warn("sensor permission:", error);
        }
    }
};

/** @param {number[]} values @param {number} q */
const quantile = (values, q) => {
    if (values.length === 0) return NaN;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
};

const connect = async () => {
    $("connect").setAttribute("disabled", "");
    const params = new URLSearchParams(location.hash.slice(1));
    const room = params.get("room");
    const token = params.get("token");
    if (!room || !token) throw new Error("open this page from the link the host shows");

    await requestPermissions();
    const { FaustRemoteDsp, createHttpSignaling } = await import("../../../dist/remote/client.js");
    $("state").textContent = "connecting";
    const dsp = await FaustRemoteDsp.connectRTC(
        createHttpSignaling(location.origin, room, token, { role: "remote" }),
        { token }
    );
    $("state").textContent = `${dsp.state} (${dsp.mode})`;
    dsp.addEventListener("statechange", () => ($("state").textContent = dsp.state));
    await createFaustUI($("ui"), dsp);
    dsp.startSensors();

    // Every round trip of the session, for the latency figures
    /** @type {number[]} */
    const rtts = [];
    dsp.addEventListener("rtt", (event) => rtts.push(/** @type {CustomEvent} */ (event).detail));
    setInterval(() => {
        $("stats").textContent =
            `round trip (ms): min ${quantile(rtts, 0).toFixed(1)}, median ${quantile(rtts, 0.5).toFixed(1)}, ` +
            `p95 ${quantile(rtts, 0.95).toFixed(1)}, max ${quantile(rtts, 1).toFixed(1)} over ${rtts.length}` +
            `  sensors: ${dsp.hasAccInput ? "acc " : ""}${dsp.hasGyrInput ? "gyr" : ""}`;
    }, 1000);

    Object.assign(window, { faustRemote: { dsp, rtts } });
};

$("connect").addEventListener("click", () =>
    connect().catch((error) => {
        $("error").textContent = String(error?.message ?? error);
        $("state").textContent = "not connected";
        $("connect").removeAttribute("disabled");
    })
);
