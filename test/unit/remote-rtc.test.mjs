/**
 * Remote control sessions over WebRTC, as far as Node can take them.
 *
 * Node has no WebRTC, so the peer connections are the fakes of `fake-rtc.mjs`,
 * which keep the one rule that breaks real code most often: a candidate added
 * before the remote description is refused. What is checked is the work done
 * around the connection -- offering and answering through signaling, holding
 * candidates until they can be added, the two channels and their options,
 * giving up on a connection that does not open, and cleaning up after one
 * that goes away. The data channels themselves, and ICE, are the browser's;
 * `test/web/remote/` exercises those.
 */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
    FaustRemoteDsp,
    FaustRemoteHost,
    createLoopbackSignaling
} from '../../dist/remote/index.js';
import { FakeRTC, FakeRTCPeerConnection, fakeNetwork } from './fake-rtc.mjs';
import { GATE, FakeNode } from './remote-fakes.mjs';

const settle = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

const toClose = [];
beforeEach(() => FakeRTCPeerConnection.reset());
afterEach(() => {
    for (const thing of toClose.splice(0)) thing.close();
});

const RTC = { RTCPeerConnection: FakeRTC };

/** A host on a fake node, answering through in-memory signaling. */
const listening = (rtc = RTC) => {
    const node = new FakeNode();
    const host = new FaustRemoteHost(node, { outputRate: 1e6 });
    toClose.push(host);
    const signaling = createLoopbackSignaling();
    host.listen(signaling.host, rtc);
    return { node, host, signaling };
};

/** @param {ReturnType<typeof createLoopbackSignaling>} signaling */
const call = async (signaling, options = {}, rtc = RTC) => {
    const dsp = await FaustRemoteDsp.connectRTC(
        signaling.remote(),
        { pingInterval: 0, gestureEnd: 0, ...options },
        rtc
    );
    toClose.push(dsp);
    return dsp;
};

test('a remote control connects over WebRTC and drives the node', async () => {
    const { node, host, signaling } = listening();
    const dsp = await call(signaling, { id: 'phone' });
    assert.equal(dsp.state, 'open');
    assert.deepEqual(host.clients.map((client) => client.id), ['phone']);

    dsp.setParamValue(GATE, 1);
    await settle();
    assert.deepEqual(node.writesTo(GATE), [1]);
    // Candidates came early on both sides, and every one of them waited
    assert.equal(FakeRTCPeerConnection.refused, 0);
});

test('a remote control sends no candidate before its offer', async () => {
    const { signaling } = listening();
    // Every message the host hears, in order
    const heard = [];
    const answering = signaling.host.onmessage;
    signaling.host.onmessage = (message) => {
        heard.push(message.type);
        answering?.(message);
    };
    await call(signaling);
    assert.equal(heard[0], 'offer', `heard ${heard}`);
});

test('the session has a reliable channel and one that may drop', async () => {
    const { signaling } = listening();
    await call(signaling);
    for (const pc of FakeRTCPeerConnection.all) {
        const ctl = pc.channels.get(0);
        const stream = pc.channels.get(1);
        assert.equal(ctl.ordered, true);
        assert.equal(ctl.maxRetransmits, null);
        assert.equal(stream.ordered, false);
        assert.equal(stream.maxRetransmits, 0);
        assert.equal(ctl.negotiated && stream.negotiated, true);
    }
});

test('several remote controls connect to one host', async () => {
    const { host, signaling } = listening();
    await Promise.all([
        call(signaling, { id: 'a' }),
        call(signaling, { id: 'b' }),
        call(signaling, { id: 'c' })
    ]);
    assert.deepEqual(
        host.clients.map((client) => client.id).sort(),
        ['a', 'b', 'c']
    );
});

test('a connection that does not open in time is given up on both sides', async () => {
    fakeNetwork.connect = false;
    const { signaling } = listening({ ...RTC, timeout: 100 });
    await assert.rejects(
        FaustRemoteDsp.connectRTC(signaling.remote(), {}, { ...RTC, timeout: 100 }),
        /did not open in time/
    );
    await settle(150);
    assert.equal(FakeRTCPeerConnection.all.length, 2);
    for (const pc of FakeRTCPeerConnection.all)
        assert.equal(pc.connectionState, 'closed', `connection ${pc.uid}`);
});

test('a lost connection releases what the remote control held', async () => {
    const { node, host, signaling } = listening();
    const dsp = await call(signaling);
    dsp.setParamValue(GATE, 1);
    await settle();
    // The phone's side of the connection goes away
    FakeRTCPeerConnection.all[0].close();
    await settle();
    assert.deepEqual(node.writesTo(GATE), [1, 0]);
    assert.deepEqual(host.clients, []);
    assert.equal(dsp.state, 'closed');
});

test('closing the host drops the connections still being established', async () => {
    fakeNetwork.connect = false;
    const { host, signaling } = listening();
    const pending = FaustRemoteDsp.connectRTC(signaling.remote(), {}, {
        ...RTC,
        timeout: 200
    });
    pending.catch(() => {});
    await settle(20);
    assert.equal(FakeRTCPeerConnection.all.length, 2, 'offer answered');
    host.close();
    assert.equal(FakeRTCPeerConnection.all[1].connectionState, 'closed');
    await assert.rejects(pending);
});

test('without WebRTC, connecting fails plainly', async () => {
    const signaling = createLoopbackSignaling();
    await assert.rejects(
        FaustRemoteDsp.connectRTC(signaling.remote(), {}, {}),
        /WebRTC is not available/
    );
});
