/**
 * Remote control of a Faust node, from another page or device.
 *
 * A bundle of its own (`dist/remote/index.js`), separate from the main one:
 * a remote control loads this and faust-ui, never the compiler or the wasm.
 * Experimental: not re-exported by `src/exports.ts`, and free to change until
 * it is. See `docs/remote-control.md`.
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
    type FaustRemoteRejectCode
} from './protocol';
