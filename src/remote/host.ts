/**
 * The host's bundle (`dist/remote/host.js`): what the page running the DSP
 * needs to accept remote controls and show its pairing link -- and nothing
 * of the remote control's side. Self-contained, as `client.js` is; `index.js`
 * has everything. Experimental, as the rest of `src/remote/`.
 */
export {
    FaustRemoteHost,
    type FaustRemoteClientInfo,
    type FaustRemoteHostOptions,
    type FaustRemoteHostTarget
} from './FaustRemoteHost';
export {
    createHttpSignaling,
    type FaustHttpSignaling,
    type FaustHttpSignalingOptions,
    type FaustSignalMessage,
    type FaustSignaling
} from './signaling';
export { answerPeers, createRTCTransport, type FaustRTCOptions } from './rtc';
export { listenRelay, type FaustRelayOptions } from './relay';
export { qrCodeSvg, type FaustQrCodeOptions } from './qr';
export {
    type FaustRemoteChannel,
    type FaustRemoteTransport
} from './transport';
export {
    PROTOCOL_VERSION,
    type FaustRemoteMode,
    type FaustRemoteRejectCode,
    type FaustRemoteSensorPolicy
} from './protocol';
