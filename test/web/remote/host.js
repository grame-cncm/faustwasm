// @ts-check
import { createFaustUI, randomHex } from "./ui.js";

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));

const start = async () => {
    $("start").setAttribute("disabled", "");
    const { instantiateFaustModule, LibFaust, FaustCompiler, FaustMonoDspGenerator } =
        await import("../../../dist/esm-bundle/index.js");
    const { FaustRemoteHost, createHttpSignaling, qrCodeSvg } = await import("../../../dist/remote/host.js");

    const context = new AudioContext({ latencyHint: "interactive" });
    await context.resume();
    const compiler = new FaustCompiler(new LibFaust(await instantiateFaustModule()));
    const generator = new FaustMonoDspGenerator();
    await generator.compile(compiler, "remote", /** @type {HTMLTextAreaElement} */ ($("code")).value, "-ftz 2");
    if (!generator.factory) throw new Error(compiler.getErrorMessage());
    const node = await generator.createNode(context);
    if (!node) throw new Error("the node could not be created");
    node.connect(context.destination);

    // The page's own UI first: the host chains the handlers it finds
    await createFaustUI($("ui"), node);

    const room = randomHex(6);
    const token = randomHex(16);
    const host = new FaustRemoteHost(node, { token });
    const signaling = createHttpSignaling(location.origin, room, token, {
        role: "host",
        onerror: (error) => console.warn("signaling:", error.message)
    });
    await signaling.ready;
    host.listen(signaling);

    const url = new URL("remote.html", location.href);
    url.hash = `room=${room}&token=${token}`;
    $("pairing").innerHTML = "";
    const link = document.createElement("a");
    link.href = url.href;
    link.target = "_blank";
    link.textContent = url.href;
    $("pairing").append("Remote control: ", link);
    $("qrcode").innerHTML = qrCodeSvg(url.href, { border: 2 });

    const showClients = () => {
        $("clients").textContent = `Connected: ${host.clients.map((client) => client.id).join(", ") || "none"}`;
    };
    host.addEventListener("join", showClients);
    host.addEventListener("leave", showClients);
    host.addEventListener("error", (event) => console.warn("host:", /** @type {CustomEvent} */ (event).detail));
    showClients();

    Object.assign(window, { faustRemote: { host, node, context, room, token, url: url.href } });
};

$("start").addEventListener("click", () =>
    start().catch((error) => {
        $("error").textContent = String(error?.message ?? error);
        $("start").removeAttribute("disabled");
    })
);
