import { randomId } from './protocol';
import type { FaustRemoteChannel, FaustRemoteTransport } from './transport';

/**
 * Transports through the WebSocket relay of `scripts/faust-remote-server.js`,
 * for networks where WebRTC does not connect (multicast filtered, symmetric
 * NAT and no TURN server).
 *
 * The price: every message goes through the server, and over TCP, so a lost
 * packet holds back the ones behind it, on both channels. `stream` is still
 * marked as such, and the remote control and host keep treating it as lossy;
 * it just never loses anything here.
 *
 * On the wire, each message is its channel's letter (`c` or `s`) followed by
 * the message; the server adds, and the host's end reads, the remote
 * control's id and a newline in front.
 */

export interface FaustRelayOptions {
    /** The implementation to use; `globalThis.WebSocket` by default. */
    WebSocket?: typeof WebSocket;
    /** Milliseconds for the relay to accept. Default 10000. */
    timeout?: number;
    /** Host side: milliseconds before connecting again to a relay that dropped or refused. Default 1000. */
    retry?: number;
}

/** What the relay's WebSocket messages may carry; the protocol needs far less. */
const RELAY_MESSAGE_SIZE = 512 * 1024;

const letter = (channel: FaustRemoteChannel) => (channel === 'ctl' ? 'c' : 's');
const channelOf = (letter: string): FaustRemoteChannel | null =>
    letter === 'c' ? 'ctl' : letter === 's' ? 'stream' : null;

/** The relay's URL for a room, from the server's http(s) origin. */
const relayURL = (url: string, room: string) =>
    `${url.replace(/\/+$/, '').replace(/^http/, 'ws')}/relay/${encodeURIComponent(room)}`;

/** Open a WebSocket to the relay and authenticate; resolve once accepted. */
const openRelay = (
    url: string,
    room: string,
    hello: { token: string; role: 'host' | 'remote'; id: string },
    options: FaustRelayOptions
) =>
    new Promise<WebSocket>((resolve, reject) => {
        const Socket = options.WebSocket ?? globalThis.WebSocket;
        if (!Socket)
            return reject(new Error('WebSocket is not available here'));
        const ws = new Socket(relayURL(url, room));
        const timer = setTimeout(() => {
            ws.close();
            reject(new Error('the relay did not answer in time'));
        }, options.timeout ?? 10000);
        const fail = () => {
            clearTimeout(timer);
            reject(new Error('the relay refused the connection'));
        };
        ws.addEventListener('open', () => ws.send(JSON.stringify(hello)));
        ws.addEventListener('close', fail);
        ws.addEventListener('message', function first(event) {
            ws.removeEventListener('message', first);
            ws.removeEventListener('close', fail);
            clearTimeout(timer);
            if (event.data === 'ok') resolve(ws);
            else {
                ws.close();
                reject(new Error('the relay refused the connection'));
            }
        });
    });

/**
 * The remote control side: a transport to the host through the relay.
 *
 * @param url - the server's origin, e.g. `location.origin`
 */
export const connectRelay = async (
    url: string,
    room: string,
    token: string,
    options: FaustRelayOptions = {}
): Promise<FaustRemoteTransport> => {
    const ws = await openRelay(
        url,
        room,
        { token, role: 'remote', id: randomId(8) },
        options
    );
    let closed = false;
    const transport: FaustRemoteTransport = {
        maxMessageSize: RELAY_MESSAGE_SIZE,
        onmessage: null,
        onclose: null,
        bufferedAmount: () => ws.bufferedAmount,
        send(channel, message) {
            if (!closed && ws.readyState === ws.OPEN)
                ws.send(letter(channel) + message);
        },
        close(reason = 'closed') {
            end(reason);
        }
    };
    const end = (reason: string) => {
        if (closed) return;
        closed = true;
        ws.close();
        queueMicrotask(() => transport.onclose?.(reason));
    };
    ws.addEventListener('message', (event) => {
        if (typeof event.data !== 'string') return;
        const channel = channelOf(event.data[0]);
        if (channel) transport.onmessage?.(channel, event.data.slice(1));
    });
    ws.addEventListener('close', () => end('relay closed'));
    return transport;
};

/**
 * The host side: register the room with the relay and hand a transport to
 * `accept` for each remote control that comes through it. Reconnects when
 * the relay connection drops, until stopped.
 *
 * @returns a function that stops listening and closes the relayed transports
 */
export const listenRelay = (
    url: string,
    room: string,
    token: string,
    accept: (transport: FaustRemoteTransport, peer: string) => void,
    options: FaustRelayOptions = {},
    onerror: (error: unknown) => void = () => {}
) => {
    let stopped = false;
    let ws: WebSocket | null = null;
    /** The next attempt, cancelled by a stop. */
    let retry: ReturnType<typeof setTimeout> | null = null;
    /** The relayed transports, by remote control id. */
    const peers = new Map<
        string,
        { transport: FaustRemoteTransport; end: (reason: string) => void }
    >();

    const peer = (id: string) => {
        let closed = false;
        const transport: FaustRemoteTransport = {
            maxMessageSize: RELAY_MESSAGE_SIZE,
            onmessage: null,
            onclose: null,
            bufferedAmount: () => ws?.bufferedAmount ?? 0,
            send(channel, message) {
                if (!closed && ws?.readyState === ws?.OPEN)
                    ws?.send(`${id}\n${letter(channel)}${message}`);
            },
            close(reason = 'closed') {
                if (!closed && ws?.readyState === ws?.OPEN)
                    ws?.send(`${id}\n!`);
                end(reason);
            }
        };
        const end = (reason: string) => {
            if (closed) return;
            closed = true;
            peers.delete(id);
            queueMicrotask(() => transport.onclose?.(reason));
        };
        peers.set(id, { transport, end });
        return transport;
    };

    const connect = async () => {
        try {
            const socket = await openRelay(
                url,
                room,
                { token, role: 'host', id: 'host' },
                options
            );
            if (stopped) return socket.close();
            ws = socket;
            socket.addEventListener('message', (event) => {
                if (typeof event.data !== 'string') return;
                const cut = event.data.indexOf('\n');
                if (cut <= 0) return;
                const id = event.data.slice(0, cut);
                const payload = event.data.slice(cut + 1);
                const known = peers.get(id);
                if (payload === '!') return known?.end('remote closed');
                const channel = channelOf(payload[0]);
                if (!channel) return;
                if (known) {
                    known.transport.onmessage?.(channel, payload.slice(1));
                } else {
                    const transport = peer(id);
                    accept(transport, id);
                    transport.onmessage?.(channel, payload.slice(1));
                }
            });
            socket.addEventListener('close', () => {
                for (const { end } of [...peers.values()]) end('relay closed');
                ws = null;
                if (!stopped)
                    retry = setTimeout(connect, options.retry ?? 1000);
            });
        } catch (error) {
            onerror(error);
            if (!stopped) retry = setTimeout(connect, options.retry ?? 1000);
        }
    };
    connect();

    return () => {
        stopped = true;
        if (retry) clearTimeout(retry);
        for (const { transport } of [...peers.values()])
            transport.close('stopped');
        ws?.close();
    };
};
