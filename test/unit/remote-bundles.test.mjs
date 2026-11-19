/**
 * The remote control bundles, one per role.
 *
 * `dist/remote/client.js` is what a phone downloads, `host.js` what the page
 * running the DSP loads, and `index.js` has both for code that uses the API.
 * The point of the split is what each one leaves out, so that is checked on
 * the built files: the remote control carries no host code and no QR code
 * generator, the host no remote control code. And since each bundle has its
 * own copy of the shared code (protocol, transports), a host from `host.js`
 * and a remote control from `client.js` must still understand each other.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FREQ, GATE, FakeNode } from './remote-fakes.mjs';

const DIST = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../dist/remote'
);
const source = (name) => fs.readFileSync(path.join(DIST, name), 'utf8');

const client = await import('../../dist/remote/client.js');
const host = await import('../../dist/remote/host.js');
const full = await import('../../dist/remote/index.js');

test('the remote control bundle has the remote control, and nothing of the host', () => {
    for (const name of ['FaustRemoteDsp', 'FaustRemoteError', 'createHttpSignaling', 'connectRelay', 'callHost'])
        assert.equal(typeof client[name], 'function', name);
    for (const name of ['FaustRemoteHost', 'qrCodeSvg', 'listenRelay', 'answerPeers'])
        assert.equal(client[name], undefined, name);
    // Not merely unexported: absent
    const code = source('client.js');
    assert.doesNotMatch(code, /FaustRemoteHost|qrcodegen|Project Nayuki/);
});

test('the host bundle has the host, and nothing of the remote control', () => {
    for (const name of ['FaustRemoteHost', 'createHttpSignaling', 'listenRelay', 'answerPeers', 'qrCodeSvg'])
        assert.equal(typeof host[name], 'function', name);
    for (const name of ['FaustRemoteDsp', 'connectRelay', 'callHost'])
        assert.equal(host[name], undefined, name);
    assert.doesNotMatch(source('host.js'), /FaustRemoteDsp/);
    // The QR code generator's licence travels with it
    assert.match(source('host.js'), /Copyright \(c\) Project Nayuki/);
});

test('the remote control bundle is the smallest', () => {
    const size = (name) => fs.statSync(path.join(DIST, name)).size;
    assert.ok(size('client.js') < size('host.js'));
    assert.ok(size('client.js') < size('index.js') / 2, 'less than half the full bundle');
});

test('a host from host.js and a remote control from client.js understand each other', async () => {
    const node = new FakeNode();
    const remoteHost = new host.FaustRemoteHost(node, { token: 't', outputRate: 1e6 });
    const [hostEnd, remoteEnd] = full.createLoopbackTransports();
    remoteHost.accept(hostEnd);
    const dsp = await client.FaustRemoteDsp.connect(remoteEnd, {
        token: 't',
        pingInterval: 0,
        gestureEnd: 0
    });
    try {
        assert.deepEqual(dsp.getParams().slice(0, 2), [FREQ, GATE]);
        dsp.setParamValue(GATE, 1);
        await new Promise((resolve) => setTimeout(resolve, 0));
        assert.deepEqual(node.writesTo(GATE), [1]);
    } finally {
        dsp.close();
        remoteHost.close();
    }
});
