/**
 * Remote control of a faustgen~ DSP from phones, in a Max patch: the script
 * of a `node.script` object (Node for Max, Max 8 and 9).
 *
 * It runs, in Node, faustwasm's remote control server (the phones' PWA,
 * signaling and the WebSocket relay) and a FaustRemoteHost on a
 * FaustRemoteHub, which stands in for the DSP: what the phones write comes
 * out of this object as messages for faustgen~, and what faustgen~ reports
 * (bargraphs, and its controls when asked with `dump`) comes back in. The
 * phones connect through the relay: Node has no WebRTC (section 20 of
 * docs/remote-control.md).
 *
 * Arguments (`@args`), as name and value pairs, all optional but `root`:
 *   root <dir>       the folder served (relative to this script's folder): a
 *                    `faust2wasm -remote` output, for its
 *                    remote/ PWA (and, for "Play locally", its compiled DSP)
 *   port <n>         default 8443
 *   cert <file>      PEM certificate and key: HTTPS, which phones need for
 *   key <file>       their motion sensors
 *   address <a>      the address put in the pairing link; default: this
 *                    machine's first local network address
 *   room <r>         default: kept from one run to the next (with the token)
 *   token <t>          in ~/.faust-remote/, never in the folder served
 *   sensors <p>      shared | mean | assigned (the host's sensorPolicy)
 *   assign groups    one top-level group of the DSP per phone
 *   delay <ms>       timed mode: values played this long after they were sent
 *   faustwasm <dir>  where the faustwasm package is; default: two folders up
 *                    from this script, which is where it is in the package
 *   trace <file>     append every message in and out to this file, one JSON
 *                    line each, to see what goes on between the patch and
 *                    the phones
 *
 * Messages in:
 *   json <text>                 the DSP's JSON (from faust-json.js)
 *   values <path> <v> ...       values faustgen~ reports: bargraphs, and its
 *                               controls after a `dump`
 * Messages out:
 *   param <path> <value>        for faustgen~'s left inlet, without `param`
 *   midi <bytes...>             for faustgen~, as `midievent <bytes...>`
 *   dump                        ask faustgen~ for its controls' values
 *   getjson                     ask faust-json.js for the JSON it holds
 *   link <url>                  the pairing link, to open on a phone
 *   clients <n>                 how many phones are connected
 */
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const maxAPI = require('max-api');

/** How often faustgen~ is asked for its controls, while phones are connected. */
const DUMP_PERIOD = 250;

const parseArgs = (argv) => {
    const args = {};
    for (let i = 0; i + 1 < argv.length; i += 2) args[String(argv[i])] = String(argv[i + 1]);
    return args;
};

const error = (message) => maxAPI.post(message, maxAPI.POST_LEVELS.ERROR);

/** This machine's first local network IPv4 address, for the pairing link. */
const localAddress = () => {
    for (const list of Object.values(os.networkInterfaces())) {
        for (const item of list ?? []) {
            if (item.family === 'IPv4' && !item.internal) return item.address;
        }
    }
    return '127.0.0.1';
};

/**
 * The room and token, kept from one run to the next so that a phone that
 * was paired once finds its host again; outside the folder served.
 */
const session = (root, port, args) => {
    const dir = path.join(os.homedir(), '.faust-remote');
    const key = crypto.createHash('sha256').update(`${root}:${port}`).digest('hex').slice(0, 16);
    const file = path.join(dir, `max-${key}.json`);
    let stored = {};
    try {
        stored = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
        // First run, or unreadable: a new session
    }
    const result = {
        room: args.room ?? stored.room ?? crypto.randomBytes(6).toString('hex'),
        token: args.token ?? stored.token ?? crypto.randomBytes(16).toString('hex')
    };
    try {
        fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
        fs.writeFileSync(file, JSON.stringify(result), { mode: 0o600 });
    } catch (e) {
        error(`faust-remote: cannot keep the session (${e.message})`);
    }
    return result;
};

const main = async () => {
    const args = parseArgs(process.argv.slice(2));
    // Every message out and in goes through these two, so that `trace`
    // can see them without touching max-api itself
    let outlet = (...message) => maxAPI.outlet(...message);
    let on = (name, handler) => maxAPI.addHandler(name, handler);
    if (args.trace) {
        const file = path.resolve(__dirname, args.trace);
        const write = (direction, message) =>
            fs.appendFile(file, JSON.stringify([Date.now(), direction, ...message]) + '\n', () => {});
        const send = outlet;
        outlet = (...message) => {
            write('out', message);
            return send(...message);
        };
        const listen = on;
        on = (name, handler) =>
            listen(name, (...message) => {
                write('in', [name, ...message]);
                return handler(...message);
            });
    }
    if (!args.root) return error('faust-remote: give the folder to serve: @args root <dir>');
    // Relative to this script's folder, where the patch usually is too
    const root = path.resolve(__dirname, args.root);
    if (!fs.existsSync(path.join(root, 'remote', 'index.html')))
        return error(`faust-remote: ${root} has no remote/index.html (generate it with faust2wasm -remote)`);
    const pkg = path.resolve(args.faustwasm ?? path.join(__dirname, '..', '..'));
    const load = (file) => import(pathToFileURL(path.join(pkg, file)).href);
    const { default: createFaustRemoteServer } = await load('src/faustRemoteServer.js');
    const { FaustRemoteHost, FaustRemoteHub } = await load('dist/remote/host.js');

    const port = Number(args.port ?? 8443);
    const secure = Boolean(args.cert && args.key);
    const server = createFaustRemoteServer({
        root,
        cert: secure ? fs.readFileSync(args.cert) : undefined,
        key: secure ? fs.readFileSync(args.key) : undefined
    });
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, args.host ?? '0.0.0.0', resolve);
    });
    const { room, token } = session(root, port, args);
    const origin = `${secure ? 'https' : 'http'}://${args.address ?? localAddress()}:${port}`;
    const link = `${origin}/remote/index.html#room=${room}&token=${token}`;
    maxAPI.post(`faust-remote: serving ${root} on ${origin}`);

    const hostOptions = {
        token,
        sensorPolicy: args.sensors,
        assign: args.assign === 'groups' ? 'groups' : undefined,
        playoutDelay: args.delay ? Number(args.delay) / 1000 : undefined
    };

    /** The current DSP: its JSON, hub, host and relay port. */
    let current = null;
    let dumpTimer = null;

    const clientsChanged = () => {
        const count = current?.host.clients.length ?? 0;
        outlet('clients', count);
        if (count > 0 && !dumpTimer) dumpTimer = setInterval(() => outlet('dump'), DUMP_PERIOD);
        if (count === 0 && dumpTimer) {
            clearInterval(dumpTimer);
            dumpTimer = null;
        }
    };

    /** A new DSP (or the first): a new hub and host; phones reconnect. */
    const setDSP = (json) => {
        if (json === current?.json) return;
        let hub;
        try {
            hub = new FaustRemoteHub(json, {
                onwrite: (address, value) => outlet('param', address, value),
                onmidi: (data) => outlet('midi', ...data)
            });
        } catch (e) {
            return error(`faust-remote: not a Faust JSON (${e.message})`);
        }
        if (current) {
            current.host.close();
            current.port.close();
            current.hub.close();
        }
        const host = new FaustRemoteHost(hub, hostOptions);
        host.addEventListener('join', (event) => {
            maxAPI.post(`faust-remote: phone ${event.detail.id} joined${event.detail.group ? ` (${event.detail.group})` : ''}`);
            clientsChanged();
        });
        host.addEventListener('leave', (event) => {
            maxAPI.post(`faust-remote: phone ${event.detail.id} left`);
            clientsChanged();
        });
        host.addEventListener('error', (event) => error(`faust-remote: ${event.detail?.message ?? event.detail}`));
        const relay = server.hostRoom(room, token);
        host.acceptRelay(relay);
        current = { json, hub, host, port: relay, inputs: new Set(hub.getParams()) };
        clientsChanged();
        maxAPI.post(`faust-remote: ${hub.getMeta().name ?? 'DSP'} ready, remote control: ${link}`);
        outlet('link', link);
    };

    on('json', (...parts) => setDSP(parts.join(' ')));
    on('values', (...pairs) => {
        if (!current) return;
        for (let i = 0; i + 1 < pairs.length; i += 2) {
            const address = String(pairs[i]);
            const value = Number(pairs[i + 1]);
            if (current.inputs.has(address)) {
                // What a phone wrote comes back the same: only a change made
                // in the patch goes to the phones
                if (value !== current.hub.getParamValue(address)) current.hub.update(address, value);
            } else {
                current.hub.output(address, value);
            }
        }
    });

    // The JSON faust-json.js already caught, until it has given one
    const ask = setInterval(() => (current ? clearInterval(ask) : outlet('getjson')), 1000);
    outlet('getjson');
};

main().catch((e) => error(`faust-remote: ${e.message}`));
