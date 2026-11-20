/**
 * Remote control of a Max patch from phones, in a `v8` object (Max 9.2 and
 * later): `[v8 faust-remote-v8.js <args>]`, the same as the `node.script` of
 * `assets/max/faust-remote.js` -- same arguments, same messages -- in one
 * file and Max's own JavaScript engine, without Node for Max. Built into
 * `assets/max/faust-remote-v8.js` by `npm run build-esm` (self-contained:
 * the host, the hub and the server are bundled in, since `v8`'s `require`
 * only takes absolute paths and could not find faustwasm on its own).
 *
 * This file is the glue: it reads the arguments, finds the files, keeps
 * the session, starts the server (src/max/v8server.ts) and hands the rest
 * to the bridge shared with the `node.script` (src/max/bridge.ts). Phones
 * always go through the relay (no WebRTC in `v8`). Where `v8` lacks what
 * the `node.script` takes from Node -- read in the JavaScript Max embeds in
 * `v8`, and tried in Max 9.2.1:
 * - no network interfaces: the pairing link names `address`, which should be
 *   given (this computer's address on the phones' network); without it the
 *   link says 127.0.0.1, which only this computer can open;
 * - no `crypto`: a new token is drawn from Max's own WebSocket client, whose
 *   handshake key (RFC 6455) is 16 random bytes; two handshakes with a
 *   throwaway local server, hashed, give the token and the room;
 * - no `fs`: files through Max's `File`; the session is kept where the
 *   `node.script` keeps it (`~/.faust-remote/max-<key>.json`, the same
 *   key), so a phone paired with one finds the other, if that folder exists
 *   (`File` cannot make a folder);
 * - no `performance`, `EventTarget`, `CustomEvent`: src/remote/runtime.ts
 *   falls back on what is there.
 *
 * Arguments, as name and value pairs (see faust-remote.js): root, port,
 * cert, key, address, room, token, sensors, assign, delay, target, ui;
 * paths relative to the patch's folder. `host` (the interface listened on)
 * as well. Not here: `faustwasm` (nothing to load) and `trace`.
 *
 * The script runs as a classic script, not a module: Max calls the
 * functions of its global object by message name, so the handlers below
 * are set on `globalThis` (esbuild's IIFE keeps everything else private).
 */
import { sha256 } from '../remote/runtime';
import { createMaxBridge, type MaxBridge } from './bridge';
import { createV8RemoteServer } from './v8server';

// What Max gives a v8 script
declare const jsarguments: unknown[];
declare const outlet: (index: number, ...message: unknown[]) => void;
declare const post: (...message: unknown[]) => void;
declare const error: (...message: unknown[]) => void;
declare const max: { os: string };
declare const patcher: { filepath: string };
declare const require: (name: string) => any;
declare const WebSocketServer: any;
declare class File {
    constructor(path: string, mode?: string, type?: string);
    isopen: boolean | number;
    eof: number;
    position: number;
    readbytes(count: number): number[] | null;
    readstring(count: number): string | null;
    writestring(text: string): void;
    close(): void;
}

const g = globalThis as any;
// Read by Max as the script runs: one inlet for the patch's messages, one
// outlet for the messages to the patch
g.inlets = 1;
g.outlets = 1;

const hex = (bytes: Uint8Array) =>
    Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

/**
 * A Max path (`Macintosh HD:/Users/...`) as a plain one (`/Users/...`),
 * which `File` takes as well. On Windows the drive (`C:/...`) is kept.
 */
export const plainPath = (path: string, os: string) =>
    os === 'windows' ? path : path.replace(/^[^/:]+:(?=\/)/, '');

/**
 * `relative` from `base`, both with `/` separators: `v8` has no `path`
 * module. An absolute `relative` (`/...`, `C:/...`, `~/...`) is kept as
 * it is; `..` never climbs above the first segment.
 */
export const resolvePath = (base: string, relative: string) => {
    const absolute = /^(\/|[A-Za-z]:\/|~\/)/.test(relative);
    const parts = (absolute ? relative : `${base}/${relative}`).split('/');
    const out: string[] = [];
    for (const part of parts) {
        if (part === '.' || (part === '' && out.length > 0)) continue;
        if (part === '..' && out.length > 1) out.pop();
        else out.push(part);
    }
    return out.join('/') || '/';
};

/**
 * A file's bytes through Max's `File`, or null: missing, a folder (which
 * `File` does not open), or cut short. `readbytes` gives an array of
 * numbers, read here in chunks of 64 kB (a few ms for the PWA's scripts).
 */
const readFile = (path: string): Uint8Array | null => {
    const file = new File(path, 'read');
    try {
        if (!file.isopen) return null;
        const size = file.eof;
        const data = new Uint8Array(size);
        let at = 0;
        while (at < size) {
            const chunk = file.readbytes(Math.min(65536, size - at));
            if (!chunk || chunk.length === 0) break;
            data.set(chunk, at);
            at += chunk.length;
        }
        return at === size ? data : null;
    } finally {
        file.close();
    }
};

/** A file's text (UTF-8), or null. */
const readText = (path: string) => {
    const data = readFile(path);
    return data ? new TextDecoder().decode(data) : null;
};

/** Write a file's text, and say whether it really was written. */
const writeText = (path: string, text: string) => {
    const file = new File(path, 'write', 'TEXT');
    try {
        if (!file.isopen) return false;
        // Truncate: `write` mode does not empty an existing file
        file.eof = 0;
        file.writestring(text);
    } finally {
        file.close();
    }
    // Max may say a file is open in a folder that does not exist, and
    // write nothing: only reading it back tells
    return readText(path) === text;
};

/**
 * 32 random bytes from Max's WebSocket client: the handshake keys of two
 * connections to a throwaway server on the loopback, hashed. Each key is
 * the 16 random bytes RFC 6455 asks of a client; Max's client is built on
 * Boost.Beast, which draws them from its secure generator by default.
 * `Math.random` would not do for a token. The
 * connections are refused once their key is read, and the server closed.
 *
 * @param http - `v8`'s `require('http')`
 * @param Socket - `v8`'s `WebSocket`
 */
export const handshakeEntropy = (
    http: any,
    Socket: any,
    connections = 2
): Promise<Uint8Array> =>
    new Promise((resolve, reject) => {
        const keys: string[] = [];
        const server = http.createServer((req: any, res: any) => res.end());
        const timer = setTimeout(() => {
            server.close();
            reject(new Error('no WebSocket handshake to draw a token from'));
        }, 5000);
        server.on('upgrade', (req: any, socket: any) => {
            const key = req.headers['sec-websocket-key'];
            socket.destroy?.();
            // A key is 24 characters of base64; the same key twice would
            // mean no randomness at all
            if (
                typeof key !== 'string' ||
                key.length < 22 ||
                keys.includes(key)
            )
                return;
            keys.push(key);
            if (keys.length < connections) return;
            clearTimeout(timer);
            server.close();
            resolve(sha256(new TextEncoder().encode(keys.join('\n'))));
        });
        server.listen(0, '127.0.0.1', () => {
            const { port } = server.address();
            for (let i = 0; i < connections; i++) {
                const ws = new Socket(`ws://127.0.0.1:${port}/`);
                // Refused by design: nothing to report
                ws.onerror = () => {};
                ws.onclose = () => {};
            }
        });
    });

/**
 * The session file's name, the `node.script`'s for the same root and port:
 * the first 16 hex digits of SHA-256(`<root>:<port>`).
 */
export const sessionKey = (root: string, port: number) =>
    hex(sha256(new TextEncoder().encode(`${root}:${port}`))).slice(0, 16);

let bridge: MaxBridge | null = null;
/**
 * A JSON that came before the bridge: faustgen~ sends it when it compiles,
 * as the patch loads, possibly before the server is up. Only the last one
 * counts.
 */
let early: string | undefined;
let server: ReturnType<typeof createV8RemoteServer> | null = null;
/** `start` runs once, whichever of loadbang and the timer comes first. */
let started = false;

// As in the classic js object, post and error do not end the line
const say = (...message: unknown[]) => post(...message, '\n');
const fail = (message: string) => error(message, '\n');

/**
 * Read the arguments, check the files, settle the session, listen, and
 * hand over to the bridge. Asynchronous: a new token waits for two
 * handshakes, and the server for its port.
 */
const start = async () => {
    if (started) return;
    started = true;
    const list = (jsarguments ?? []).slice(1).map(String);
    const args: Record<string, string> = {};
    for (let i = 0; i + 1 < list.length; i += 2) args[list[i]] = list[i + 1];
    // Paths are relative to the patch's folder: `v8` knows the patch's
    // file, not the script's
    const folder = plainPath(patcher?.filepath ?? '', max.os).replace(
        /\/[^/]*$/,
        ''
    );
    if (!args.root)
        return fail('faust-remote: give the folder to serve: root <dir>');
    if (!folder && !/^(\/|[A-Za-z]:\/)/.test(args.root))
        return fail(
            'faust-remote: save the patch first, or give root as an absolute path'
        );
    const at = (relative: string) => resolvePath(folder, relative);
    const root = at(args.root);
    if (!readFile(`${root}/remote/index.html`))
        return fail(
            `faust-remote: ${root} has no remote/index.html (generate it with faust2wasm -remote)`
        );
    const http = require('http');
    const key = args.cert && args.key ? readText(at(args.key)) : null;
    const cert = args.cert && args.key ? readText(at(args.cert)) : null;
    if (args.cert && args.key && (!key || !cert))
        return fail('faust-remote: cannot read the certificate or its key');
    let ui: string | undefined;
    if (args.ui) {
        const text = readText(at(args.ui));
        if (text === null)
            return fail(`faust-remote: cannot read ${at(args.ui)}`);
        ui = text;
    }

    const port = Number(args.port ?? 8443);
    // The session: given, kept, or new. Kept outside the folder served, so
    // that the token is never one of the files the server hands out.
    const file = `~/.faust-remote/max-${sessionKey(root, port)}.json`;
    let stored: { room?: string; token?: string } = {};
    try {
        stored = JSON.parse(readText(file) ?? '{}');
    } catch {
        // Unreadable: a new session
    }
    let room = args.room ?? stored.room;
    let token = args.token ?? stored.token;
    if (!room || !token) {
        let random: Uint8Array;
        try {
            random = await handshakeEntropy(http, g.WebSocket);
        } catch (e) {
            return fail(
                `faust-remote: ${(e as Error).message}; give one: token <secret>`
            );
        }
        // 16 bytes for the token, as the node.script draws; 6 for the room
        token ??= hex(random.subarray(0, 16));
        room ??= hex(random.subarray(16, 22));
    }
    if (stored.room !== room || stored.token !== token) {
        if (!writeText(file, JSON.stringify({ room, token })))
            say(
                'faust-remote: the session is not kept (no ~/.faust-remote folder); phones pair again at the next start'
            );
    }

    server = createV8RemoteServer(
        {
            http,
            https: require('https'),
            WebSocketServer,
            readFile
        },
        { root, key: key ?? undefined, cert: cert ?? undefined }
    );
    const listening = server.server;
    await new Promise<void>((resolve, reject) => {
        listening.on('error', reject);
        listening.listen(port, args.host ?? '0.0.0.0', () => resolve());
    }).catch((e) => {
        server = null;
        throw e;
    });
    const secure = Boolean(key && cert);
    if (!args.address)
        say(
            'faust-remote: v8 cannot tell this computer’s network address; give it for the phones: address <a.b.c.d>'
        );
    const origin = `${secure ? 'https' : 'http'}://${args.address ?? '127.0.0.1'}:${port}`;
    // The room and token travel in the fragment, which a browser never
    // sends to a server
    const link = `${origin}/remote/index.html#room=${room}&token=${token}`;
    say(`faust-remote: serving ${root} on ${origin}`);
    const roomName = room as string;
    const secret = token as string;
    const serving = server;
    bridge = createMaxBridge({
        outlet: (...message) => outlet(0, ...message),
        post: (message) => say(message),
        error: (message) => fail(message),
        hostRoom: () => serving.hostRoom(roomName, secret),
        link,
        params: args.target === 'params',
        ui,
        hostOptions: {
            token: secret,
            sensorPolicy: args.sensors as any,
            assign: args.assign === 'groups' ? 'groups' : undefined,
            playoutDelay: args.delay ? Number(args.delay) / 1000 : undefined
        }
    });
    bridge.start();
    if (early !== undefined) bridge.json(early);
    early = undefined;
};

// Messages from the patch. A message's atoms come as separate arguments:
// a JSON with spaces may arrive in several pieces, joined again here.
g.json = (...parts: unknown[]) => {
    const text = parts.map(String).join(' ');
    if (bridge) bridge.json(text);
    else early = text;
};
g.values = (...pairs: unknown[]) => bridge?.values(...pairs);
g.pvalues = (...pairs: unknown[]) => bridge?.pvalues(...pairs);
g.loadbang = () => run();
// The object is deleted, or its patch closed: free the port for the next
// one
g.notifydeleted = () => {
    bridge?.close();
    server?.close();
    bridge = null;
    server = null;
};

const run = () =>
    start().catch((e) => fail(`faust-remote: ${(e as Error).message}`));
// Outlets exist once the object is made: right after this script has run
// (loadbang only comes when a patch is opened, not for a new object)
setTimeout(run, 0);
