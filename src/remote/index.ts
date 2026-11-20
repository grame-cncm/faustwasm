/**
 * Remote control of a Faust node, from another page or device.
 *
 * Bundles of their own in `dist/remote/`, separate from the main one: a
 * remote control never loads the compiler or the wasm. This one
 * (`index.js`) has everything; `client.js` has only the remote control's
 * side and `host.js` only the host's, so that a phone does not download the
 * host's code. Experimental: not re-exported by `src/exports.ts`, and free to
 * change until it is. See `docs/remote-control.md`.
 */
export {
    FaustRemoteHost,
    type FaustRemoteClientInfo,
    type FaustRemoteHostOptions,
    type FaustRemoteHostTarget
} from './FaustRemoteHost';
export {
    FaustRemoteDsp,
    FaustRemoteError,
    type FaustRemoteDspOptions,
    type FaustRemoteDspState,
    type IFaustRemoteControl
} from './FaustRemoteDsp';
export {
    SAFE_MESSAGE_SIZE,
    createLoopbackTransports,
    type FaustLoopbackOptions,
    type FaustRemoteChannel,
    type FaustRemoteTransport
} from './transport';
export {
    PROTOCOL_VERSION,
    type FaustRemoteMode,
    type FaustRemoteRejectCode,
    type FaustRemoteSensorPolicy
} from './protocol';
export {
    answerPeers,
    callHost,
    createRTCTransport,
    type FaustRTCOptions
} from './rtc';
export {
    createHttpSignaling,
    createLoopbackSignaling,
    type FaustHttpSignaling,
    type FaustHttpSignalingOptions,
    type FaustSignalMessage,
    type FaustSignaling
} from './signaling';
export {
    acceptRelayed,
    connectRelay,
    listenRelay,
    type FaustRelayOptions,
    type FaustRelayPort
} from './relay';
export { FaustRemoteHub, type FaustRemoteHubOptions } from './hub';
export { qrCodeSvg, type FaustQrCodeOptions } from './qr';
export { FaustLocalSound, type FaustLocalNode } from './local';
