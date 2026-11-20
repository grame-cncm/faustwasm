/**
 * @file The remote control of a Faust application running on a host.
 *
 * No DSP runs here and no wasm is loaded: the interface is built from the
 * description the host sends, and every control, sensor reading included,
 * goes to the host over WebRTC, or through the server's relay where WebRTC
 * cannot connect.
 *
 * The host's link carries the session in its fragment (`#room=…&token=…`,
 * never sent to a server). It is kept in localStorage, so the app installed
 * from that link, which starts without the fragment, still finds its host.
 *
 * Hidden (screen locked, app in the background), the remote control says
 * goodbye, which releases what it held on the host; shown again, it
 * reconnects.
 *
 * "Play locally" also runs the DSP on this device, with its own sound, kept
 * in step with the host (FaustRemoteDsp + FaustLocalSound): one hears one's
 * own gestures with no network delay. It is the DSP computed here with the
 * host's settings, not the host's sound.
 */

// Set to > 0 if the DSP is polyphonic
const FAUST_DSP_VOICES = 0;
const DSP_NAME = "FAUST_DSP_NAME";
const SESSION_KEY = `faust-remote:${DSP_NAME}`;
const LOCAL_KEY = `faust-remote-local:${DSP_NAME}`;
// The signaling server and relay it was built for, if not the server of this page (-signal)
const FAUST_SIGNAL_URL = "";
// STUN servers, for a host on another network (-stun)
const FAUST_ICE_SERVERS = [];

/** A URL without its trailing slashes, to compare signaling servers. */
const normalize = (url) => {
    try {
        return new URL(url).href.replace(/\/+$/, "");
    } catch {
        return null;
    }
};
/**
 * The signaling servers this remote control accepts from a link: the server
 * of this page, and the one it was built for. Any other, a link could name to
 * see this remote control's messages pass.
 */
const KNOWN_SIGNALS = [location.origin, FAUST_SIGNAL_URL].filter(Boolean).map(normalize);

const $ = (id) => document.getElementById(id);

// Registered at once: this module runs after the window's load event
if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./service-worker.js")
        .catch((error) => console.warn("Service worker registration failed:", error));
}

/**
 * The session from the link, kept for later; or the one kept from before.
 * `signal` is the signaling server: the link's if this remote control knows
 * it, else the one it was built for, else this page's server.
 */
const findSession = () => {
    const params = new URLSearchParams(location.hash.slice(1));
    const room = params.get("room");
    const token = params.get("token");
    const asked = params.get("signal");
    if (asked !== null && !KNOWN_SIGNALS.includes(normalize(asked)))
        return { error: `the link names an unknown signaling server: ${asked}` };
    const signal = asked ?? (FAUST_SIGNAL_URL || location.origin);
    try {
        if (room && token) {
            localStorage.setItem(SESSION_KEY, JSON.stringify({ room, token, signal }));
            // Out of the address bar, where it would be shared with a screenshot
            history.replaceState(null, "", location.pathname);
            return { room, token, signal };
        }
        const stored = JSON.parse(localStorage.getItem(SESSION_KEY) ?? "null");
        if (stored?.room && stored?.token)
            return { ...stored, signal: KNOWN_SIGNALS.includes(normalize(stored.signal)) ? stored.signal : signal };
    } catch { /* storage unavailable */ }
    return room && token ? { room, token, signal } : null;
};

const setStatus = (text) => ($("status").textContent = text);
const showError = (error) => ($("error").textContent = error ? String(error?.message ?? error) : "");

(async () => {
    const { createFaustNode, createFaustUI, requestPermissions } = await import("../create-node.js");
    const { FaustRemoteDsp, FaustLocalSound, createHttpSignaling } = await import("../faustwasm-remote/client.js");

    const session = findSession();
    if (!session || session.error) {
        setStatus(session?.error ?? "no host: open the link the host page shows");
        $("button-connect").disabled = true;
        return;
    }

    /** @type {import("../faustwasm-remote/client.js").FaustRemoteDsp | null} */
    let dsp = null;
    /** Whether the user wants to be connected: then reconnect when shown again. */
    let wanted = false;
    let connecting = false;
    /** @type {number[]} */
    let rtts = [];
    /** "WebRTC" or "relay": how the current connection goes. */
    let transport = "";
    /**
     * The local sound: its context, its node once made, and the host's JSON
     * the node was made for.
     */
    let local = null;
    /** @type {import("../faustwasm-remote/client.js").FaustLocalSound | null} */
    let control = null;

    try {
        $("check-local").checked = localStorage.getItem(LOCAL_KEY) === "1";
    } catch { /* storage unavailable */ }

    const describe = () =>
        `connected (${transport})${dsp?.group ? `, group ${dsp.group}` : ""}${control ? ", playing locally" : ""}`;

    /**
     * The local node, kept across reconnections while the host runs the same
     * DSP, made again from the files the host serves when it runs another
     * (a DSP edited in Max, which the host writes there before saying so).
     */
    const localNode = async (json) => {
        if (local.node && local.json !== json) {
            local.node.disconnect();
            local.node.destroy?.();
            local.node = null;
        }
        if (!local.node) {
            const { faustNode } = await createFaustNode(local.context, DSP_NAME, FAUST_DSP_VOICES);
            if (!faustNode) throw new Error("the DSP could not be created on this device");
            faustNode.connect(local.context.destination);
            local.node = faustNode;
            local.json = json;
        }
        return local.node;
    };

    const connect = async () => {
        if (connecting || dsp?.state === "open") return;
        connecting = true;
        setStatus("connecting");
        showError(null);
        try {
            let via = "WebRTC";
            try {
                dsp = await FaustRemoteDsp.connectRTC(
                    createHttpSignaling(session.signal, session.room, session.token, { role: "remote" }),
                    { token: session.token },
                    { timeout: 8000, rtc: { iceServers: FAUST_ICE_SERVERS } }
                );
            } catch (error) {
                // WebRTC cannot connect on this network: through the server
                console.warn("WebRTC failed, using the relay:", error.message);
                via = "relay";
                dsp = await FaustRemoteDsp.connectRelay(session.signal, session.room, { token: session.token });
            }
            transport = via;
            rtts = [];
            dsp.addEventListener("rtt", (event) => {
                rtts.push(event.detail);
                if (rtts.length > 60) rtts.shift();
            });
            dsp.addEventListener("statechange", () => {
                if (dsp?.state !== "closed") return;
                control?.close();
                control = null;
                setStatus("disconnected");
                // Lost while wanted and visible: try again; at once when the
                // host only changed its DSP, which the new connection brings
                const changed = dsp?.closeReason === "dsp-changed";
                if (changed) setStatus("the DSP changed, reconnecting");
                if (wanted && document.visibilityState === "visible") setTimeout(connect, changed ? 300 : 2000);
            });
            // With local sound, the UI drives the bridge: the local node and
            // the remote control together
            control?.close();
            control = local ? new FaustLocalSound(dsp, await localNode(dsp.getJSON())) : null;
            const target = control ?? dsp;
            $("div-faust-ui").replaceChildren();
            await createFaustUI($("div-faust-ui"), target);
            target.startSensors();
            setStatus(describe());
            $("button-connect").hidden = true;
            $("label-local").hidden = true;
        } catch (error) {
            setStatus("not connected");
            showError(error);
            if (wanted && document.visibilityState === "visible") setTimeout(connect, 3000);
        } finally {
            connecting = false;
        }
    };

    // A tap: iOS grants the motion sensors only from a user gesture
    // Audio too: started by this tap, or iOS keeps it silent
    $("button-connect").onclick = async () => {
        wanted = true;
        const playLocally = $("check-local").checked;
        try {
            localStorage.setItem(LOCAL_KEY, playLocally ? "1" : "0");
        } catch { /* storage unavailable */ }
        if (playLocally && !local) {
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            local = { context: new AudioCtx({ latencyHint: "interactive" }), node: null, json: null };
            local.context.resume();
        }
        await requestPermissions();
        connect();
    };

    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") {
            dsp?.close("hidden");
            local?.context.suspend();
        } else if (wanted) {
            local?.context.resume();
            connect();
        }
    });

    setInterval(() => {
        if (dsp?.state !== "open" || rtts.length === 0) return;
        const sorted = [...rtts].sort((a, b) => a - b);
        setStatus(`${describe()}, round trip ${sorted[Math.floor(sorted.length / 2)].toFixed(1)} ms`);
    }, 1000);
})().catch(showError);
