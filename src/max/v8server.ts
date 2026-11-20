/**
 * The remote control server for Max's `v8` object (Max 9.2 and later): what
 * `src/faustRemoteServer.js` does under Node, rebuilt on what `v8` has --
 * its `require('http')` and `require('https')`, a minimal subset of Node's,
 * its `WebSocketServer`, and Max's `File` for the files served. It serves
 * one room, whose host runs in the same `v8` object (`hostRoom`), so its
 * remote controls always come through the relay: `v8` has no WebRTC.
 *
 * - Files under `root`: the remote control PWA (`remote/`) and, for "Play
 *   locally", the DSP's files.
 * - `/signal/<room>/...`: with the room's token, HTTP 409 "no host", which
 *   sends a remote control to the relay at once (its signaling error rejects
 *   the WebRTC attempt, instead of waiting for its timeout).
 * - `/relay/<room>`: the WebSocket relay, in the framing of
 *   `src/faustRemoteServer.js` (`id\n` in front of each message, a lone `!`
 *   for an end), towards the port `hostRoom` returns. That is the framing
 *   `acceptRelayed` (src/remote/relay.ts) reads, so the host takes these
 *   remote controls as it takes those of the Node server's relay.
 *
 * Compared with the Node server: one room instead of many, no relaying host
 * from elsewhere (the host is here), no WebRTC signaling to carry, no CORS
 * (only pages of this server's own origin), and the WebSocket framing is
 * `v8`'s, not hand-written.
 *
 * Everything it needs from Max comes in as `V8ServerDeps`, so that the tests
 * can run it under Node (test/cli/max-v8.test.mjs).
 */
import type { FaustRelayPort } from '../remote/relay';

/**
 * What the server takes from its environment: in Max, `v8`'s modules and
 * globals; in the tests, Node's server and a small WebSocket server.
 * Request and response are typed loosely: `v8`'s are a subset of Node's,
 * and only `url`, `method`, `headers`, `writeHead`, `setHeader` and `end`
 * are used.
 */
export interface V8ServerDeps {
    http: { createServer: (handler: (req: any, res: any) => void) => any };
    https: {
        createServer: (
            options: { key: string; cert: string },
            handler: (req: any, res: any) => void
        ) => any;
    };
    /**
     * `v8`'s `WebSocketServer`, used with `noServer` so that the relay
     * shares the HTTP(S) port: the server's `upgrade` event hands it the
     * request, and `handleUpgrade` gives back a connection with
     * `onmessage({ data })`, `onclose`, `send` and `close`.
     */
    WebSocketServer: new (options: { noServer: true }) => {
        handleUpgrade: (
            req: any,
            socket: any,
            head: any,
            callback: (ws: any) => void
        ) => void;
    };
    /** A file's bytes, or null if there is no such (regular) file. */
    readFile: (path: string) => Uint8Array | null;
}

export interface V8ServerOptions {
    /** The folder served, an absolute path with `/` separators. */
    root: string;
    /** PEM key and certificate (their text): HTTPS, which phones' sensors need. */
    key?: string;
    cert?: string;
}

/** By extension; anything else is served as `application/octet-stream`. */
const CONTENT_TYPES: Record<string, string> = {
    html: 'text/html; charset=utf-8',
    js: 'text/javascript; charset=utf-8',
    mjs: 'text/javascript; charset=utf-8',
    css: 'text/css; charset=utf-8',
    json: 'application/json; charset=utf-8',
    map: 'application/json; charset=utf-8',
    webmanifest: 'application/manifest+json',
    wasm: 'application/wasm',
    data: 'application/octet-stream',
    svg: 'image/svg+xml',
    png: 'image/png',
    ico: 'image/x-icon',
    txt: 'text/plain; charset=utf-8',
    dsp: 'text/plain; charset=utf-8',
    lib: 'text/plain; charset=utf-8'
};

/** Milliseconds for a relay connection to say who it is, or be closed. */
const HELLO_TIMEOUT = 10000;

/** A short plain text answer, never cached (the signaling's answers). */
const reply = (res: any, status: number, text = '') => {
    res.writeHead(status, {
        'content-type': 'text/plain; charset=utf-8',
        'cache-control': 'no-store'
    });
    res.end(text);
};

/**
 * The segments of a URL path, decoded, or null if one of them would leave
 * the folder served (`..`) or cannot be decoded. Without a `path` module in
 * `v8`, this is what keeps requests inside `root`: segments are checked
 * after decoding, so `%2e%2e` and `%2f` are caught too, and empty or `.`
 * segments are dropped.
 */
export const pathSegments = (url: string): string[] | null => {
    const pathname = url.split(/[?#]/)[0];
    const segments: string[] = [];
    for (const raw of pathname.split('/')) {
        let segment: string;
        try {
            segment = decodeURIComponent(raw);
        } catch {
            return null;
        }
        if (segment === '' || segment === '.') continue;
        if (segment === '..' || /[/\\\0]/.test(segment)) return null;
        segments.push(segment);
    }
    return segments;
};

/**
 * Create the server; call `server.listen` on what it returns, then
 * `hostRoom` for the host's port.
 */
export const createV8RemoteServer = (
    deps: V8ServerDeps,
    options: V8ServerOptions
) => {
    const root = options.root.replace(/\/+$/, '');
    const secure = Boolean(options.key && options.cert);
    const scheme = secure ? 'https' : 'http';
    /** The room served, once `hostRoom` has been called. */
    let room: { name: string; token: string; port: FaustRelayPort } | null =
        null;
    /** The relayed remote controls, by id: where the host's messages go. */
    const remotes = new Map<
        string,
        { send(text: string): void; close(): void }
    >();

    /**
     * Same origin, or no origin (not a browser page): nothing else. A
     * WebSocket is not covered by CORS, so a page elsewhere could otherwise
     * open the relay from a phone's browser; it still needs the token.
     */
    const sameOrigin = (req: any) =>
        req.headers.origin === undefined ||
        req.headers.origin === `${scheme}://${req.headers.host}`;

    /** A file under `root`, or a folder's `index.html`. */
    const serveFile = (req: any, res: any, segments: string[]) => {
        if (req.method !== 'GET' && req.method !== 'HEAD')
            return reply(res, 405, 'not allowed');
        const file = [root, ...segments].join('/');
        let path = file;
        // Max's File does not open a folder: whatever does not open as a
        // file is tried as a folder
        let data = segments.length ? deps.readFile(file) : null;
        if (!data) {
            path = `${file}/index.html`;
            data = deps.readFile(path);
        }
        if (!data) return reply(res, 404, 'not found');
        const extension = (path.match(/\.([^./]+)$/)?.[1] ?? '').toLowerCase();
        res.writeHead(200, {
            'content-type':
                CONTENT_TYPES[extension] ?? 'application/octet-stream',
            // Regenerated with faust2wasm while the patch runs: never stale
            'cache-control': 'no-store',
            'content-length': String(data.length)
        });
        res.end(req.method === 'HEAD' ? undefined : data);
    };

    /** Every HTTP request: signaling under `/signal/`, files elsewhere. */
    const handle = (req: any, res: any) => {
        const segments = pathSegments(req.url ?? '/');
        if (!segments) return reply(res, 400, 'bad URL');
        if (segments[0] !== 'signal') return serveFile(req, res, segments);
        // No WebRTC here: the remote control learns it at its first request
        // and goes to the relay. The token is still checked first, so that
        // the answer says nothing of the room to whoever lacks it.
        if (!sameOrigin(req)) return reply(res, 403, 'origin not allowed');
        const token = req.headers['x-faust-token'];
        if (typeof token !== 'string' || token === '')
            return reply(res, 401, 'token required');
        if (!room || segments[1] !== room.name)
            return reply(res, 404, 'no such room');
        if (token !== room.token) return reply(res, 403, 'wrong token');
        reply(res, 409, 'no host');
    };

    /**
     * A relay connection: authenticate the first message, then forward.
     * The first message is `{ token, role: 'remote', id }`, as the remote
     * control's `connectRelay` sends it; the answer is `ok`, or the
     * connection closes. After that, each message goes to the host's port
     * prefixed with the id, and the connection's end as `id\n!`.
     */
    const relay = (ws: any, roomName: string) => {
        let id = '';
        let accepted = false;
        /** This connection, as the host's messages reach it. */
        const peer = {
            send: (text: string) => ws.send(text),
            close: () => ws.close()
        };
        const timeout = setTimeout(() => ws.close(), HELLO_TIMEOUT);
        ws.onmessage = (event: { data: unknown }) => {
            // Text only: the protocol has no binary message
            if (typeof event.data !== 'string') return ws.close();
            const text = event.data;
            if (accepted) {
                room?.port.onmessage?.(`${id}\n${text}`);
                return;
            }
            clearTimeout(timeout);
            let hello: any;
            try {
                hello = JSON.parse(text);
            } catch {
                return ws.close();
            }
            // Only remote controls: the room's host is in this process. The
            // id becomes a prefix in the framing, hence the narrow alphabet
            // (no newline can slip in).
            if (
                !room ||
                roomName !== room.name ||
                hello?.role !== 'remote' ||
                hello?.token !== room.token ||
                typeof hello?.id !== 'string' ||
                !/^[\w-]{1,64}$/.test(hello.id)
            )
                return ws.close();
            id = hello.id;
            // The same remote control again (a reload, a reconnect): the
            // new connection replaces the old one
            remotes.get(id)?.close();
            remotes.set(id, peer);
            accepted = true;
            ws.send('ok');
        };
        ws.onclose = () => {
            clearTimeout(timeout);
            // A connection that was replaced, or ended by the host, has
            // nothing more to report
            if (!accepted || remotes.get(id) !== peer) return;
            remotes.delete(id);
            room?.port.onmessage?.(`${id}\n!`);
        };
    };

    const wss = new deps.WebSocketServer({ noServer: true });
    const server = secure
        ? deps.https.createServer(
              { key: options.key as string, cert: options.cert as string },
              handle
          )
        : deps.http.createServer(handle);
    // The relay shares the port: only `/relay/<room>` is upgraded
    server.on('upgrade', (req: any, socket: any, head: any) => {
        const segments = pathSegments(req.url ?? '/');
        if (
            !segments ||
            segments.length !== 2 ||
            segments[0] !== 'relay' ||
            !sameOrigin(req)
        ) {
            socket.destroy?.();
            return;
        }
        wss.handleUpgrade(req, socket, head, (ws) => relay(ws, segments[1]));
    });

    return {
        /** The HTTP(S) server: `listen` on it. */
        server,
        /**
         * Serve `name` with `token`, for the host in this process: the
         * remote controls that come through the relay reach the returned
         * port. A new call replaces the room, and ends the remote controls
         * of the previous one.
         */
        hostRoom(name: string, token: string): FaustRelayPort {
            if (typeof token !== 'string' || token === '')
                throw new Error('a token is required');
            room?.port.close();
            let open = true;
            const port: FaustRelayPort = {
                onmessage: null,
                onclose: null,
                // From the host: `id\n` + message for that remote control,
                // or `id\n!` to end its connection
                send(text) {
                    if (!open) return;
                    const cut = text.indexOf('\n');
                    if (cut <= 0) return;
                    const target = remotes.get(text.slice(0, cut));
                    const payload = text.slice(cut + 1);
                    if (!target) return;
                    if (payload === '!') target.close();
                    else target.send(payload);
                },
                close() {
                    if (!open) return;
                    open = false;
                    if (room?.port === port) room = null;
                    for (const remote of [...remotes.values()]) remote.close();
                    remotes.clear();
                    // Asynchronous, as a WebSocket's close event is: the
                    // host may still be in the call that closed the port
                    Promise.resolve().then(() => port.onclose?.());
                }
            };
            room = { name, token, port };
            return port;
        },
        /** Stop listening, and end every remote control. */
        close() {
            room?.port.close();
            server.close();
        }
    };
};
