/**
 * WebRTC peer connections made of ordinary objects, for Node, which has none.
 *
 * Two connections find each other through the descriptions they exchange
 * (the "SDP" is just the other side's number), and open once both have set
 * both descriptions and each has added at least one of the other's
 * candidates -- the order a browser imposes, strictly: `addIceCandidate`
 * before `setRemoteDescription` throws, as it does in a browser, and is
 * counted in `FakeRTCPeerConnection.refused` so a test can require that it
 * never happened. `setRemoteDescription` takes a few ticks, so candidates
 * really do arrive while it is pending.
 *
 * Negotiated data channels are paired by id. A channel delivers in a later
 * microtask, keeps order, never drops, and closing one closes its peer: what
 * a connection that goes away looks like from the other end.
 */

/** Set `connect` to false and no connection opens: ICE that never succeeds. */
export const fakeNetwork = { connect: true };

class FakeDataChannel extends EventTarget {
    constructor(label, init) {
        super();
        this.label = label;
        this.id = init.id;
        this.negotiated = !!init.negotiated;
        this.ordered = init.ordered ?? true;
        this.maxRetransmits = init.maxRetransmits ?? null;
        this.readyState = 'connecting';
        this.bufferedAmount = 0;
        /** @type {FakeDataChannel | null} */
        this.peer = null;
    }
    send(data) {
        if (this.readyState !== 'open') throw new Error('InvalidStateError');
        const peer = this.peer;
        queueMicrotask(() => {
            if (peer?.readyState === 'open')
                peer.dispatchEvent(new MessageEvent('message', { data }));
        });
    }
    open() {
        this.readyState = 'open';
        this.dispatchEvent(new Event('open'));
    }
    close() {
        if (this.readyState === 'closed') return;
        this.readyState = 'closed';
        queueMicrotask(() => this.dispatchEvent(new Event('close')));
        this.peer?.close();
    }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

export class FakeRTCPeerConnection extends EventTarget {
    /** Every connection made, in order. */
    static all = [];
    /** Calls to `addIceCandidate` refused for want of a remote description. */
    static refused = 0;

    static reset() {
        FakeRTCPeerConnection.all = [];
        FakeRTCPeerConnection.refused = 0;
        fakeNetwork.connect = true;
    }

    constructor(config) {
        super();
        this.config = config;
        this.uid = FakeRTCPeerConnection.all.length;
        FakeRTCPeerConnection.all.push(this);
        /** @type {Map<number, FakeDataChannel>} */
        this.channels = new Map();
        this.localDescription = null;
        this.remoteDescription = null;
        this.connectionState = 'new';
        this.sctp = { maxMessageSize: 262144 };
        /** @type {FakeRTCPeerConnection | null} */
        this.remote = null;
        this.candidatesIn = 0;
    }
    createDataChannel(label, init = {}) {
        if (!init.negotiated) throw new Error('only negotiated channels here');
        const channel = new FakeDataChannel(label, init);
        this.channels.set(init.id, channel);
        return channel;
    }
    async createOffer() {
        return { type: 'offer', sdp: `fake ${this.uid}` };
    }
    async createAnswer() {
        if (!this.remoteDescription) throw new Error('no offer to answer');
        return { type: 'answer', sdp: `fake ${this.uid}` };
    }
    async setLocalDescription(description) {
        await tick();
        this.localDescription = description;
        // Gathering: one candidate, then the end of candidates
        queueMicrotask(() => {
            if (this.connectionState === 'closed') return;
            const candidate = {
                candidate: `candidate ${this.uid}`,
                toJSON: () => ({ candidate: `candidate ${this.uid}`, sdpMid: '0' })
            };
            this.dispatchEvent(Object.assign(new Event('icecandidate'), { candidate }));
            this.dispatchEvent(Object.assign(new Event('icecandidate'), { candidate: null }));
        });
    }
    async setRemoteDescription(description) {
        await tick();
        await tick();
        this.remoteDescription = description;
        this.remote = FakeRTCPeerConnection.all[Number(description.sdp.split(' ')[1])];
        this.maybeConnect();
    }
    async addIceCandidate(candidate) {
        if (!this.remoteDescription) {
            FakeRTCPeerConnection.refused += 1;
            throw new Error('InvalidStateError: no remote description');
        }
        this.candidatesIn += 1;
        this.maybeConnect();
    }
    maybeConnect() {
        const a = this;
        const b = this.remote;
        if (!fakeNetwork.connect || !b || b.remote !== a) return;
        const ready = (pc) =>
            pc.localDescription && pc.remoteDescription && pc.candidatesIn > 0;
        if (!ready(a) || !ready(b) || a.connectionState !== 'new') return;
        for (const pc of [a, b]) {
            pc.connectionState = 'connected';
            pc.dispatchEvent(new Event('connectionstatechange'));
        }
        for (const [id, channel] of a.channels) {
            const other = b.channels.get(id);
            if (!other) continue;
            channel.peer = other;
            other.peer = channel;
            channel.open();
            other.open();
        }
    }
    /** As in a browser, closing fires no event here; the peer sees its channels close. */
    close() {
        if (this.connectionState === 'closed') return;
        this.connectionState = 'closed';
        for (const channel of this.channels.values()) channel.close();
    }
}

/** For an option typed `typeof RTCPeerConnection`. */
export const FakeRTC = /** @type {any} */ (FakeRTCPeerConnection);
