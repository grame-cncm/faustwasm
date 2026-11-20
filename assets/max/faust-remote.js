/**
 * Remote control of a Max patch from phones: the script of a `node.script`
 * object (Node for Max, Max 8 and 9). It drives a faustgen~ (the default
 * target), or any patch through its named parameters (`target params`,
 * with faust-params.js).
 *
 * It runs, in Node, faustwasm's remote control server (the phones' PWA,
 * signaling and the WebSocket relay) and a FaustRemoteHost on a
 * FaustRemoteHub, which stands in for the DSP (src/max/bridge.ts, loaded
 * from dist/remote/max-bridge.js and shared with faust-remote-v8.js, the
 * same in a `v8` object): what the phones write comes
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
 *   target params    drive the patch's named parameters (faust-params.js)
 *                    rather than a faustgen~
 *   ui <file>        the phones' interface, from this Faust JSON (relative to
 *                    this script's folder) rather than from the patch: for
 *                    `target params`, a Faust interface describing the
 *                    parameters (groups, sensors), matched by label
 *   dump <ms>        how often faustgen~ is asked for its controls while
 *                    phones are connected, 250 by default; 0 for a faustgen~
 *                    that reports its changes (`@report <ms>`)
 *
 * Messages in:
 *   json <text>                 the DSP's JSON (faust-json.js, faust-params.js,
 *                               or a faustgen~ that answers `json`)
 *   values <path> <v> ...       values faustgen~ reports: bargraphs, and its
 *                               controls after a `dump`
 *   <path> <cur> <min> <max>    a list from faustgen~'s control outlet, wired
 *                               straight to this object (a faustgen~ with
 *                               `@report`: only what changed)
 *   pvalues <name> <v> ...      with `target params`: parameters that moved,
 *                               and bargraphs (faust-params.js)
 * Messages out:
 *   param <path> <value>        for faustgen~'s left inlet, without `param`
 *   pset <name> <value>         with `target params`, for faust-params.js
 *   midi <bytes...>             for faustgen~, as `midievent <bytes...>`
 *   dump                        ask faustgen~ for its controls' values
 *   getjson                     ask faust-json.js or faust-params.js for the JSON
 *                               (or faustgen~, as a `json` message)
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
 * was paired once finds its host again; outside the folder served. The
 * v8 version (faust-remote-v8.js) uses the same file.
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
    let ui;
    if (args.ui) {
        const file = path.resolve(__dirname, args.ui);
        try {
            ui = fs.readFileSync(file, 'utf8');
        } catch (e) {
            return error(`faust-remote: cannot read ${file} (${e.message})`);
        }
    }
    const pkg = path.resolve(args.faustwasm ?? path.join(__dirname, '..', '..'));
    const load = (file) => import(pathToFileURL(path.join(pkg, file)).href);
    const { default: createFaustRemoteServer } = await load('src/faustRemoteServer.js');
    const { createMaxBridge } = await load('dist/remote/max-bridge.js');

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
    maxAPI.post(`faust-remote: serving ${root} on ${origin}`);

    // What the patch and the phones say to each other: src/max/bridge.ts,
    // shared with faust-remote-v8.js
    const bridge = createMaxBridge({
        outlet,
        post: (message) => maxAPI.post(message),
        error,
        hostRoom: () => server.hostRoom(room, token),
        link: `${origin}/remote/index.html#room=${room}&token=${token}`,
        params: args.target === 'params',
        ui,
        dumpPeriod: args.dump !== undefined ? Number(args.dump) : undefined,
        hostOptions: {
            token,
            sensorPolicy: args.sensors,
            assign: args.assign === 'groups' ? 'groups' : undefined,
            playoutDelay: args.delay ? Number(args.delay) / 1000 : undefined
        }
    });
    on('json', (...parts) => bridge.json(parts.join(' ')));
    on('values', (...pairs) => bridge.values(...pairs));
    on('pvalues', (...pairs) => bridge.pvalues(...pairs));
    // faustgen~'s lists, `<path> <cur> <min> <max>`: a list that starts with
    // a symbol reaches a node.script as a message named after it, the path,
    // which only the catch-all handler sees, as (handled, selector, ...args)
    on(maxAPI.MESSAGE_TYPES.ALL, (handled, name, ...atoms) => {
        if (!handled && typeof name === 'string' && name.startsWith('/')) bridge.list(name, ...atoms);
    });
    bridge.start();
};

main().catch((e) => error(`faust-remote: ${e.message}`));
