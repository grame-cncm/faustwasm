/**
 * The two logical channels of a remote session.
 *
 * `ctl` is reliable and ordered: the handshake, buttons, the last value of a
 * gesture, MIDI, parameter changes, pings. `stream` may drop and reorder:
 * slider values during a gesture, sensors, bargraphs -- values where the next
 * one replaces a lost one, and waiting for a retransmission would only delay
 * it.
 */
export type FaustRemoteChannel = 'ctl' | 'stream';

/**
 * What the protocol needs from a connection: send text on a channel, be told
 * of text arriving, and of the end.
 *
 * WebRTC is the transport the remote control is designed for, with one data
 * channel per logical channel. Anything that can carry two such channels can
 * stand in for it -- an in-memory pair for tests, a WebSocket relay where ICE
 * fails -- without the protocol knowing.
 */
export interface FaustRemoteTransport {
    send(channel: FaustRemoteChannel, message: string): void;
    /** Bytes queued and not yet sent on a channel. */
    bufferedAmount(channel: FaustRemoteChannel): number;
    /** Largest message, in bytes, a single `send` may carry. */
    readonly maxMessageSize: number;
    onmessage: ((channel: FaustRemoteChannel, message: string) => void) | null;
    onclose: ((reason: string) => void) | null;
    /** Close both ends. `onclose` is called on both, once. */
    close(reason?: string): void;
}

/** The size every WebRTC implementation accepts in one message. */
export const SAFE_MESSAGE_SIZE = 16 * 1024;

export interface FaustLoopbackOptions {
    /** Defaults to `SAFE_MESSAGE_SIZE`. */
    maxMessageSize?: number;
    /**
     * Called for every message before delivery; return false to drop it. Lets
     * a test lose `stream` messages the way a radio link does.
     */
    deliver?: (
        channel: FaustRemoteChannel,
        message: string,
        from: 0 | 1
    ) => boolean;
}

/**
 * Two transports joined in memory, each delivering to the other.
 *
 * Delivery is asynchronous, as on a real connection: a message sent now
 * arrives in a later microtask, never inside the `send` that sent it, so a
 * handler cannot be re-entered by its own reply. As with a data channel, what
 * was sent before `close()` still arrives, before `onclose`.
 */
export const createLoopbackTransports = (
    options: FaustLoopbackOptions = {}
): [FaustRemoteTransport, FaustRemoteTransport] => {
    const maxMessageSize = options.maxMessageSize ?? SAFE_MESSAGE_SIZE;
    let closed = false;
    const ends: FaustRemoteTransport[] = [];
    const make = (self: 0 | 1): FaustRemoteTransport => ({
        maxMessageSize,
        onmessage: null,
        onclose: null,
        bufferedAmount: () => 0,
        send(channel, message) {
            if (closed) return;
            if (new TextEncoder().encode(message).length > maxMessageSize) {
                throw new RangeError(
                    `message of ${message.length} characters exceeds ${maxMessageSize} bytes`
                );
            }
            if (options.deliver && !options.deliver(channel, message, self))
                return;
            queueMicrotask(() => ends[1 - self].onmessage?.(channel, message));
        },
        close(reason = 'closed') {
            if (closed) return;
            closed = true;
            queueMicrotask(() => ends.forEach((end) => end.onclose?.(reason)));
        }
    });
    ends.push(make(0), make(1));
    return [ends[0], ends[1]];
};
