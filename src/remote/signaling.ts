import { randomId } from './protocol';

/**
 * What two peers exchange before a WebRTC connection exists: the offer, the
 * answer and the ICE candidates.
 *
 * `peer` is always the remote control's id: it names the conversation, on
 * both sides. A host talks to many remote controls through one signaling
 * channel and tells them apart by it; a remote control only ever hears from
 * its host.
 */
export type FaustSignalMessage =
    | { type: 'offer'; peer: string; sdp: string }
    | { type: 'answer'; peer: string; sdp: string }
    | {
          type: 'candidate';
          peer: string;
          candidate: RTCIceCandidateInit | null;
      }
    | { type: 'bye'; peer: string };

/**
 * A channel to exchange signaling messages, whatever carries them: the HTTP
 * server of `scripts/faust-remote-server.js`, an application's own server,
 * or memory.
 */
export interface FaustSignaling {
    /** This end's id; a remote control's is its `peer`. */
    readonly id: string;
    send(message: FaustSignalMessage): void;
    onmessage: ((message: FaustSignalMessage) => void) | null;
    /**
     * A message could not be delivered, or the channel failed: set by the
     * remote control while it waits for the host's answer, so that a server
     * saying there is no WebRTC host (a host that only takes the relay) does
     * not leave it waiting for its timeout. Optional for implementations.
     */
    onerror?: ((error: Error) => void) | null;
    close(): void;
}

const isSignalMessage = (x: unknown): x is FaustSignalMessage => {
    if (typeof x !== 'object' || x === null) return false;
    const m = x as Record<string, unknown>;
    if (typeof m.peer !== 'string') return false;
    switch (m.type) {
        case 'offer':
        case 'answer':
            return typeof m.sdp === 'string';
        case 'candidate':
            return (
                m.candidate === null ||
                (typeof m.candidate === 'object' && m.candidate !== undefined)
            );
        case 'bye':
            return true;
        default:
            return false;
    }
};

/**
 * Signaling in memory: one host end, and as many remote control ends as
 * `remote()` makes. For tests, and for a host and a remote control in the
 * same page.
 */
export const createLoopbackSignaling = () => {
    const remotes = new Map<string, FaustSignaling>();
    const host: FaustSignaling = {
        id: 'host',
        onmessage: null,
        send(message) {
            const remote = remotes.get(message.peer);
            queueMicrotask(() => remote?.onmessage?.(message));
        },
        close() {
            remotes.clear();
        }
    };
    const remote = (id = randomId(8)): FaustSignaling => {
        const end: FaustSignaling = {
            id,
            onmessage: null,
            send(message) {
                // As the HTTP server does: a remote control speaks for itself
                const own = { ...message, peer: id };
                queueMicrotask(() => host.onmessage?.(own));
            },
            close() {
                remotes.delete(id);
            }
        };
        remotes.set(id, end);
        return end;
    };
    return { host, remote };
};

export interface FaustHttpSignalingOptions {
    /** `host` registers the room; `remote` joins it. */
    role: 'host' | 'remote';
    /** Random by default. A host's id is secret: it reads the host's messages. */
    id?: string;
    /** Called when the server cannot be reached or refuses. */
    onerror?: (error: Error) => void;
    /** Milliseconds before reconnecting a dropped event stream. Default 1000. */
    retry?: number;
}

export type FaustHttpSignaling = FaustSignaling & {
    /** Resolves once the event stream is open (and, for a host, the room registered). */
    readonly ready: Promise<void>;
};

/**
 * The client of the signaling server in `scripts/faust-remote-server.js`.
 *
 * Messages are posted, one request each, in order; messages for this end come
 * as a server-sent event stream, read with `fetch` rather than `EventSource`
 * so that the token travels in a header and never in a URL.
 *
 * @param url - the server's origin, e.g. `location.origin`
 * @param room - the session, shared by the host and its remote controls
 * @param token - the session's secret, also checked by the host in `hello`
 */
export const createHttpSignaling = (
    url: string,
    room: string,
    token: string,
    options: FaustHttpSignalingOptions
): FaustHttpSignaling => {
    const id = options.id ?? randomId(16);
    const base = `${url.replace(/\/+$/, '')}/signal/${encodeURIComponent(room)}`;
    const retry = options.retry ?? 1000;
    const headers = {
        'content-type': 'application/json',
        'x-faust-token': token
    };
    const abort = new AbortController();
    let closed = false;
    // Posted one after the other: an offer must reach the host before the
    // candidates that follow it
    let queue: Promise<unknown> = Promise.resolve();
    const fail = (error: unknown) => {
        if (closed) return;
        const failure =
            error instanceof Error ? error : new Error(String(error));
        options.onerror?.(failure);
        signaling.onerror?.(failure);
    };

    const post = async (path: string, body: object) => {
        const response = await fetch(`${base}/${path}`, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
            signal: abort.signal
        });
        if (!response.ok)
            throw new Error(`signaling ${path}: HTTP ${response.status}`);
    };

    const signaling: FaustHttpSignaling = {
        id,
        onmessage: null,
        onerror: null,
        ready: Promise.resolve(),
        send(message) {
            if (closed) return;
            queue = queue.then(() => post('send', { id, message })).catch(fail);
        },
        close() {
            closed = true;
            abort.abort();
        }
    };

    /** Read the event stream until it ends; resolve once it is open. */
    const listen = (opened: () => void) =>
        (async () => {
            const response = await fetch(`${base}/events/${id}`, {
                headers,
                signal: abort.signal
            });
            if (!response.ok || !response.body)
                throw new Error(`signaling events: HTTP ${response.status}`);
            opened();
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            for (;;) {
                const { done, value } = await reader.read();
                if (done) return;
                buffer += decoder.decode(value, { stream: true });
                let end: number;
                while ((end = buffer.indexOf('\n\n')) !== -1) {
                    const event = buffer.slice(0, end);
                    buffer = buffer.slice(end + 2);
                    const data = event
                        .split('\n')
                        .filter((line) => line.startsWith('data:'))
                        .map((line) => line.slice(5).trimStart())
                        .join('\n');
                    if (!data) continue;
                    let message: unknown;
                    try {
                        message = JSON.parse(data);
                    } catch {
                        continue;
                    }
                    if (isSignalMessage(message))
                        signaling.onmessage?.(message);
                }
            }
        })();

    /** Keep the stream open: reconnect after it drops, until closed. */
    const stay = (opened: () => void) => {
        listen(opened)
            .catch(fail)
            .finally(() => {
                // The same `opened`: a stream that only opens on a retry
                // still has to resolve `ready`
                if (!closed) setTimeout(() => stay(opened), retry);
            });
    };

    (signaling as { ready: Promise<void> }).ready = (async () => {
        if (options.role === 'host') await post('host', { id });
        await new Promise<void>((resolve) => stay(resolve));
    })();
    signaling.ready.catch(fail);
    return signaling;
};
