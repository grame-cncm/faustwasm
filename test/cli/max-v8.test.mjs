/**
 * assets/max/faust-remote-v8.js, the script of a Max `v8` object (built from
 * src/max/v8.ts), run in Node's `vm` with fakes of what Max gives it:
 * `jsarguments`, `outlet`, `post`, `patcher`, `File`, and `require('http')`
 * and `WebSocketServer`, Node's server under a WebSocket server of a few
 * lines. A real remote control connects through its relay, as a phone does.
 *
 * What only Max checks (its http module, its File, its WebSocket client) was
 * checked there: see section 20.8 of docs/remote-control.md.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as https from 'node:https';
import * as net from 'node:net';
import * as path from 'node:path';
import * as vm from 'node:vm';
import { ROOT, outDir, runCliOk } from './runner.mjs';
import { FaustRemoteDsp } from '../../dist/remote/index.js';

const SCRIPT = path.join(ROOT, 'assets', 'max', 'faust-remote-v8.js');
const DSP = path.join(ROOT, 'assets', 'max', 'faust-remote-demo.dsp');
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

const freePort = () =>
    new Promise((resolve) => {
        const server = net.createServer();
        server.listen(0, '127.0.0.1', () => {
            const { port } = /** @type {net.AddressInfo} */ (server.address());
            server.close(() => resolve(port));
        });
    });

const settle = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The server half of a WebSocket, text frames only: what `v8`'s
 * `WebSocketServer` gives `handleUpgrade`'s callback (`onmessage` with
 * `{ data }`, `onclose`, `send`, `close`).
 */
class FakeWebSocketServer {
    /** @type {Set<import('node:stream').Duplex>} */
    static sockets = new Set();
    handleUpgrade(
        /** @type {http.IncomingMessage} */ req,
        /** @type {import('node:stream').Duplex} */ socket,
        /** @type {Buffer} */ head,
        /** @type {(ws: any) => void} */ callback
    ) {
        FakeWebSocketServer.sockets.add(socket);
        const accept = createHash('sha1')
            .update(req.headers['sec-websocket-key'] + GUID)
            .digest('base64');
        socket.write(
            'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
                `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
        );
        let closed = false;
        const frame = (/** @type {number} */ opcode, /** @type {Buffer} */ payload) => {
            const n = payload.length;
            const head =
                n < 126 ? Buffer.from([0x80 | opcode, n]) : Buffer.from([0x80 | opcode, 126, n >> 8, n & 255]);
            return Buffer.concat([head, payload]);
        };
        const ws = {
            /** @type {((event: { data: string }) => void) | null} */
            onmessage: null,
            /** @type {(() => void) | null} */
            onclose: null,
            send(/** @type {string} */ text) {
                if (!closed) socket.write(frame(1, Buffer.from(text)));
            },
            close() {
                if (closed) return;
                closed = true;
                socket.end(frame(8, Buffer.alloc(0)));
                ws.onclose?.();
            }
        };
        let buffer = Buffer.from(head);
        socket.on('data', (/** @type {Buffer} */ chunk) => {
            buffer = Buffer.concat([buffer, chunk]);
            while (buffer.length >= 2) {
                const opcode = buffer[0] & 15;
                let length = buffer[1] & 127;
                let offset = 2;
                if (length === 126) {
                    if (buffer.length < 4) return;
                    length = buffer.readUInt16BE(2);
                    offset = 4;
                }
                if (buffer.length < offset + 4 + length) return;
                const mask = buffer.subarray(offset, offset + 4);
                const payload = Buffer.from(buffer.subarray(offset + 4, offset + 4 + length));
                for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
                buffer = buffer.subarray(offset + 4 + length);
                if (opcode === 8) return ws.close();
                if (opcode === 1) ws.onmessage?.({ data: payload.toString('utf8') });
            }
        });
        socket.on('close', () => {
            FakeWebSocketServer.sockets.delete(socket);
            if (closed) return;
            closed = true;
            ws.onclose?.();
        });
        socket.on('error', () => socket.destroy());
        callback(ws);
    }
}

/**
 * Max's `File`, on a folder standing for the home folder (`~/`). As in Max,
 * a file opened for writing in a folder that does not exist says it is
 * open, and writes nothing.
 */
const fakeFile = (/** @type {string} */ home) =>
    class File {
        constructor(/** @type {string} */ file, mode = 'read') {
            this.path = file.startsWith('~/') ? path.join(home, file.slice(2)) : file;
            this.mode = mode;
            this.position = 0;
            this.isopen = 0;
            this.eof = 0;
            /** @type {Buffer} */
            this.data = Buffer.alloc(0);
            this.text = '';
            if (mode === 'read') {
                try {
                    if (!fs.statSync(this.path).isFile()) return;
                    this.data = fs.readFileSync(this.path);
                    this.isopen = 1;
                    this.eof = this.data.length;
                } catch {
                    // Not there: not open
                }
            } else this.isopen = 1;
        }
        readbytes(/** @type {number} */ count) {
            const bytes = this.data.subarray(this.position, this.position + count);
            this.position += bytes.length;
            return Array.from(bytes);
        }
        readstring(/** @type {number} */ count) {
            return Buffer.from(this.readbytes(count)).toString('utf8');
        }
        writestring(/** @type {string} */ text) {
            this.text += text;
        }
        close() {
            if (this.mode !== 'write' || !this.isopen) return;
            this.isopen = 0;
            try {
                fs.writeFileSync(this.path, this.text);
            } catch {
                // No such folder: nothing written, as in Max
            }
        }
    };

/** The v8 script in a context of its own, in a patch saved in `dir`. */
const startV8 = async (
    /** @type {string} */ dir,
    /** @type {string[]} */ args,
    { home = dir, port = /** @type {number | undefined} */ (undefined) } = {}
) => {
    const listening = /** @type {number} */ (port ?? (await freePort()));
    /** @type {any[][]} */
    const out = [];
    /** @type {string[]} */
    const posts = [];
    /** @type {string[]} */
    const errors = [];
    /** @type {(() => void)[]} */
    const waiting = [];
    const context = {
        jsarguments: ['faust-remote-v8.js', 'port', String(listening), 'host', '127.0.0.1', ...args],
        patcher: { filepath: `Macintosh HD:${dir}/test.maxpat` },
        max: { os: 'macintosh' },
        // Copied: arrays of the script's realm are not this one's
        outlet: (/** @type {number} */ _n, /** @type {any[]} */ ...message) => {
            out.push(Array.from(message));
            for (const wake of waiting.splice(0)) wake();
        },
        post: (/** @type {any[]} */ ...message) => posts.push(message.join(' ')),
        error: (/** @type {any[]} */ ...message) => errors.push(message.join(' ')),
        require: (/** @type {string} */ name) => ({ http, https })[/** @type {'http' | 'https'} */ (name)],
        WebSocketServer: FakeWebSocketServer,
        WebSocket,
        File: fakeFile(home),
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval,
        queueMicrotask,
        TextEncoder,
        TextDecoder,
        console
    };
    vm.createContext(context);
    vm.runInContext(fs.readFileSync(SCRIPT, 'utf8'), context);
    const g = /** @type {any} */ (context);
    /** Wait for an outlet message that `match` accepts. */
    const outlet = (/** @type {(message: any[]) => boolean} */ match, timeout = 10000) =>
        new Promise((resolve, reject) => {
            const timer = setTimeout(
                () =>
                    reject(
                        new Error(
                            `no such outlet message; out: ${JSON.stringify(out)}\nposts: ${posts.join('\n')}\nerrors: ${errors.join('\n')}`
                        )
                    ),
                timeout
            );
            const check = () => {
                const found = out.find(match);
                if (found) {
                    clearTimeout(timer);
                    resolve(found);
                } else waiting.push(check);
            };
            check();
        });
    return {
        out,
        posts,
        errors,
        port: listening,
        outlet,
        /** Send a message as the patch would. */
        send: (/** @type {string} */ name, /** @type {any[]} */ ...message) => g[name](...message),
        /** Delete the object. */
        remove() {
            g.notifydeleted();
            for (const socket of FakeWebSocketServer.sockets) socket.destroy();
        }
    };
};

/** A phone, by the pairing link. */
const phoneFor = (/** @type {string} */ link) => {
    const url = new URL(link);
    const params = new URLSearchParams(url.hash.slice(1));
    return FaustRemoteDsp.connectRelay(url.origin, params.get('room') ?? '', {
        token: params.get('token') ?? '',
        id: 'phone',
        pingInterval: 0,
        gestureEnd: 0
    });
};

/** The `node.script`'s session file, for a root and port. */
const sessionFile = (/** @type {string} */ home, /** @type {string} */ root, /** @type {number} */ port) =>
    path.join(
        home,
        '.faust-remote',
        `max-${createHash('sha256').update(`${root}:${port}`).digest('hex').slice(0, 16)}.json`
    );

test('the v8 script serves the remote control and drives faustgen~ both ways', { timeout: 60000 }, async () => {
    const dir = outDir('max-v8');
    runCliOk('faust2wasm', [DSP, path.join(dir, 'app'), '-remote']);
    const json = fs.readFileSync(path.join(dir, 'app', 'dsp-meta.json'), 'utf8');
    const name = JSON.parse(json).name;
    const FREQ = `/${name}/freq`;
    const LEVEL = `/${name}/level`;
    fs.mkdirSync(path.join(dir, '.faust-remote'));
    const v8 = await startV8(dir, ['root', 'app']);
    try {
        await v8.outlet((m) => m[0] === 'getjson');
        v8.send('json', json);
        const [, link] = await v8.outlet((m) => m[0] === 'link');
        const url = new URL(link);
        const params = new URLSearchParams(url.hash.slice(1));
        assert.equal(url.origin, `http://127.0.0.1:${v8.port}`, 'no address given: the loopback');
        assert.ok(v8.posts.some((p) => p.includes('address <a.b.c.d>')), 'and a word about it');
        assert.match(params.get('token') ?? '', /^[0-9a-f]{32}$/);
        assert.match(params.get('room') ?? '', /^[0-9a-f]{12}$/);

        // The session, where the node.script keeps it for the same root and port
        const kept = JSON.parse(fs.readFileSync(sessionFile(dir, path.join(dir, 'app'), v8.port), 'utf8'));
        assert.deepEqual(kept, { room: params.get('room'), token: params.get('token') });

        // The PWA's files, and nothing outside the folder served
        const page = await fetch(`${url.origin}/remote/index.html`);
        assert.equal(page.status, 200);
        assert.match(page.headers.get('content-type') ?? '', /text\/html/);
        assert.equal((await fetch(`${url.origin}/remote/`)).status, 200, 'a folder: its index.html');
        assert.equal((await fetch(`${url.origin}/nothing.js`)).status, 404);
        // Sent as is: fetch would resolve the dots itself
        const escape = await new Promise((resolve) =>
            http.get({ host: '127.0.0.1', port: v8.port, path: '/remote/%2e%2e/%2e%2e/test.maxpat' }, (res) => {
                res.resume();
                resolve(res.statusCode);
            })
        );
        assert.equal(escape, 400);

        // Signaling: no WebRTC here, said at once to whoever has the token
        const signal = (/** @type {string} */ token, room = params.get('room')) =>
            fetch(`${url.origin}/signal/${room}/events/x`, { headers: token ? { 'x-faust-token': token } : {} });
        assert.equal((await signal(params.get('token') ?? '')).status, 409);
        assert.equal((await signal('wrong')).status, 403);
        assert.equal((await signal('')).status, 401);
        assert.equal((await signal(params.get('token') ?? '', 'other')).status, 404);

        const dsp = await phoneFor(link);
        try {
            assert.equal(dsp.getParamValue(FREQ), 440);
            await v8.outlet((m) => m[0] === 'clients' && m[1] === 1);
            dsp.setParamValue(FREQ, 660);
            await v8.outlet((m) => m[0] === 'param' && m[1] === FREQ && m[2] === 660);
            await v8.outlet((m) => m[0] === 'dump');
            /** @type {[string, number][]} */
            const meters = [];
            dsp.setOutputParamHandler((address, value) => meters.push([address, value]));
            v8.send('values', LEVEL, 0.5, FREQ, 330);
            await settle(300);
            assert.deepEqual(meters.at(-1), [LEVEL, 0.5]);
            assert.equal(dsp.getParamValue(FREQ), 330);
        } finally {
            dsp.close();
        }
        await v8.outlet((m) => m[0] === 'clients' && m[1] === 0);
    } finally {
        v8.remove();
    }
});

test('the v8 relay takes only the room’s remote controls', { timeout: 30000 }, async () => {
    const dir = outDir('max-v8-relay');
    runCliOk('faust2wasm', [DSP, path.join(dir, 'app'), '-remote']);
    const json = fs.readFileSync(path.join(dir, 'app', 'dsp-meta.json'), 'utf8');
    const v8 = await startV8(dir, ['root', 'app', 'room', 'r1', 'token', 'secret']);
    try {
        // Before the server is up, as faustgen~ may send it: kept
        v8.send('json', json);
        await v8.outlet((m) => m[0] === 'link');
        /** What the relay answers a first message, or `closed`. */
        const hello = (/** @type {object} */ message, room = 'r1') =>
            new Promise((resolve) => {
                const ws = new WebSocket(`ws://127.0.0.1:${v8.port}/relay/${room}`);
                ws.onopen = () => ws.send(JSON.stringify(message));
                ws.onmessage = (event) => {
                    resolve(event.data);
                    ws.close();
                };
                ws.onclose = () => resolve('closed');
            });
        assert.equal(await hello({ token: 'secret', role: 'remote', id: 'a' }), 'ok');
        assert.equal(await hello({ token: 'nope', role: 'remote', id: 'a' }), 'closed');
        assert.equal(await hello({ token: 'secret', role: 'host', id: 'h' }), 'closed', 'its host is in Max');
        assert.equal(await hello({ token: 'secret', role: 'remote', id: 'a' }, 'r2'), 'closed');
        assert.equal(await hello({ token: 'secret', role: 'remote', id: 'a b' }), 'closed');
    } finally {
        v8.remove();
    }
});

test('the v8 script keeps its session, or draws a new one', { timeout: 30000 }, async () => {
    const dir = outDir('max-v8-session');
    runCliOk('faust2wasm', [DSP, path.join(dir, 'app'), '-remote']);
    const json = fs.readFileSync(path.join(dir, 'app', 'dsp-meta.json'), 'utf8');
    const linkOf = async (/** @type {string} */ home, /** @type {number} */ port) => {
        const v8 = await startV8(dir, ['root', 'app', 'address', '10.0.0.5'], { home, port });
        try {
            v8.send('json', json);
            const [, link] = await v8.outlet((m) => m[0] === 'link');
            return { link: /** @type {string} */ (link), posts: v8.posts };
        } finally {
            v8.remove();
        }
    };
    const port = await freePort();
    const home = path.join(dir, 'home');
    fs.mkdirSync(path.join(home, '.faust-remote'), { recursive: true });
    const first = await linkOf(home, port);
    assert.ok(first.link.startsWith(`http://10.0.0.5:${port}/remote/index.html#room=`), 'the address given');
    assert.equal((await linkOf(home, port)).link, first.link, 'the same room and token');
    // Another home: drawn again, and different
    const elsewhere = path.join(dir, 'elsewhere');
    fs.mkdirSync(path.join(elsewhere, '.faust-remote'), { recursive: true });
    assert.notEqual((await linkOf(elsewhere, port)).link, first.link);
    // No ~/.faust-remote: a new session each time, and a word about it
    const bare = path.join(dir, 'bare');
    fs.mkdirSync(bare);
    const unkept = await linkOf(bare, port);
    assert.ok(unkept.posts.some((p) => p.includes('not kept')));
    assert.notEqual((await linkOf(bare, port)).link, unkept.link);
});

test('the v8 script with target params and a Faust interface', { timeout: 30000 }, async () => {
    const dir = outDir('max-v8-params');
    runCliOk('faust2wasm', [path.join(ROOT, 'assets', 'max', 'faust-remote-params.dsp'), path.join(dir, 'app'), '-remote']);
    const name = JSON.parse(fs.readFileSync(path.join(dir, 'app', 'dsp-meta.json'), 'utf8')).name;
    const v8 = await startV8(dir, ['root', 'app', 'target', 'params', 'ui', 'app/dsp-meta.json']);
    try {
        const [, link] = await v8.outlet((m) => m[0] === 'link');
        await v8.outlet((m) => m[0] === 'getjson');
        v8.send('json', '{"name":"other","ui":[]}');
        v8.send('pvalues', 'freq', 550);
        const dsp = await phoneFor(link);
        try {
            assert.equal(dsp.getParamValue(`/${name}/freq`), 550);
            dsp.setParamValue(`/${name}/gain`, 0.5);
            await v8.outlet((m) => m[0] === 'pset' && m[1] === 'gain' && m[2] === 0.5);
            assert.ok(!v8.out.some((m) => m[0] === 'dump'));
        } finally {
            dsp.close();
        }
    } finally {
        v8.remove();
    }
});

test('the v8 script says what is missing', async () => {
    const dir = outDir('max-v8-errors');
    const none = await startV8(dir, []);
    await settle(100);
    assert.match(none.errors.join('\n'), /give the folder to serve/);
    none.remove();
    const empty = await startV8(dir, ['root', 'nothing-here']);
    await settle(100);
    assert.match(empty.errors.join('\n'), /no remote\/index\.html/);
    empty.remove();
});
