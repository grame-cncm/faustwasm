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
 * Messages for an id whose stream is not open yet are kept (the last 64, for a
 * minute), so a remote control may post its offer before its stream is up.
 * The server reads nothing in them but `peer`, and keeps nothing once they are
 * delivered.
 */
import { Buffer } from 'buffer';
import * as fs from 'fs';
import * as http from 'http';
import * as https from 'https';
import * as path from 'path';
import { clearInterval, setInterval } from 'timers';
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

/**
 * Create the server; call `listen` on it.
 *
 * @param {{ root: string, cert?: string | Buffer, key?: string | Buffer }} options
 *   `root` is the directory served; with `cert` and `key` (PEM), HTTPS.
 * @returns {http.Server | https.Server}
 */
export const createFaustRemoteServer = ({ root, cert, key }) => {
    const base = path.resolve(root);
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
                room = { token, host: null, peers: new Map() };
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
                connection: 'keep-alive'
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
        signal(req, res, match[1], match[2], match[3]).catch((error) =>
            reply(res, error.status ?? 500, error.message)
        );
    };

    return cert && key
        ? https.createServer({ cert, key }, handle)
        : http.createServer(handle);
};

export default createFaustRemoteServer;
