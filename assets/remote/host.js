/**
 * @file The host page of a remote-controlled Faust application.
 *
 * The DSP runs here and its sound comes out of this machine. Remote controls
 * (the PWA in `remote/`) connect to it over WebRTC, after a signaling exchange
 * through the server that serves this page: `faust-remote-server-ts`; or,
 * where WebRTC cannot connect, through that server's relay.
 *
 * The session (room and token) is kept in localStorage, so a remote control
 * installed on a phone finds the same session after this page is reloaded.
 * "New session" makes another one, which turns away the remote controls that
 * only know the old link. Those connected over WebRTC stay connected; those
 * going through the relay are disconnected, since the relay is per session.
 */

// Set to > 0 if the DSP is polyphonic
const FAUST_DSP_VOICES = 0;
const DSP_NAME = "FAUST_DSP_NAME";
const SESSION_KEY = `faust-remote-host:${DSP_NAME}`;

const $ = (id) => document.getElementById(id);

/** A random identifier, in hex. */
const randomHex = (bytes) =>
    Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, "0")).join("");

/** The stored session, or a new one. Storage may be unavailable: then a new one each time. */
const loadSession = (renew = false) => {
    try {
        const stored = JSON.parse(localStorage.getItem(SESSION_KEY) ?? "null");
        if (!renew && stored?.room && stored?.token) return stored;
    } catch { /* a new session below */ }
    const session = { room: randomHex(6), token: randomHex(16) };
    try {
        localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    } catch { /* kept for this page only */ }
    return session;
};

const showError = (error) => ($("error").textContent = String(error?.message ?? error));

(async () => {
    const { createFaustNode, createFaustUI } = await import("./create-node.js");
    const { FaustRemoteHost, createHttpSignaling, qrCodeSvg } = await import("./faustwasm-remote/host.js");

    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    const audioContext = new AudioCtx({ latencyHint: "interactive" });
    audioContext.suspend();

    const { faustNode } = await createFaustNode(audioContext, DSP_NAME, FAUST_DSP_VOICES);
    if (!faustNode) throw new Error("the DSP could not be created");
    faustNode.connect(audioContext.destination);

    // The local UI first: the host chains the handlers it finds on the node
    await createFaustUI($("div-faust-ui"), faustNode);

    // `?delay=40` on this page's URL: values from the remote controls are
    // played 40 ms after they were sent, as regularly as they were sent,
    // instead of when the network delivers them
    const delay = Number(new URLSearchParams(location.search).get("delay"));
    const host = new FaustRemoteHost(faustNode, {
        playoutDelay: delay > 0 ? delay / 1000 : null
    });
    let signaling = null;
    let stopListening = [];

    const showClients = () => {
        const ids = host.clients.map((client) => client.id);
        $("clients").textContent = ids.length ? `${ids.length} remote control(s): ${ids.join(", ")}` : "no remote control";
    };
    host.addEventListener("join", showClients);
    host.addEventListener("leave", showClients);
    host.addEventListener("error", (event) => console.warn("remote host:", event.detail));

    /** Listen for remote controls in a session, and show its link. */
    const open = async (session) => {
        stopListening.forEach((stop) => stop());
        signaling?.close();
        // The token the remote controls must present, in `hello` as to the server
        host.setToken(session.token);
        signaling = createHttpSignaling(location.origin, session.room, session.token, {
            role: "host",
            onerror: (error) => console.warn("signaling:", error.message)
        });
        await signaling.ready;
        // WebRTC, and the server's relay for the networks where it fails
        stopListening = [
            host.listen(signaling),
            host.listenRelay(location.origin, session.room, session.token)
        ];
        const url = new URL("remote/index.html", location.href);
        url.hash = `room=${session.room}&token=${session.token}`;
        const link = document.createElement("a");
        link.href = url.href;
        link.target = "_blank";
        link.textContent = url.href;
        $("pairing").replaceChildren("Remote control: ", link);
        // The same link, for a phone's camera. Generated here from the URL,
        // which the SVG does not contain as text
        $("qrcode").innerHTML = qrCodeSvg(url.href, { border: 2 });
    };

    $("button-audio").onclick = async () => {
        await audioContext.resume();
        $("button-audio").textContent = "Audio active";
        $("button-audio").disabled = true;
    };
    $("button-session").onclick = () => open(loadSession(true)).catch(showError);

    showClients();
    await open(loadSession());
})().catch(showError);
