//@ts-check
/**
 * The server a remote control session needs on a local network: it serves the
 * host page and the remote control PWA, and relays signaling messages between
 * them until their WebRTC connection is open. No dependency: `node:http` or
 * `node:https`, `node:fs`, `node:path`.
 *
 * Signaling, under `/signal/<room>/`, every request carrying the room's token
 * in an `x-faust-token` header, never in the URL:
 *
 * - `POST host` `{ id }`: the host registers the room. The first token given
 *   for a room is the room's; another one is refused.
 * - `GET events/<id>`: the server-sent event stream of the messages for `id`.
 *   Ids are random and secret: knowing one is reading its messages.
 * - `POST send` `{ id, message }`: from the host's id, delivered to
 *   `message.peer`; from any other id, delivered to the host with `peer` set to
 *   the sender's id, so a remote control can only speak for itself.
 *
 * Relay, for networks where WebRTC does not connect: a WebSocket on
 * `/relay/<room>`. Its first message authenticates, `{ token, role, id }`;
 * the server answers `ok` or closes. Then a remote control's messages go to
 * the room's host prefixed with the remote control's id and a newline, and
 * the host's go, by that prefix, to the remote control it names; a lone `!`
 * after the prefix says that end has closed. Same token rule as signaling: a
 * relaying host registers the room as `POST host` does.
 *
 * Other origins: a page served elsewhere (an online editor, say) may use
 * this server's signaling and relay if its origin is in `allowOrigins`. The
 * server then answers CORS preflights and adds the CORS headers; it refuses
 * any other foreign origin, the relay included, which CORS does not cover
 * and whose `Origin` header the server checks itself. Requests without an
 * `Origin` (not from a browser page) or from the server's own origin are
 * served as before. Behind a reverse proxy that changes the host or the
 * scheme, list the server's public origin too.
 *
 * Messages for an id whose stream is not open yet are kept (the last 64, for a
 * minute), so a remote control may post its offer before its stream is up.
 * The server reads nothing in them but `peer`, and keeps nothing once they are
 * delivered.
 */
import { Buffer } from 'buffer';
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as http from 'http';
import * as https from 'https';
import * as path from 'path';
import { clearInterval, clearTimeout, setInterval, setTimeout } from 'timers';
import { URL } from 'url';

const MAX_BODY = 64 * 1024;
const MAX_QUEUE = 64;
const QUEUE_TTL = 60 * 1000;
const HEARTBEAT = 15 * 1000;

/** @type {Record<string, string>} */
const CONTENT_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.map': 'application/json; charset=utf-8',
    '.webmanifest': 'application/manifest+json',
    '.wasm': 'application/wasm',
    '.data': 'application/octet-stream',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.ico': 'image/x-icon',
    '.txt': 'text/plain; charset=utf-8',
    '.dsp': 'text/plain; charset=utf-8',
    '.lib': 'text/plain; charset=utf-8'
};

/**
 * @typedef {object} Peer
 * @property {http.ServerResponse | null} stream
 * @property {{ data: string, at: number }[]} queue
 */
/**
 * @typedef {object} Room
 * @property {string} token
 * @property {string | null} host
 * @property {Map<string, Peer>} peers
 * @property {WebSocketPeer | null} relayHost
 * @property {Map<string, WebSocketPeer>} relayRemotes
 */

/**
 * @param {http.ServerResponse} res
 * @param {number} status
 * @param {string} [text]
 */
const reply = (res, status, text = '') => {
    res.writeHead(status, {
        'content-type': 'text/plain; charset=utf-8',
        'cache-control': 'no-store'
    });
    res.end(text);
};

/**
 * @param {http.IncomingMessage} req
 * @returns {Promise<any>}
 */
const readJSON = (req) =>
    new Promise((resolve, reject) => {
        /** @type {Buffer[]} */
        const chunks = [];
        let size = 0;
        req.on('data', (/** @type {Buffer} */ chunk) => {
            size += chunk.length;
            // Read on and drop the rest, so the client gets the 413 rather
            // than a reset connection
            if (size > MAX_BODY)
                reject(Object.assign(new Error('too large'), { status: 413 }));
            else chunks.push(chunk);
        });
        req.on('end', () => {
            try {
                resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
            } catch {
                reject(Object.assign(new Error('not JSON'), { status: 400 }));
            }
        });
        req.on('error', reject);
    });

const WEBSOCKET_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_FRAME = 1024 * 1024;

/**
 * @typedef {object} WebSocketPeer
 * @property {(text: string) => void} send
 * @property {() => void} close
 * @property {((text: string) => void) | null} onmessage
 * @property {(() => void) | null} onclose
 */

/**
 * The server end of a WebSocket (RFC 6455), text messages only: enough for
 * the relay, without a dependency. Fragmented messages are reassembled,
 * pings answered, anything over `MAX_FRAME` closes the connection.
 *
 * @param {http.IncomingMessage} req
 * @param {import('stream').Duplex} socket
 * @returns {WebSocketPeer | null} null if the request is no WebSocket upgrade
 */
const acceptWebSocket = (req, socket) => {
    const key = req.headers['sec-websocket-key'];
    if (
        typeof key !== 'string' ||
        (req.headers.upgrade ?? '').toLowerCase() !== 'websocket'
    )
        return null;
    const accept = createHash('sha1')
        .update(key + WEBSOCKET_GUID)
        .digest('base64');
    socket.write(
        'HTTP/1.1 101 Switching Protocols\r\n' +
            'Upgrade: websocket\r\nConnection: Upgrade\r\n' +
            `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
    );
    let closed = false;
    /** @type {WebSocketPeer} */
    const peer = {
        onmessage: null,
        onclose: null,
        send(text) {
            if (!closed) socket.write(frame(0x1, Buffer.from(text, 'utf8')));
        },
        close() {
            if (closed) return;
            closed = true;
            socket.end(frame(0x8, Buffer.alloc(0)));
            peer.onclose?.();
        }
    };
    /**
     * @param {number} opcode
     * @param {Buffer} payload
     */
    const frame = (opcode, payload) => {
        const length = payload.length;
        const head =
            length < 126
                ? Buffer.from([0x80 | opcode, length])
                : length < 65536
                  ? Buffer.from([0x80 | opcode, 126, length >> 8, length & 255])
                  : Buffer.concat([
                        Buffer.from([0x80 | opcode, 127]),
                        (() => {
                            const b = Buffer.alloc(8);
                            b.writeBigUInt64BE(BigInt(length));
                            return b;
                        })()
                    ]);
        return Buffer.concat([head, payload]);
    };
    let buffer = Buffer.alloc(0);
    /** @type {Buffer[]} */
    let fragments = [];
    socket.on('data', (/** @type {Buffer} */ chunk) => {
        buffer = Buffer.concat([buffer, chunk]);
        for (;;) {
            if (buffer.length < 2) return;
            const fin = (buffer[0] & 0x80) !== 0;
            const opcode = buffer[0] & 0x0f;
            const masked = (buffer[1] & 0x80) !== 0;
            let length = buffer[1] & 0x7f;
            let offset = 2;
            if (length === 126) {
                if (buffer.length < 4) return;
                length = buffer.readUInt16BE(2);
                offset = 4;
            } else if (length === 127) {
                if (buffer.length < 10) return;
                const big = buffer.readBigUInt64BE(2);
                length = big > BigInt(MAX_FRAME) ? MAX_FRAME + 1 : Number(big);
                offset = 10;
            }
            // A client must mask what it sends (RFC 6455, 5.1)
            if (!masked || length > MAX_FRAME) return peer.close();
            if (buffer.length < offset + 4 + length) return;
            const mask = buffer.subarray(offset, offset + 4);
            const payload = Buffer.from(
                buffer.subarray(offset + 4, offset + 4 + length)
            );
            for (let i = 0; i < payload.length; i += 1)
                payload[i] ^= mask[i & 3];
            buffer = buffer.subarray(offset + 4 + length);
            if (opcode === 0x8) return peer.close();
            if (opcode === 0x9) {
                if (!closed) socket.write(frame(0xa, payload));
                continue;
            }
            if (opcode === 0xa) continue;
            if (opcode === 0x1 || opcode === 0x0) {
                fragments.push(payload);
                if (!fin) continue;
                const text = Buffer.concat(fragments).toString('utf8');
                fragments = [];
                peer.onmessage?.(text);
                continue;
            }
            // Binary or unknown: not ours
            return peer.close();
        }
    });
    socket.on('close', () => {
        if (closed) return;
        closed = true;
        peer.onclose?.();
    });
    socket.on('error', () => socket.destroy());
    return peer;
};

/**
 * Create the server; call `listen` on it.
 *
 * @param {{ root: string, cert?: string | Buffer, key?: string | Buffer, allowOrigins?: string[] }} options
 *   `root` is the directory served; with `cert` and `key` (PEM), HTTPS;
 *   `allowOrigins`, the origins of pages served elsewhere that may use the
 *   signaling and the relay (`https://example.org`, no path).
 * @returns {http.Server | https.Server}
 */
export const createFaustRemoteServer = ({
    root,
    cert,
    key,
    allowOrigins = []
}) => {
    const base = path.resolve(root);
    const scheme = cert && key ? 'https' : 'http';

    /**
     * Whether a request may use the signaling or the relay, and the origin
     * to name in CORS headers if it comes from another one.
     *
     * @param {http.IncomingMessage} req
     * @returns {{ allowed: boolean, cors: string | null }}
     */
    const checkOrigin = (req) => {
        const origin = req.headers.origin;
        if (origin === undefined) return { allowed: true, cors: null };
        if (origin === `${scheme}://${req.headers.host}`)
            return { allowed: true, cors: null };
        if (allowOrigins.includes(origin))
            return { allowed: true, cors: origin };
        return { allowed: false, cors: null };
    };
    /** @type {Map<string, Room>} */
    const rooms = new Map();

    /**
     * @param {Room} room
     * @param {string} id
     * @returns {Peer}
     */
    const peerOf = (room, id) => {
        let peer = room.peers.get(id);
        if (!peer) {
            peer = { stream: null, queue: [] };
            room.peers.set(id, peer);
        }
        return peer;
    };

    /**
     * @param {Room} room
     * @param {string} id
     * @param {object} message
     */
    const deliver = (room, id, message) => {
        const peer = peerOf(room, id);
        const data = JSON.stringify(message);
        if (peer.stream) {
            peer.stream.write(`data: ${data}\n\n`);
            return;
        }
        const now = Date.now();
        peer.queue = peer.queue.filter((item) => now - item.at < QUEUE_TTL);
        peer.queue.push({ data, at: now });
        if (peer.queue.length > MAX_QUEUE) peer.queue.shift();
    };

    /**
     * @param {http.IncomingMessage} req
     * @param {http.ServerResponse} res
     * @param {string} roomName
     * @param {string} action
     * @param {string | undefined} id
     */
    const signal = async (req, res, roomName, action, id) => {
        const token = req.headers['x-faust-token'];
        if (typeof token !== 'string' || token === '')
            return reply(res, 401, 'token required');
        let room = rooms.get(roomName);

        if (req.method === 'POST' && action === 'host' && id === undefined) {
            const body = await readJSON(req);
            if (typeof body?.id !== 'string' || body.id === '')
                return reply(res, 400, 'id required');
            if (room && room.token !== token)
                return reply(res, 403, 'room taken');
            if (!room) {
                room = {
                    token,
                    host: null,
                    peers: new Map(),
                    relayHost: null,
                    relayRemotes: new Map()
                };
                rooms.set(roomName, room);
            }
            room.host = body.id;
            return reply(res, 204);
        }
        if (!room) return reply(res, 404, 'no such room');
        if (room.token !== token) return reply(res, 403, 'wrong token');

        if (req.method === 'GET' && action === 'events' && id) {
            const peer = peerOf(room, id);
            peer.stream?.end();
            res.writeHead(200, {
                'content-type': 'text/event-stream',
                'cache-control': 'no-store',
                connection: 'keep-alive',
                // A reverse proxy holding the stream back would deliver
                // nothing until it closes
                'x-accel-buffering': 'no'
            });
            res.write(': open\n\n');
            const now = Date.now();
            for (const item of peer.queue.splice(0)) {
                if (now - item.at < QUEUE_TTL)
                    res.write(`data: ${item.data}\n\n`);
            }
            peer.stream = res;
            const heartbeat = setInterval(
                () => res.write(': heartbeat\n\n'),
                HEARTBEAT
            );
            res.on('close', () => {
                clearInterval(heartbeat);
                if (peer.stream === res) peer.stream = null;
            });
            return;
        }
        if (req.method === 'POST' && action === 'send' && id === undefined) {
            const body = await readJSON(req);
            const message = body?.message;
            if (
                typeof body?.id !== 'string' ||
                typeof message !== 'object' ||
                message === null ||
                typeof message.type !== 'string' ||
                typeof message.peer !== 'string'
            )
                return reply(res, 400, 'malformed message');
            if (body.id === room.host) {
                deliver(room, message.peer, message);
            } else if (room.host) {
                deliver(room, room.host, { ...message, peer: body.id });
            } else return reply(res, 409, 'no host');
            return reply(res, 204);
        }
        return reply(res, 405, 'not allowed');
    };

    /**
     * @param {http.IncomingMessage} req
     * @param {http.ServerResponse} res
     * @param {string} pathname
     */
    const serveFile = (req, res, pathname) => {
        if (req.method !== 'GET' && req.method !== 'HEAD')
            return reply(res, 405, 'not allowed');
        let file = path.resolve(base, `.${pathname}`);
        if (file !== base && !file.startsWith(base + path.sep))
            return reply(res, 403, 'forbidden');
        try {
            if (fs.statSync(file).isDirectory())
                file = path.join(file, 'index.html');
            const data = fs.readFileSync(file);
            res.writeHead(200, {
                'content-type':
                    CONTENT_TYPES[path.extname(file).toLowerCase()] ??
                    'application/octet-stream',
                'cache-control': 'no-store'
            });
            res.end(req.method === 'HEAD' ? undefined : data);
        } catch {
            reply(res, 404, 'not found');
        }
    };

    /**
     * @param {http.IncomingMessage} req
     * @param {http.ServerResponse} res
     */
    const handle = (req, res) => {
        let pathname;
        try {
            pathname = decodeURIComponent(
                new URL(req.url ?? '/', 'http://localhost').pathname
            );
        } catch {
            return reply(res, 400, 'bad URL');
        }
        const match = pathname.match(
            /^\/signal\/([^/]+)\/(host|events|send)(?:\/([^/]+))?$/
        );
        if (!match) return serveFile(req, res, pathname);
        const { allowed, cors } = checkOrigin(req);
        if (!allowed) return reply(res, 403, 'origin not allowed');
        if (cors) {
            res.setHeader('access-control-allow-origin', cors);
            res.setHeader('vary', 'Origin');
            res.setHeader(
                'access-control-allow-headers',
                'content-type, x-faust-token'
            );
            res.setHeader('access-control-allow-methods', 'GET, POST');
            res.setHeader('access-control-max-age', '600');
        }
        // A preflight carries no token: answered on the origin alone
        if (req.method === 'OPTIONS') return reply(res, 204);
        signal(req, res, match[1], match[2], match[3]).catch((error) =>
            reply(res, error.status ?? 500, error.message)
        );
    };

    /**
     * The relay: authenticate the first message, then forward.
     *
     * @param {WebSocketPeer} ws
     * @param {string} roomName
     */
    const relay = (ws, roomName) => {
        /** @type {Room | null} */
        let room = null;
        let id = '';
        let role = '';
        const timeout = setTimeout(() => ws.close(), 10000);
        ws.onmessage = (text) => {
            if (room) return forward(text);
            clearTimeout(timeout);
            let hello;
            try {
                hello = JSON.parse(text);
            } catch {
                return ws.close();
            }
            const { token } = hello ?? {};
            id = hello?.id;
            role = hello?.role;
            if (typeof token !== 'string' || !token || typeof id !== 'string')
                return ws.close();
            if (!/^[\w-]{1,64}$/.test(id)) return ws.close();
            let candidate = rooms.get(roomName);
            if (role === 'host') {
                if (candidate && candidate.token !== token) return ws.close();
                if (!candidate) {
                    candidate = {
                        token,
                        host: null,
                        peers: new Map(),
                        relayHost: null,
                        relayRemotes: new Map()
                    };
                    rooms.set(roomName, candidate);
                }
                candidate.relayHost?.close();
                candidate.relayHost = ws;
            } else if (role === 'remote') {
                if (
                    !candidate ||
                    candidate.token !== token ||
                    !candidate.relayHost
                )
                    return ws.close();
                candidate.relayRemotes.get(id)?.close();
                candidate.relayRemotes.set(id, ws);
            } else return ws.close();
            room = candidate;
            ws.send('ok');
        };
        /** @param {string} text */
        const forward = (text) => {
            if (!room) return;
            if (role === 'remote') {
                room.relayHost?.send(`${id}\n${text}`);
                return;
            }
            const cut = text.indexOf('\n');
            if (cut <= 0) return;
            const target = room.relayRemotes.get(text.slice(0, cut));
            const payload = text.slice(cut + 1);
            if (!target) return;
            if (payload === '!') target.close();
            else target.send(payload);
        };
        ws.onclose = () => {
            clearTimeout(timeout);
            if (!room) return;
            if (role === 'remote') {
                if (room.relayRemotes.get(id) !== ws) return;
                room.relayRemotes.delete(id);
                room.relayHost?.send(`${id}\n!`);
            } else if (room.relayHost === ws) {
                room.relayHost = null;
                for (const remote of [...room.relayRemotes.values()])
                    remote.close();
                room.relayRemotes.clear();
            }
        };
    };

    const server =
        cert && key
            ? https.createServer({ cert, key }, handle)
            : http.createServer(handle);
    // Upgraded sockets leave the HTTP server's books: `close()` would wait
    // for them forever, so it closes them itself
    /** @type {Set<import('stream').Duplex>} */
    const upgraded = new Set();
    const closeServer = server.close.bind(server);
    server.close = (callback) => {
        for (const socket of upgraded) socket.destroy();
        return closeServer(callback);
    };
    server.on('upgrade', (req, socket) => {
        upgraded.add(socket);
        socket.on('close', () => upgraded.delete(socket));
        let match;
        try {
            match = new URL(req.url ?? '/', 'http://localhost').pathname.match(
                /^\/relay\/([^/]+)$/
            );
        } catch {
            match = null;
        }
        // CORS does not apply to a WebSocket: the origin is checked here
        if (match && !checkOrigin(req).allowed) {
            socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
            return;
        }
        const ws = match ? acceptWebSocket(req, socket) : null;
        if (!match || !ws) {
            socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
            return;
        }
        relay(ws, decodeURIComponent(match[1]));
    });
    return server;
};

export default createFaustRemoteServer;
