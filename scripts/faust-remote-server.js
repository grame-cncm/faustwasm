#!/usr/bin/env node
//@ts-check
import * as fs from "fs";
import * as os from "os";
import * as process from "process";
import createFaustRemoteServer from "../src/faustRemoteServer.js";

const argv = process.argv.slice(2);

if (argv.includes("-help") || argv.includes("-h") || argv.length === 0) {
    console.log(`
faust-remote-server.js <rootDir> [-port <n>] [-host <address>] [-cert <file.pem> -key <file.pem>] [-allow-origin <origin>]... [-host-port <n>]
Serves <rootDir> and relays the signaling of Faust remote control sessions.
With -cert and -key, serves HTTPS: phones need it for their sensors and
for a PWA, anywhere but on localhost. Default port 8443, default address
0.0.0.0 (every interface). -allow-origin (repeatable) lets pages served
from another origin, such as https://example.org, use the signaling and
the relay. -host-port opens a second, plain HTTP port on 127.0.0.1 that
only hosts may use, to reach the relay without TLS: for a native Faust
application on this computer (RemoteUI), when the server runs HTTPS.
`);
    process.exit(argv.length === 0 ? 1 : 0);
}

/** @param {string} flag */
const takeValue = (flag) => {
    const index = argv.indexOf(flag);
    if (index === -1) return undefined;
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("-")) {
        console.error(`${flag} needs a value`);
        process.exit(1);
    }
    argv.splice(index, 2);
    return value;
};

/** Every value of a flag that may be given several times. */
const takeValues = (/** @type {string} */ flag) => {
    const values = [];
    while (argv.includes(flag)) values.push(/** @type {string} */ (takeValue(flag)));
    return values;
};

const allowOrigins = takeValues("-allow-origin");
for (const origin of allowOrigins) {
    let valid = false;
    try {
        const url = new URL(origin);
        valid = (url.protocol === "https:" || url.protocol === "http:") && url.origin === origin;
    } catch { /* invalid below */ }
    if (!valid) {
        console.error(`-allow-origin wants an origin such as https://example.org, not ${origin}`);
        process.exit(1);
    }
}
const port = Number(takeValue("-port") ?? 8443);
const host = takeValue("-host") ?? "0.0.0.0";
const certFile = takeValue("-cert");
const keyFile = takeValue("-key");
const hostPortValue = takeValue("-host-port");
const hostPort = hostPortValue === undefined ? undefined : Number(hostPortValue);
const [root] = argv;

if (!root || !fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    console.error(`${root} is not a directory`);
    process.exit(1);
}
if (!Number.isInteger(port) || port < 0 || port > 65535) {
    console.error(`invalid port ${port}`);
    process.exit(1);
}
if (hostPort !== undefined && (!Number.isInteger(hostPort) || hostPort < 0 || hostPort > 65535)) {
    console.error(`invalid host port ${hostPortValue}`);
    process.exit(1);
}
if (!!certFile !== !!keyFile) {
    console.error("-cert and -key go together");
    process.exit(1);
}

const server = createFaustRemoteServer({
    root,
    cert: certFile ? fs.readFileSync(certFile) : undefined,
    key: keyFile ? fs.readFileSync(keyFile) : undefined,
    allowOrigins
});

server.listen(port, host, () => {
    const address = server.address();
    const actualPort = typeof address === "object" && address ? address.port : port;
    const scheme = certFile ? "https" : "http";
    const hosts = host === "0.0.0.0"
        ? ["localhost", ...Object.values(os.networkInterfaces())
            .flat()
            .filter((i) => i && i.family === "IPv4" && !i.internal)
            .map((i) => i?.address)]
        : [host];
    console.log(`Serving ${root}`);
    if (allowOrigins.length) console.log(`Signaling and relay open to ${allowOrigins.join(", ")}`);
    for (const name of hosts) console.log(`  ${scheme}://${name}:${actualPort}/`);
    if (!certFile)
        console.log("Without -cert and -key, phones get no sensors and no PWA (HTTPS only, except on localhost).");
});

if (hostPort !== undefined) {
    const hosts = server.hostListener();
    hosts.listen(hostPort, "127.0.0.1", () => {
        const address = hosts.address();
        const actualPort = typeof address === "object" && address ? address.port : hostPort;
        console.log(`Relay for hosts on this computer: ws://127.0.0.1:${actualPort}/relay/<room>`);
    });
}
