/**
 * Do the tests actually fail when the code is wrong?
 *
 * A test can be green for two reasons: the code is right, or the assertion
 * cannot tell. Nothing in an ordinary run separates them. This applies a list
 * of deliberate breakages to `src/` and requires the named test file to go red
 * for each one; a mutant that survives means the test covering it proves less
 * than its name claims.
 *
 * Every entry below was found the hard way -- either it is a bug this suite
 * actually caught, or it is a mutation that slipped through a first draft of a
 * test and forced that test to be rewritten. It is not a generated mutation
 * matrix and does not try to be exhaustive: it is a regression test for the
 * tests themselves, run on demand rather than on every commit.
 *
 *     npm run test-mutants
 *
 * Source files are restored on the way out, including after a crash or a
 * Ctrl-C, and the ESM bundle is rebuilt at the end.
 */
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * @typedef {object} Mutant
 * @property {string} what - what the breakage represents, for the report
 * @property {string} file - the source to break, relative to the repo root
 * @property {string} from - the text to replace (every occurrence)
 * @property {string} to - what to replace it with
 * @property {string} tests - the test file that must fail
 */

/** @type {Mutant[]} */
const MUTANTS = [
    {
        what: 'midiMessage receives every channel whatever setMidiChannel says',
        file: 'src/FaustWebAudioDsp.ts',
        from: 'this.fMidiChannel === 0 ||\n            status >= 0xf0',
        to: 'true ||\n            status >= 0xf0',
        tests: 'test/unit/midi-channel.test.mjs'
    },
    {
        what: 'a note off releases the pitch on any channel',
        file: 'src/FaustWebAudioDsp.ts',
        from: 'if (this.fVoiceTable[i].fChannel !== channel) continue;',
        to: '',
        tests: 'test/unit/midi-channel.test.mjs'
    },
    {
        what: 'a panic on one channel cancels what is scheduled on all',
        file: 'src/FaustAudioWorkletProcessor.ts',
        from: 'if (queue[i].channel !== channel) queue[kept++] = queue[i];',
        to: 'if (false) queue[kept++] = queue[i];',
        tests: 'test/unit/midi-channel.test.mjs'
    },
    {
        what: 'the three-point interpolator takes the midpoint on the wrong side',
        file: 'src/FaustSensors.ts',
        from: 'return x < this.fMid',
        to: 'return x <= this.fMid',
        tests: 'test/unit/sensors.test.mjs'
    },
    {
        what: 'the Up curve is built as a Down converter',
        file: 'src/FaustSensors.ts',
        from: 'case Curve.Up:\n                return new FaustSensors.UpConverter(',
        to: 'case Curve.Up:\n                return new FaustSensors.DownConverter(',
        tests: 'test/unit/sensors.test.mjs'
    },
    {
        what: '24-bit decoding drops the most negative sample',
        file: 'src/WavDecoder.ts',
        from: 'xx >= 0x800000',
        to: 'xx > 0x800000',
        tests: 'test/unit/wav-codec.test.mjs'
    },
    {
        what: 'an unknown parameter path reaches wasm again',
        file: 'src/FaustWebAudioDsp.ts',
        from: "if (index === undefined) return this.warnUnknownPath(path, 'ignored');",
        to: 'if (false) return;',
        tests: 'test/unit/param-api.test.mjs'
    },
    {
        what: 'the ScriptProcessor node forwards keyOff to keyOn',
        file: 'src/FaustScriptProcessorNode.ts',
        from: 'this.fDSPCode.keyOff(channel, pitch, velocity);',
        to: 'this.fDSPCode.keyOn(channel, pitch, velocity);',
        tests: 'test/unit/script-processor.test.mjs'
    },
    {
        what: 'the accelerometer is not inverted on Android',
        file: 'src/FaustScriptProcessorNode.ts',
        from: 'this.propagateAcc({ x, y, z }, isAndroid);',
        to: 'this.propagateAcc({ x, y, z }, false);',
        tests: 'test/unit/script-processor.test.mjs'
    },
    {
        what: 'the offline processor ignores the tail of its input',
        file: 'src/FaustOfflineProcessor.ts',
        from: 'input = inputs[i].subarray(l, inputs[i].length);',
        to: 'input = new Float32Array(sliceLength);',
        tests: 'test/unit/paths-agree.test.mjs'
    },
    {
        what: 'the worklet processor hands the DSP no input',
        file: 'src/FaustAudioWorkletProcessor.ts',
        from: 'return this.fDSPCode.compute(inputs[0], outputs[0], events);',
        to: 'return this.fDSPCode.compute([], outputs[0], events);',
        tests: 'test/unit/paths-agree.test.mjs'
    },
    {
        what: 'a polyphonic voice computes half a block',
        file: 'src/FaustWebAudioDsp.ts',
        from: 'voice.compute(count, this.fAudioInputs, this.fAudioMixing);',
        to: 'voice.compute(count >> 1, this.fAudioInputs, this.fAudioMixing);',
        tests: 'test/unit/paths-agree.test.mjs'
    },
    {
        what: 'the AudioWorklet node is created without its DSP factory',
        file: 'src/FaustDspGenerator.ts',
        from: '                            name: processorName,\n                            factory,\n',
        to: '                            name: processorName,\n',
        tests: 'test/unit/node-render.test.mjs'
    },
    {
        what: 'the generated processor module leaves out the instantiator',
        file: 'src/worklet/monoProcessor.ts',
        from: '        FaustWasmInstantiator,\n        FaustAudioWorkletProcessorCommunicator,',
        to: '        FaustWasmInstantiator: undefined as any,\n        FaustAudioWorkletProcessorCommunicator,',
        tests: 'test/unit/node-render.test.mjs'
    },
    {
        what: 'the ScriptProcessor callback stops computing',
        file: 'src/FaustScriptProcessorNode.ts',
        from: 'return this.fDSPCode.compute(this.fInputs, this.fOutputs);',
        to: 'return true;',
        tests: 'test/unit/node-render.test.mjs'
    },
    {
        what: 'the factory cache key goes back to concatenation',
        file: 'src/FaustCompiler.ts',
        from: 'const shaKey = await sha256(JSON.stringify([name, code, args, poly]));',
        to: "const shaKey = await sha256(name + code + args + (poly ? 'poly' : 'mono'));",
        tests: 'test/unit/compiler-cache.test.mjs'
    },
    {
        what: 'faust2wasm stops creating nested output directories',
        file: 'src/faust2wasmFiles.js',
        from: 'fs.mkdirSync(outputDir, { recursive: true });',
        to: 'if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir);',
        tests: 'test/cli/faust2wasm-edge.test.mjs'
    },
    {
        what: 'the soundfile fChannels field the generated code wraps channels with is not written',
        file: 'src/FaustWebAudioDsp.ts',
        from: 'HEAP32[(this.fPtr + 4 * this.fPtrSize) >> 2] = curChan;',
        to: 'HEAP32[(this.fPtr + 4 * this.fPtrSize) >> 2] = 1;',
        tests: 'test/unit/soundfile-wrap.test.mjs'
    },
    {
        what: 'wasm memory blocks are no more aligned on 8 bytes for double samples',
        file: 'src/FaustWebAudioDsp.ts',
        from: 'const currentOffset = (this.allocatedBytes + 7) & ~7;',
        to: 'const currentOffset = this.allocatedBytes;',
        tests: 'test/unit/soundfile-wrap.test.mjs'
    },
    {
        what: 'a vel or velocity control is collected only when its path ends in both',
        file: 'src/FaustWebAudioDsp.ts',
        from: "item.endsWith('/vel') || item.endsWith('/velocity')",
        to: "item.endsWith('/vel') && item.endsWith('/velocity')",
        tests: 'test/unit/voice-velocity.test.mjs'
    },
    {
        what: 'compute hands on the NaN and Inf a DSP produces',
        file: 'src/FaustWebAudioDsp.ts',
        from: '        this.clearNonFinite();',
        to: '',
        tests: 'test/unit/nonfinite.test.mjs'
    },
    {
        what: 'the non-finite check trusts a block whose sum is not finite',
        file: 'src/FaustWebAudioDsp.ts',
        from: 'if (sum - sum === 0) continue;',
        to: 'continue;',
        tests: 'test/unit/nonfinite.test.mjs'
    },
    {
        what: 'a poisoned DSP reports itself on every block, not once',
        file: 'src/FaustWebAudioDsp.ts',
        from: 'if (found && !this.fNonFiniteReported) {',
        to: 'if (found) {',
        tests: 'test/unit/nonfinite.test.mjs'
    },
    {
        what: 'the worklet processor keeps the non-finite report to itself',
        file: 'src/FaustAudioWorkletProcessor.ts',
        from: "this.port.postMessage({ type: 'nonfinite' })",
        to: 'undefined',
        tests: 'test/unit/nonfinite.test.mjs'
    },
    {
        what: 'the non-finite guard runs without a handler: opt-in in name only',
        file: 'src/FaustWebAudioDsp.ts',
        from: '        if (!this.fNonFiniteHandler) return;',
        to: '',
        tests: 'test/unit/nonfinite.test.mjs'
    },
    {
        what: 'the AudioWorklet node never tells its processor to guard',
        file: 'src/FaustAudioWorkletNode.ts',
        from: "type: 'setNonFiniteHandler',",
        to: "type: 'setNonFiniteHandlerNot',",
        tests: 'test/unit/nonfinite.test.mjs'
    },
    {
        what: 'a released voice is freed at -90 dB whatever stop level was given',
        file: 'src/FaustWebAudioDsp.ts',
        from: 'voice.fLevel < this.fStopLevel',
        to: 'voice.fLevel < FaustWebAudioDspVoice.VOICE_STOP_LEVEL',
        tests: 'test/unit/voice-stop-level.test.mjs'
    },
    {
        what: 'a stop level above -40 dB is accepted',
        file: 'src/FaustWebAudioDsp.ts',
        from: 'stopLevel > 0 && stopLevel <= 0.01',
        to: 'stopLevel > 0 && stopLevel <= 1',
        tests: 'test/unit/voice-stop-level.test.mjs'
    },
    {
        what: 'the AudioWorklet processor drops the stop level of its options',
        file: 'src/FaustAudioWorkletProcessor.ts',
        from: '                soundfiles,\n                stopLevel\n',
        to: '                soundfiles\n',
        tests: 'test/unit/node-render.test.mjs'
    },
    {
        what: 'the ScriptProcessor node drops the stop level of its options',
        file: 'src/FaustDspGenerator.ts',
        from: '                soundfiles,\n                processorOptions.stopLevel\n',
        to: '                soundfiles\n',
        tests: 'test/unit/node-render.test.mjs'
    },
    {
        what: 'the offline processor drops the stop level it is given',
        file: 'src/FaustDspGenerator.ts',
        from: '            soundfiles,\n            stopLevel\n        );',
        to: '            soundfiles\n        );',
        tests: 'test/unit/node-render.test.mjs'
    },
    {
        what: 'the PWA only registers its service worker on a load event that has passed',
        file: 'assets/standalone/faust-pwa.js',
        from: 'if (document.readyState === "complete") register();\n            else window.addEventListener',
        to: 'window.addEventListener',
        tests: 'test/cli/pwa-service-worker.test.mjs'
    },
    {
        what: 'an AudioWorklet node keeps a sensor value over its own later write',
        file: 'src/FaustAudioWorkletNode.ts',
        from: 'delete this.fAudioThreadValues[resolved];',
        to: '',
        tests: 'test/unit/node-param-value.test.mjs'
    },
    {
        what: 'the processor reports every write as coming from the node',
        file: 'src/FaustAudioWorkletProcessor.ts',
        from: 'fromNode: this.fNodeWrite',
        to: 'fromNode: true',
        tests: 'test/unit/node-param-value.test.mjs'
    },
    {
        what: 'a remote button is sent on the channel that may lose its release',
        file: 'src/remote/FaustRemoteDsp.ts',
        from: 'if (isDiscrete(item) || this.#options.gestureEnd <= 0) {',
        to: 'if (this.#options.gestureEnd <= 0) {',
        tests: 'test/unit/remote-host.test.mjs'
    },
    {
        what: 'the last value of a remote gesture is resent under a stale sequence number',
        file: 'src/remote/FaustRemoteDsp.ts',
        from: 'seq: this.#lastSeq.get(i)',
        to: 'seq: 0',
        tests: 'test/unit/remote-host.test.mjs'
    },
    {
        what: 'the remote host passes values outside the control range to the node',
        file: 'src/remote/FaustRemoteHost.ts',
        from: 'const value = Math.min(max, Math.max(min, message.value));',
        to: 'const value = message.value;',
        tests: 'test/unit/remote-host.test.mjs'
    },
    {
        what: 'the remote host echoes a write back to its writer',
        file: 'src/remote/FaustRemoteHost.ts',
        from: 'Math.fround(written.value) === Math.fround(value)',
        to: 'false',
        tests: 'test/unit/remote-host.test.mjs'
    },
    {
        what: 'a remote control that vanishes leaves its notes sounding',
        file: 'src/remote/FaustRemoteHost.ts',
        from: 'for (const note of client.notes)',
        to: 'for (const note of [])',
        tests: 'test/unit/remote-render.test.mjs'
    },
    {
        what: 'a WebRTC candidate is added before the remote description it needs',
        file: 'src/remote/rtc.ts',
        from: 'else this.pending.push(candidate);',
        to: 'else this.pc.addIceCandidate(candidate).catch(() => {});',
        tests: 'test/unit/remote-rtc.test.mjs'
    },
    {
        what: 'the signaling server lets a remote control speak for another',
        file: 'src/faustRemoteServer.js',
        from: 'deliver(room, room.host, { ...message, peer: body.id });',
        to: 'deliver(room, room.host, message);',
        tests: 'test/unit/remote-server.test.mjs'
    },
    {
        what: 'the remote server serves files outside its root',
        file: 'src/faustRemoteServer.js',
        from: 'if (file !== base && !file.startsWith(base + path.sep))',
        to: 'if (false)',
        tests: 'test/unit/remote-server.test.mjs'
    },
    {
        what: 'the remote control service worker intercepts the signaling stream',
        file: 'assets/remote/remote-service-worker.js',
        from: 'if (event.request.method !== "GET" || !cached.has(url.href)) return;',
        to: 'if (event.request.method !== "GET") return;',
        tests: 'test/cli/remote-app.test.mjs'
    },
    {
        what: 'a vanished remote control is released before what it had scheduled',
        file: 'src/remote/FaustRemoteHost.ts',
        from: '? client.lastScheduled + 0.001',
        to: '? undefined',
        tests: 'test/unit/remote-timed.test.mjs'
    },
    {
        what: 'timestamps a little ahead of the host clock are clamped to now',
        file: 'src/remote/FaustRemoteHost.ts',
        from: 'const age = Math.max(-delay, (now() - time) / 1000);',
        to: 'const age = Math.max(0, (now() - time) / 1000);',
        tests: 'test/unit/remote-timed.test.mjs'
    },
    {
        what: 'a stopped relay listener tries again',
        file: 'src/remote/relay.ts',
        from: 'if (retry) clearTimeout(retry);',
        to: '',
        tests: 'test/unit/remote-server.test.mjs'
    },
    {
        what: 'the pairing QR code is drawn transposed',
        file: 'src/remote/qr.ts',
        from: 'parts.push(`M${x + border},${y + border}h1v1h-1z`);',
        to: 'parts.push(`M${y + border},${x + border}h1v1h-1z`);',
        tests: 'test/unit/remote-qr.test.mjs'
    },
    {
        what: 'the remote control page loads the complete bundle, host code included',
        file: 'assets/remote/remote.js',
        from: 'await import("../faustwasm-remote/client.js")',
        to: 'await import("../faustwasm-remote/index.js")',
        tests: 'test/cli/remote-app.test.mjs'
    },
    {
        what: 'the remote server lets any foreign origin use its signaling',
        file: 'src/faustRemoteServer.js',
        from: 'if (allowOrigins.includes(origin))',
        to: 'if (true)',
        tests: 'test/unit/remote-server.test.mjs'
    },
    {
        what: 'the remote host accepts a write to a [remote:off] control',
        file: 'src/remote/FaustRemoteHost.ts',
        from: 'if (this.#remoteOff.has(message.i)) {',
        to: 'if (false) {',
        tests: 'test/unit/remote-host.test.mjs'
    },
    {
        what: 'assign: groups gives a group already held to the next phone',
        file: 'src/remote/FaustRemoteHost.ts',
        from: 'this.#groups.find((candidate) => !held.has(candidate)) ?? null;',
        to: 'this.#groups.find(() => true) ?? null;',
        tests: 'test/unit/remote-sensors.test.mjs'
    },
    {
        what: 'the mean of gyroscope compass angles is a plain mean',
        file: 'src/remote/FaustRemoteHost.ts',
        from: "return { alpha, beta: circular('beta'), gamma };",
        to: "return { alpha: recent.reduce((sum, gyr) => sum + gyr.alpha, 0) / recent.length, beta: circular('beta'), gamma };",
        tests: 'test/unit/remote-sensors.test.mjs'
    },
    {
        what: 'playing locally, a change made here waits for the network to be heard',
        file: 'src/remote/local.ts',
        from: '        this.#node.setParamValue(address, value);\n',
        to: '',
        tests: 'test/unit/remote-local.test.mjs'
    },
    {
        what: 'playing locally, values coming back fight the local sensors',
        file: 'src/remote/local.ts',
        from: 'if (!this.#local.has(path)) node.setParamValue(path, value);',
        to: 'node.setParamValue(path, value);',
        tests: 'test/unit/remote-local.test.mjs'
    },
    {
        what: 'the host needs the browser EventTarget again, which Max v8 lacks',
        file: 'src/remote/FaustRemoteHost.ts',
        from: 'export class FaustRemoteHost extends EventTargetBase {',
        to: 'export class FaustRemoteHost extends EventTarget {',
        tests: 'test/unit/remote-noglobals.test.mjs'
    },
    {
        what: 'the plain JavaScript SHA-256 gives a wrong hash',
        file: 'src/remote/runtime.ts',
        from: '0x428a2f98, 0x71374491',
        to: '0x428a2f99, 0x71374491',
        tests: 'test/unit/remote-noglobals.test.mjs'
    },
    {
        what: 'a hub sends a change made in the patch back to the patch',
        file: 'src/remote/hub.ts',
        from: '        this.#values.set(path, value);\n        this.#inputHandler?.(path, value);\n    }',
        to: '        this.#values.set(path, value);\n        this.#options.onwrite?.(path, value);\n        this.#inputHandler?.(path, value);\n    }',
        tests: 'test/unit/remote-hub.test.mjs'
    },
    {
        what: 'a hub does not report a write, so other remote controls miss it',
        file: 'src/remote/hub.ts',
        from: '            this.#options.onwrite?.(path, value);\n            this.#inputHandler?.(path, value);',
        to: '            this.#options.onwrite?.(path, value);',
        tests: 'test/unit/remote-hub.test.mjs'
    },
    {
        what: "a hub ignores Android's opposite accelerometer sign",
        file: 'src/remote/hub.ts',
        from: 'const sign = invert ? -1 : 1;',
        to: 'const sign = 1;',
        tests: 'test/unit/remote-hub.test.mjs'
    },
    {
        what: 'a hub applies timestamped writes at once',
        file: 'src/remote/hub.ts',
        from: '        this.#at(time, apply);',
        to: '        apply();',
        tests: 'test/unit/remote-hub.test.mjs'
    },
    {
        what: 'a relay port never hands a new remote control to the host',
        file: 'src/remote/relay.ts',
        from: '            accept(transport, id);',
        to: '',
        tests: 'test/unit/remote-inprocess.test.mjs'
    },
    {
        what: "the server's in-process port drops what the host sends",
        file: 'src/faustRemoteServer.js',
        from: 'if (open && room.relayHost === peer) fromRelayHost(room, text);',
        to: 'if (open && room.relayHost === peer) return;',
        tests: 'test/unit/remote-inprocess.test.mjs'
    },
    {
        what: 'the host listener lets remote controls into the relay',
        file: 'src/faustRemoteServer.js',
        from: "} else if (role === 'remote' && !hostsOnly) {",
        to: "} else if (role === 'remote') {",
        tests: 'test/unit/remote-server.test.mjs'
    },
    {
        what: 'the host listener answers browser pages',
        file: 'src/faustRemoteServer.js',
        from: 'if (req.headers.origin !== undefined || !loopback) {',
        to: 'if (!loopback) {',
        tests: 'test/unit/remote-server.test.mjs'
    },
    {
        // Killed only where the computer has a network interface besides
        // loopback: the test skips itself otherwise
        what: 'the host listener answers other computers',
        file: 'src/faustRemoteServer.js',
        from: 'if (req.headers.origin !== undefined || !loopback) {',
        to: 'if (req.headers.origin !== undefined) {',
        tests: 'test/unit/remote-server.test.mjs'
    },
    {
        what: 'closing the server leaves its host listeners open',
        file: 'src/faustRemoteServer.js',
        from: 'for (const listener of hostListeners) listener.close();',
        to: '',
        tests: 'test/unit/remote-server.test.mjs'
    },
    {
        what: 'a remote control waits for its timeout when the room has no WebRTC host',
        file: 'src/remote/rtc.ts',
        from: '        signaling.onerror = reject;',
        to: '',
        tests: 'test/unit/remote-inprocess.test.mjs'
    },
    {
        what: "the Max host takes faustgen~'s bargraphs for changes of its controls",
        file: 'src/max/bridge.ts',
        from: '            current.hub.output(address, value);',
        to: '            current.hub.update(address, value);',
        tests: 'test/cli/max-remote.test.mjs'
    },
    {
        what: 'the same, seen from the v8 script',
        file: 'src/max/bridge.ts',
        from: '            current.hub.output(address, value);',
        to: '            current.hub.update(address, value);',
        tests: 'test/cli/max-v8.test.mjs'
    },
    {
        what: "the v8 relay lets a second host into the room of the one in Max",
        file: 'src/max/v8server.ts',
        from: "hello?.role !== 'remote' ||",
        to: '',
        tests: 'test/cli/max-v8.test.mjs'
    },
    {
        what: 'the v8 script keeps its session under another name than the node.script',
        file: 'src/max/v8.ts',
        from: '`${root}:${port}`',
        to: '`${root}|${port}`',
        tests: 'test/cli/max-v8.test.mjs'
    },
    {
        what: "the Max host reads faustgen~'s list by its minimum, not its current value",
        file: 'src/max/bridge.ts',
        from: 'report(String(atoms[0]), Number(atoms[1]))',
        to: 'report(String(atoms[0]), Number(atoms[2]))',
        tests: 'test/cli/max-v8.test.mjs'
    },
    {
        what: 'the Max host asks a faustgen~ that reports by itself for dumps all the same',
        file: 'src/max/bridge.ts',
        from: 'if (params || dumpPeriod <= 0) return;',
        to: 'if (params) return;',
        tests: 'test/cli/max-v8.test.mjs'
    },
    {
        what: "the node.script reads max-api's catch-all handler as (selector, ...args), missing faustgen~'s lists",
        file: 'assets/max/faust-remote.js',
        from: '(handled, name, ...atoms) => {\n        if (!handled && ',
        to: '(name, ...atoms) => {\n        if (',
        tests: 'test/cli/max-remote.test.mjs'
    },
    {
        what: "the host stops its relay listener before its goodbyes, which then never leave",
        file: 'src/remote/FaustRemoteHost.ts',
        from: `        for (const client of [...this.#clients.values()])
            this.#drop(client, reason, true);
        for (const stop of this.#listeners.splice(0)) stop();`,
        to: `        for (const stop of this.#listeners.splice(0)) stop();
        for (const client of [...this.#clients.values()])
            this.#drop(client, reason, true);`,
        tests: 'test/unit/remote-inprocess.test.mjs'
    },
    {
        what: 'the Max host closes the old DSP as an ordinary goodbye, and phones wait to come back',
        file: 'src/max/bridge.ts',
        from: "stop('dsp-changed');",
        to: 'stop();',
        tests: 'test/cli/max-v8.test.mjs'
    },
    {
        what: "npm would publish the patch copies a user makes next to the Max examples",
        file: 'assets/max/.npmignore',
        from: '*-local.maxpat',
        to: '',
        tests: 'test/cli/package-files.test.mjs'
    },
    {
        what: 'the v8 script drops a JSON that comes before its server is up',
        file: 'src/max/v8.ts',
        from: 'else early = text;',
        to: 'else early = undefined;',
        tests: 'test/cli/max-v8.test.mjs'
    },
    {
        what: "faust-json.js ignores faustgen~'s control outlet lists, as it first did in Max",
        file: 'assets/max/faust-json.js',
        from: '    if (args.length > 1 && String(args[0]).charAt(0) === "/") latest[String(args[0])] = args[1];',
        to: '',
        tests: 'test/cli/max-js.test.mjs'
    },
    {
        what: 'faust-params.js shows a two-state parameter as a menu, not a checkbox',
        file: 'assets/max/faust-params.js',
        from: '        if (count === 2) {',
        to: '        if (count === 0) {',
        tests: 'test/cli/max-js.test.mjs'
    }
];

/** The source files this run touches, with their original contents. */
const originals = new Map();

/** Put every touched file back the way it was. */
const restoreAll = () => {
    for (const [file, content] of originals) {
        fs.writeFileSync(path.join(ROOT, file), content);
    }
    originals.clear();
};

// A crash or a Ctrl-C must not leave a broken source behind.
process.on('exit', restoreAll);
process.on('SIGINT', () => {
    restoreAll();
    process.exit(130);
});

/** Rebuild the ESM bundle the tests import. */
const rebuild = () =>
    spawnSync('npm', ['run', 'build-esm'], { cwd: ROOT, stdio: 'ignore' });

/**
 * Apply one mutant and report whether its tests noticed.
 *
 * @param {Mutant} mutant
 * @returns {{ caught: boolean, detail: string }}
 */
const run = (mutant) => {
    const file = path.join(ROOT, mutant.file);
    const original = fs.readFileSync(file, 'utf8');
    if (!original.includes(mutant.from)) {
        return {
            caught: false,
            detail: `the text to break is no longer in ${mutant.file}`
        };
    }
    originals.set(mutant.file, original);
    try {
        fs.writeFileSync(file, original.split(mutant.from).join(mutant.to));
        rebuild();
        const result = spawnSync('node', ['--test', mutant.tests], {
            cwd: ROOT,
            encoding: 'utf8'
        });
        const failures = (result.stdout.match(/^not ok /gm) || []).length;
        return result.status === 0
            ? { caught: false, detail: 'the tests stayed green' }
            : { caught: true, detail: `${failures} test(s) failed` };
    } finally {
        fs.writeFileSync(file, original);
        originals.delete(mutant.file);
    }
};

let survivors = 0;
console.log(`Applying ${MUTANTS.length} deliberate breakages.\n`);
for (const mutant of MUTANTS) {
    process.stdout.write(`  ${mutant.what}\n    `);
    const { caught, detail } = run(mutant);
    if (!caught) survivors += 1;
    console.log(
        `${caught ? 'caught' : 'SURVIVED'} by ${path.basename(mutant.tests)} -- ${detail}`
    );
}

rebuild();
console.log(
    `\n${MUTANTS.length - survivors}/${MUTANTS.length} caught.` +
        (survivors
            ? ` ${survivors} survived: the tests named above do not cover what they appear to.`
            : '')
);
process.exit(survivors === 0 ? 0 : 1);
