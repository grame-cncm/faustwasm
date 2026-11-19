import type { FaustSignalMessage, FaustSignaling } from './signaling';
import {
    SAFE_MESSAGE_SIZE,
    type FaustRemoteChannel,
    type FaustRemoteTransport
} from './transport';

export interface FaustRTCOptions {
    /** ICE servers and the like. A local network needs none. */
    rtc?: RTCConfiguration;
    /** The implementation to use; `globalThis.RTCPeerConnection` by default. */
    RTCPeerConnection?: typeof RTCPeerConnection;
    /** Milliseconds for the connection to open. Default 15000. */
    timeout?: number;
}

/** Larger than any message the protocol sends; Firefox reports Infinity. */
const MAX_MESSAGE_SIZE = 256 * 1024;

const DEFAULT_TIMEOUT = 15000;

const peerConnection = (options: FaustRTCOptions) => {
    const PeerConnection =
        options.RTCPeerConnection ?? globalThis.RTCPeerConnection;
    if (!PeerConnection) throw new Error('WebRTC is not available here');
    return new PeerConnection(options.rtc);
};

/**
 * Open the two data channels of a remote session on a peer connection, and
 * resolve with a transport once both are open.
 *
 * The channels are negotiated (fixed ids, created by both peers), so they need
 * no in-band handshake and are usable the moment the connection is. The
 * offering side has to call this before `createOffer`, so that the offer
 * carries a data section; the answering side, before `createAnswer`.
 *
 * The transport closes when either channel does, or when the connection fails;
 * closing the transport closes the connection.
 */
export const createRTCTransport = (
    pc: RTCPeerConnection
): Promise<FaustRemoteTransport> => {
    const channels: Record<FaustRemoteChannel, RTCDataChannel> = {
        ctl: pc.createDataChannel('faust-ctl', {
            negotiated: true,
            id: 0,
            ordered: true
        }),
        stream: pc.createDataChannel('faust-stream', {
            negotiated: true,
            id: 1,
            ordered: false,
            maxRetransmits: 0
        })
    };
    let closed = false;
    const transport: FaustRemoteTransport = {
        get maxMessageSize() {
            const size = pc.sctp?.maxMessageSize;
            return size && size > 0
                ? Math.min(size, MAX_MESSAGE_SIZE)
                : SAFE_MESSAGE_SIZE;
        },
        onmessage: null,
        onclose: null,
        bufferedAmount: (channel) => channels[channel].bufferedAmount,
        send(channel, message) {
            const dc = channels[channel];
            if (dc.readyState === 'open') dc.send(message);
        },
        close(reason = 'closed') {
            end(reason);
        }
    };
    const end = (reason: string) => {
        if (closed) return;
        closed = true;
        for (const dc of Object.values(channels)) dc.close();
        pc.close();
        queueMicrotask(() => transport.onclose?.(reason));
    };
    for (const [name, dc] of Object.entries(channels) as [
        FaustRemoteChannel,
        RTCDataChannel
    ][]) {
        dc.addEventListener('message', (event) => {
            const data = (event as MessageEvent).data;
            if (typeof data === 'string') transport.onmessage?.(name, data);
        });
        dc.addEventListener('close', () => end(`${name} channel closed`));
    }
    return new Promise((resolve, reject) => {
        const check = () => {
            if (Object.values(channels).every((dc) => dc.readyState === 'open'))
                resolve(transport);
        };
        for (const dc of Object.values(channels))
            dc.addEventListener('open', check);
        pc.addEventListener('connectionstatechange', () => {
            const state = pc.connectionState;
            if (state === 'failed' || state === 'closed') {
                reject(new Error(`connection ${state}`));
                end(`connection ${state}`);
            }
        });
        check();
    });
};

const candidateJSON = (event: Event) => {
    const { candidate } = event as RTCPeerConnectionIceEvent;
    return candidate ? candidate.toJSON() : null;
};

/**
 * Send this side's candidates to the peer, but none before the description
 * they belong to: a peer that hears of a candidate before the offer has
 * nothing to add it to.
 */
const sendCandidates = (
    pc: RTCPeerConnection,
    signaling: FaustSignaling,
    peer: string
) => {
    let held: (RTCIceCandidateInit | null)[] | null = [];
    const send = (candidate: RTCIceCandidateInit | null) =>
        signaling.send({ type: 'candidate', peer, candidate });
    pc.addEventListener('icecandidate', (event) => {
        const candidate = candidateJSON(event);
        if (held) held.push(candidate);
        else send(candidate);
    });
    /** Call once the description is sent. */
    return () => {
        const pending = held ?? [];
        held = null;
        pending.forEach(send);
    };
};

/**
 * Candidates that arrive before the remote description is set have to wait
 * for it: `addIceCandidate` refuses them until then.
 */
class CandidateQueue {
    private pending: RTCIceCandidateInit[] = [];
    private ready = false;
    constructor(private readonly pc: RTCPeerConnection) {}
    add(candidate: RTCIceCandidateInit | null) {
        // A null candidate marks the end of gathering; nothing to add
        if (!candidate) return;
        if (this.ready) this.pc.addIceCandidate(candidate).catch(() => {});
        else this.pending.push(candidate);
    }
    flush() {
        this.ready = true;
        for (const candidate of this.pending.splice(0))
            this.pc.addIceCandidate(candidate).catch(() => {});
    }
}

/**
 * The remote control side: offer a connection to the host through a
 * signaling channel and resolve with the transport once it is open.
 */
export const callHost = async (
    signaling: FaustSignaling,
    options: FaustRTCOptions = {}
): Promise<FaustRemoteTransport> => {
    const pc = peerConnection(options);
    const peer = signaling.id;
    const candidates = new CandidateQueue(pc);
    const opened = createRTCTransport(pc);
    const failed = new Promise<never>((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new Error('the connection did not open in time'));
        }, options.timeout ?? DEFAULT_TIMEOUT);
        opened.then(
            () => clearTimeout(timer),
            () => clearTimeout(timer)
        );
        signaling.onmessage = (message: FaustSignalMessage) => {
            if (message.type === 'answer') {
                pc.setRemoteDescription({ type: 'answer', sdp: message.sdp })
                    .then(() => candidates.flush())
                    .catch(reject);
            } else if (message.type === 'candidate') {
                candidates.add(message.candidate);
            } else if (message.type === 'bye') {
                reject(new Error('the host refused the connection'));
            }
        };
    });
    // Settled after the race is decided, by a late 'bye' say: nobody awaits it
    failed.catch(() => {});
    const releaseCandidates = sendCandidates(pc, signaling, peer);
    try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        signaling.send({
            type: 'offer',
            peer,
            sdp: pc.localDescription?.sdp ?? offer.sdp ?? ''
        });
        releaseCandidates();
        return await Promise.race([opened, failed]);
    } catch (error) {
        pc.close();
        throw error;
    }
};

/**
 * The host side: answer every offer that arrives through a signaling channel,
 * and hand each connection that opens to `accept`.
 *
 * @returns a function that stops answering and closes the connections not
 * yet opened
 */
export const answerPeers = (
    signaling: FaustSignaling,
    accept: (transport: FaustRemoteTransport, peer: string) => void,
    options: FaustRTCOptions = {},
    onerror: (error: unknown) => void = () => {}
) => {
    /** Connections being established, by remote control id. */
    const pending = new Map<
        string,
        { pc: RTCPeerConnection; candidates: CandidateQueue }
    >();
    /**
     * Candidates from remote controls whose offer has not arrived yet: a
     * signaling channel need not keep the order of two messages. Bounded, as
     * anyone who reaches the channel can fill it.
     */
    const early = new Map<string, RTCIceCandidateInit[]>();
    const keepEarly = (peer: string, candidate: RTCIceCandidateInit | null) => {
        if (!candidate) return;
        if (!early.has(peer)) {
            if (early.size >= 64) early.delete(early.keys().next().value!);
            early.set(peer, []);
        }
        const list = early.get(peer)!;
        if (list.length < 32) list.push(candidate);
    };
    const forget = (peer: string, pc: RTCPeerConnection) => {
        if (pending.get(peer)?.pc === pc) pending.delete(peer);
    };
    const answer = async (peer: string, sdp: string) => {
        pending.get(peer)?.pc.close();
        const pc = peerConnection(options);
        const candidates = new CandidateQueue(pc);
        pending.set(peer, { pc, candidates });
        const opened = createRTCTransport(pc);
        const timer = setTimeout(() => {
            if (pending.get(peer)?.pc === pc) pc.close();
            forget(peer, pc);
        }, options.timeout ?? DEFAULT_TIMEOUT);
        opened.then(
            (transport) => {
                clearTimeout(timer);
                forget(peer, pc);
                accept(transport, peer);
            },
            () => {
                clearTimeout(timer);
                forget(peer, pc);
            }
        );
        const releaseCandidates = sendCandidates(pc, signaling, peer);
        // Candidates that came before their offer
        for (const candidate of early.get(peer) ?? [])
            candidates.add(candidate);
        early.delete(peer);
        await pc.setRemoteDescription({ type: 'offer', sdp });
        candidates.flush();
        const description = await pc.createAnswer();
        await pc.setLocalDescription(description);
        signaling.send({
            type: 'answer',
            peer,
            sdp: pc.localDescription?.sdp ?? description.sdp ?? ''
        });
        releaseCandidates();
    };
    signaling.onmessage = (message: FaustSignalMessage) => {
        switch (message.type) {
            case 'offer':
                answer(message.peer, message.sdp).catch((error) => {
                    const entry = pending.get(message.peer);
                    entry?.pc.close();
                    pending.delete(message.peer);
                    onerror(error);
                });
                return;
            case 'candidate': {
                const entry = pending.get(message.peer);
                if (entry) entry.candidates.add(message.candidate);
                else keepEarly(message.peer, message.candidate);
                return;
            }
            case 'bye': {
                pending.get(message.peer)?.pc.close();
                pending.delete(message.peer);
                early.delete(message.peer);
                return;
            }
        }
    };
    return () => {
        signaling.onmessage = null;
        for (const { pc } of pending.values()) pc.close();
        pending.clear();
        early.clear();
    };
};
