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
 */

const DSP_NAME = "FAUST_DSP_NAME";
const SESSION_KEY = `faust-remote:${DSP_NAME}`;

const $ = (id) => document.getElementById(id);

// Registered at once: this module runs after the window's load event
if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./service-worker.js")
        .catch((error) => console.warn("Service worker registration failed:", error));
}

/** The session from the link, kept for later; or the one kept from before. */
const findSession = () => {
    const params = new URLSearchParams(location.hash.slice(1));
    const room = params.get("room");
    const token = params.get("token");
    try {
        if (room && token) {
            localStorage.setItem(SESSION_KEY, JSON.stringify({ room, token }));
            // Out of the address bar, where it would be shared with a screenshot
            history.replaceState(null, "", location.pathname);
            return { room, token };
        }
        const stored = JSON.parse(localStorage.getItem(SESSION_KEY) ?? "null");
        if (stored?.room && stored?.token) return stored;
    } catch { /* storage unavailable */ }
    return room && token ? { room, token } : null;
};

const setStatus = (text) => ($("status").textContent = text);
const showError = (error) => ($("error").textContent = error ? String(error?.message ?? error) : "");

(async () => {
    const { createFaustUI, requestPermissions } = await import("../create-node.js");
    const { FaustRemoteDsp, createHttpSignaling } = await import("../faustwasm-remote/client.js");

    const session = findSession();
    if (!session) {
        setStatus("no host: open the link the host page shows");
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

    const connect = async () => {
        if (connecting || dsp?.state === "open") return;
        connecting = true;
        setStatus("connecting");
        showError(null);
        try {
            let via = "WebRTC";
            try {
                dsp = await FaustRemoteDsp.connectRTC(
                    createHttpSignaling(location.origin, session.room, session.token, { role: "remote" }),
                    { token: session.token },
                    { timeout: 8000 }
                );
            } catch (error) {
                // WebRTC cannot connect on this network: through the server
                console.warn("WebRTC failed, using the relay:", error.message);
                via = "relay";
                dsp = await FaustRemoteDsp.connectRelay(location.origin, session.room, { token: session.token });
            }
            transport = via;
            rtts = [];
            dsp.addEventListener("rtt", (event) => {
                rtts.push(event.detail);
                if (rtts.length > 60) rtts.shift();
            });
            dsp.addEventListener("statechange", () => {
                if (dsp?.state !== "closed") return;
                setStatus("disconnected");
                // Lost while wanted and visible: try again
                if (wanted && document.visibilityState === "visible") setTimeout(connect, 2000);
            });
            $("div-faust-ui").replaceChildren();
            await createFaustUI($("div-faust-ui"), dsp);
            dsp.startSensors();
            setStatus(`connected (${transport})`);
            $("button-connect").hidden = true;
        } catch (error) {
            setStatus("not connected");
            showError(error);
            if (wanted && document.visibilityState === "visible") setTimeout(connect, 3000);
        } finally {
            connecting = false;
        }
    };

    // A tap: iOS grants the motion sensors only from a user gesture
    $("button-connect").onclick = async () => {
        wanted = true;
        await requestPermissions();
        connect();
    };

    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") {
            dsp?.close("hidden");
        } else if (wanted) {
            connect();
        }
    });

    setInterval(() => {
        if (dsp?.state !== "open" || rtts.length === 0) return;
        const sorted = [...rtts].sort((a, b) => a - b);
        setStatus(`connected (${transport}), round trip ${sorted[Math.floor(sorted.length / 2)].toFixed(1)} ms`);
    }, 1000);
})().catch(showError);
