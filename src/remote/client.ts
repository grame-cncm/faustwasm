/**
 * The remote control's bundle (`dist/remote/client.js`): what a phone needs
 * to drive a host, and nothing of the host's side -- no `FaustRemoteHost`, no
 * QR code generator. Self-contained: it shares no file with `host.js`, so a
 * page loads one or the other. `index.js` has everything, for code that does
 * not count bytes. Experimental, as the rest of `src/remote/`.
 */
export {
    FaustRemoteDsp,
    FaustRemoteError,
    type FaustRemoteDspOptions,
    type FaustRemoteDspState,
    type IFaustRemoteControl
} from './FaustRemoteDsp';
export {
    createHttpSignaling,
    type FaustHttpSignaling,
    type FaustHttpSignalingOptions,
    type FaustSignalMessage,
    type FaustSignaling
} from './signaling';
export { callHost, createRTCTransport, type FaustRTCOptions } from './rtc';
export { connectRelay, type FaustRelayOptions } from './relay';
export {
    type FaustRemoteChannel,
    type FaustRemoteTransport
} from './transport';
export {
    PROTOCOL_VERSION,
    type FaustRemoteMode,
    type FaustRemoteRejectCode
} from './protocol';
