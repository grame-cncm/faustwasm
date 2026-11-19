/**
 * The messages a remote control and a host exchange, and how each side tells a
 * well-formed one from anything else.
 *
 * See `docs/remote-control.md` for the protocol as a whole. Messages are JSON
 * objects, one per transport message, discriminated by `type`. After the
 * handshake, controls are addressed by their index in the `inputs` and
 * `outputs` lists the host sends in `welcome`.
 *
 * Parsing checks shape only: that a field is present and of the right kind,
 * and that every number is finite. Whether an index is in range, a control may
 * be written or a value is within its bounds needs the DSP, and is the host's
 * business.
 */

/** Bumped on any change a peer of the previous version would misread. */
export const PROTOCOL_VERSION = 1;

/**
 * `bi`: after the handshake the host sends bargraphs, parameter changes and
 * voice counts. `uni`: it sends nothing but `pong`.
 */
export type FaustRemoteMode = 'bi' | 'uni';

export type FaustRemoteRejectCode =
    'version' | 'token' | 'full' | 'dsp-mismatch' | 'malformed';

// ---------------------------------------------------- remote control to host

export interface FaustRemoteHelloMessage {
    type: 'hello';
    v: number;
    /** Stable across reconnections of the same remote control. */
    id: string;
    token?: string;
    mode: FaustRemoteMode;
    /** SHA-256 of the DSP JSON the remote control already holds, in hex. */
    hash?: string;
}

export interface FaustRemoteParamMessage {
    type: 'param';
    i: number;
    value: number;
    /** Present on writes that may arrive out of order. */
    seq?: number;
}

export interface FaustRemoteAccMessage {
    type: 'acc';
    x: number;
    y: number;
    z: number;
    /** The platform of the remote control, not the host's, decides this. */
    invert: boolean;
    seq?: number;
}

export interface FaustRemoteGyrMessage {
    type: 'gyr';
    alpha: number;
    beta: number;
    gamma: number;
    seq?: number;
}

export interface FaustRemoteMidiMessage {
    type: 'midi';
    data: number[];
}

export interface FaustRemotePingMessage {
    type: 'ping';
    s: number;
    t0: number;
}

export interface FaustRemoteByeMessage {
    type: 'bye';
    reason?: string;
}

export type FaustRemoteClientMessage =
    | FaustRemoteHelloMessage
    | FaustRemoteParamMessage
    | FaustRemoteAccMessage
    | FaustRemoteGyrMessage
    | FaustRemoteMidiMessage
    | FaustRemotePingMessage
    | FaustRemoteByeMessage;

// ---------------------------------------------------- host to remote control

export interface FaustRemoteWelcomeMessage {
    type: 'welcome';
    v: number;
    session: string;
    /** The mode granted, which a `uni` host imposes on every remote control. */
    mode: FaustRemoteMode;
    /** The DSP JSON, in `bi` mode only. */
    json?: string;
    inputs: string[];
    outputs: string[];
    /** Current value of each input, in `inputs` order. */
    values: number[];
    /** Last known value of each output, in `outputs` order. */
    outputValues: number[];
    voices: number;
    rates: { out: number };
}

export interface FaustRemoteRejectMessage {
    type: 'reject';
    code: FaustRemoteRejectCode;
    reason: string;
}

export interface FaustRemoteOutMessage {
    type: 'out';
    values: number[];
    /** Indices in `outputs` of `values`; absent when all outputs are sent. */
    i?: number[];
}

export interface FaustRemoteSyncMessage {
    type: 'sync';
    i: number;
    value: number;
}

export interface FaustRemoteVoicesMessage {
    type: 'voices';
    count: number;
}

export interface FaustRemotePongMessage {
    type: 'pong';
    s: number;
    t0: number;
    t1: number;
    t2: number;
}

export type FaustRemoteHostMessage =
    | FaustRemoteWelcomeMessage
    | FaustRemoteRejectMessage
    | FaustRemoteOutMessage
    | FaustRemoteSyncMessage
    | FaustRemoteVoicesMessage
    | FaustRemotePongMessage
    | FaustRemoteByeMessage;

/** A piece of a message too large for one transport message. */
export interface FaustRemoteChunkMessage {
    type: 'chunk';
    id: number;
    part: number;
    of: number;
    data: string;
}

// ------------------------------------------------------------------ parsing

type Fields = Record<string, unknown>;

const isNumber = (x: unknown): x is number =>
    typeof x === 'number' && Number.isFinite(x);
const isIndex = (x: unknown): x is number =>
    Number.isInteger(x) && (x as number) >= 0;
const isString = (x: unknown): x is string => typeof x === 'string';
const isOptional = (x: unknown, is: (x: unknown) => boolean) =>
    x === undefined || is(x);
const isNumbers = (x: unknown): x is number[] =>
    Array.isArray(x) && x.every(isNumber);
const isIndices = (x: unknown): x is number[] =>
    Array.isArray(x) && x.every(isIndex);
const isMode = (x: unknown): x is FaustRemoteMode => x === 'bi' || x === 'uni';

const parseObject = (text: string): Fields | null => {
    let value: unknown;
    try {
        value = JSON.parse(text);
    } catch {
        return null;
    }
    if (typeof value !== 'object' || value === null || Array.isArray(value))
        return null;
    return value as Fields;
};

/**
 * Whether bytes are one MIDI channel voice message: note off and on,
 * polyphonic pressure, control change, program change, channel pressure or
 * pitch bend. System messages, SysEx included, are not.
 */
export const isChannelVoiceMessage = (data: unknown): data is number[] => {
    if (!Array.isArray(data) || data.length === 0) return false;
    const [status, ...rest] = data;
    if (!Number.isInteger(status) || status < 0x80 || status > 0xef)
        return false;
    const kind = status & 0xf0;
    const length = kind === 0xc0 || kind === 0xd0 ? 1 : 2;
    return (
        rest.length === length &&
        rest.every((b) => Number.isInteger(b) && b >= 0 && b < 0x80)
    );
};

/** A message from a remote control, or null if it is not one. */
export const parseClientMessage = (
    text: string
): FaustRemoteClientMessage | null => {
    const m = parseObject(text);
    if (!m) return null;
    switch (m.type) {
        case 'hello':
            return isNumber(m.v) &&
                isString(m.id) &&
                isOptional(m.token, isString) &&
                isMode(m.mode) &&
                isOptional(m.hash, isString)
                ? (m as unknown as FaustRemoteHelloMessage)
                : null;
        case 'param':
            return isIndex(m.i) &&
                isNumber(m.value) &&
                isOptional(m.seq, isIndex)
                ? (m as unknown as FaustRemoteParamMessage)
                : null;
        case 'acc':
            return isNumber(m.x) &&
                isNumber(m.y) &&
                isNumber(m.z) &&
                typeof m.invert === 'boolean' &&
                isOptional(m.seq, isIndex)
                ? (m as unknown as FaustRemoteAccMessage)
                : null;
        case 'gyr':
            return isNumber(m.alpha) &&
                isNumber(m.beta) &&
                isNumber(m.gamma) &&
                isOptional(m.seq, isIndex)
                ? (m as unknown as FaustRemoteGyrMessage)
                : null;
        case 'midi':
            return isChannelVoiceMessage(m.data)
                ? (m as unknown as FaustRemoteMidiMessage)
                : null;
        case 'ping':
            return isNumber(m.s) && isNumber(m.t0)
                ? (m as unknown as FaustRemotePingMessage)
                : null;
        case 'bye':
            return isOptional(m.reason, isString)
                ? (m as unknown as FaustRemoteByeMessage)
                : null;
        default:
            return null;
    }
};

/** A message from a host (or a chunk of one), or null if it is not one. */
export const parseHostMessage = (
    text: string
): FaustRemoteHostMessage | FaustRemoteChunkMessage | null => {
    const m = parseObject(text);
    if (!m) return null;
    switch (m.type) {
        case 'welcome':
            return isNumber(m.v) &&
                isString(m.session) &&
                isMode(m.mode) &&
                isOptional(m.json, isString) &&
                Array.isArray(m.inputs) &&
                m.inputs.every(isString) &&
                Array.isArray(m.outputs) &&
                m.outputs.every(isString) &&
                isNumbers(m.values) &&
                m.values.length === m.inputs.length &&
                isNumbers(m.outputValues) &&
                m.outputValues.length === m.outputs.length &&
                isIndex(m.voices) &&
                typeof m.rates === 'object' &&
                m.rates !== null &&
                isNumber((m.rates as Fields).out)
                ? (m as unknown as FaustRemoteWelcomeMessage)
                : null;
        case 'reject':
            return isString(m.code) && isString(m.reason)
                ? (m as unknown as FaustRemoteRejectMessage)
                : null;
        case 'out':
            return isNumbers(m.values) &&
                (m.i === undefined ||
                    (isIndices(m.i) && m.i.length === m.values.length))
                ? (m as unknown as FaustRemoteOutMessage)
                : null;
        case 'sync':
            return isIndex(m.i) && isNumber(m.value)
                ? (m as unknown as FaustRemoteSyncMessage)
                : null;
        case 'voices':
            return isIndex(m.count)
                ? (m as unknown as FaustRemoteVoicesMessage)
                : null;
        case 'pong':
            return isNumber(m.s) &&
                isNumber(m.t0) &&
                isNumber(m.t1) &&
                isNumber(m.t2)
                ? (m as unknown as FaustRemotePongMessage)
                : null;
        case 'bye':
            return isOptional(m.reason, isString)
                ? (m as unknown as FaustRemoteByeMessage)
                : null;
        case 'chunk':
            return isIndex(m.id) &&
                isIndex(m.part) &&
                isIndex(m.of) &&
                (m.part as number) < (m.of as number) &&
                isString(m.data)
                ? (m as unknown as FaustRemoteChunkMessage)
                : null;
        default:
            return null;
    }
};

// ----------------------------------------------------------------- chunking

/** Room left in each chunk for the fields around `data`. */
const CHUNK_OVERHEAD = 128;

const utf8Length = (text: string) => new TextEncoder().encode(text).length;

/**
 * Split an encoded message into chunk messages no larger than `maxSize`
 * bytes, or return it alone if it already fits.
 *
 * Each chunk carries at most `(maxSize - 128) / 6` characters of the original:
 * six bytes is the most one UTF-16 unit can take once re-escaped inside the
 * chunk's own JSON (a control character becomes `\u00XX`), so no chunk can
 * overflow whatever the text contains.
 */
export const splitMessage = (
    text: string,
    maxSize: number,
    id: number
): string[] => {
    if (utf8Length(text) <= maxSize) return [text];
    const size = Math.max(1, Math.floor((maxSize - CHUNK_OVERHEAD) / 6));
    const of = Math.ceil(text.length / size);
    const chunks: string[] = [];
    for (let part = 0; part < of; part += 1) {
        const chunk: FaustRemoteChunkMessage = {
            type: 'chunk',
            id,
            part,
            of,
            data: text.slice(part * size, (part + 1) * size)
        };
        chunks.push(JSON.stringify(chunk));
    }
    return chunks;
};

/**
 * Put chunks back together.
 *
 * Chunks travel on the ordered, reliable channel, so they arrive whole and in
 * order; anything else (a part out of sequence, a new message before the last
 * one ended) drops what was being assembled rather than guess.
 */
export class FaustRemoteChunkAssembler {
    private id = -1;
    private parts: string[] = [];
    private length = 0;

    constructor(private readonly maxLength = 4 * 1024 * 1024) {}

    /** Add a chunk; return the whole message once its last part is in. */
    push(chunk: FaustRemoteChunkMessage): string | null {
        if (chunk.part === 0) {
            this.id = chunk.id;
            this.parts = [];
            this.length = 0;
        } else if (chunk.id !== this.id || chunk.part !== this.parts.length) {
            this.id = -1;
            this.parts = [];
            this.length = 0;
            return null;
        }
        this.parts.push(chunk.data);
        this.length += chunk.data.length;
        if (this.length > this.maxLength) {
            this.id = -1;
            this.parts = [];
            this.length = 0;
            return null;
        }
        if (this.parts.length < chunk.of) return null;
        const text = this.parts.join('');
        this.id = -1;
        this.parts = [];
        this.length = 0;
        return text;
    }
}

// -------------------------------------------------------------------- utils

/** A random identifier: `bytes` random bytes, in hex. */
export const randomId = (bytes = 16) =>
    Array.from(globalThis.crypto.getRandomValues(new Uint8Array(bytes)), (b) =>
        b.toString(16).padStart(2, '0')
    ).join('');

/** SHA-256 of a text's UTF-8 bytes, in hex. Needs a secure context. */
export const sha256Hex = async (text: string) => {
    const digest = await globalThis.crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(text)
    );
    return Array.from(new Uint8Array(digest), (b) =>
        b.toString(16).padStart(2, '0')
    ).join('');
};
