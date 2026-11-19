import type {
    IFaustBaseWebAudioDsp,
    InputParamHandler,
    OutputParamHandler
} from '../FaustWebAudioDsp';
import type { FaustDspMeta, FaustUIInputItem } from '../types';
import {
    FaustRemoteChunkAssembler,
    PROTOCOL_VERSION,
    isChannelVoiceMessage,
    parseHostMessage,
    randomId,
    sha256Hex,
    type FaustRemoteClientMessage,
    type FaustRemoteHostMessage,
    type FaustRemoteMode,
    type FaustRemoteRejectCode,
    type FaustRemoteWelcomeMessage
} from './protocol';
import { FaustRemoteClock } from './clock';
import { connectRelay, type FaustRelayOptions } from './relay';
import { callHost, type FaustRTCOptions } from './rtc';
import type { FaustSignaling } from './signaling';
import type { FaustRemoteChannel, FaustRemoteTransport } from './transport';
import { isDiscrete, isRemoteOff, readUI, type FaustRemoteUI } from './ui';

/**
 * The part of a node's API that controls it, without the audio: what a user
 * interface and the sensors need. `createFaustUI(div, node)` uses nothing
 * else, so it accepts a `FaustRemoteDsp` as it is.
 */
export type IFaustRemoteControl = Pick<
    IFaustBaseWebAudioDsp,
    | 'setParamValue'
    | 'getParamValue'
    | 'getParams'
    | 'getMeta'
    | 'getUI'
    | 'getJSON'
    | 'getDescriptors'
    | 'setOutputParamHandler'
    | 'getOutputParamHandler'
    | 'callOutputParamHandler'
    | 'setInputParamHandler'
    | 'getInputParamHandler'
    | 'callInputParamHandler'
    | 'midiMessage'
    | 'keyOn'
    | 'keyOff'
    | 'ctrlChange'
    | 'pitchWheel'
    | 'hasAccInput'
    | 'hasGyrInput'
    | 'propagateAcc'
    | 'propagateGyr'
    | 'startSensors'
    | 'stopSensors'
>;

export interface FaustRemoteDspOptions {
    /** The token the host was given. */
    token?: string;
    /** Keep it across reconnections; a random one otherwise. */
    id?: string;
    /** Default `bi`. */
    mode?: FaustRemoteMode;
    /**
     * The DSP JSON, for a remote control built with its DSP. Required in `uni`
     * mode, where the host does not send it; the host refuses a different DSP.
     */
    json?: string;
    /** Milliseconds to wait for the host's welcome. Default 10000. */
    timeout?: number;
    /** Milliseconds between pings; 0 sends none. Default 1000. */
    pingInterval?: number;
    /**
     * Milliseconds of stillness after which a slider's last value is sent
     * again on the reliable channel. 0 sends every slider value there, and
     * nothing on the unreliable one. Default 100.
     */
    gestureEnd?: number;
    /** Smallest change of a sensor axis worth sending. Default 0.01. */
    sensorThreshold?: number;
}

/** Why `connect` failed, when the host said so. */
export class FaustRemoteError extends Error {
    constructor(
        message: string,
        readonly code: FaustRemoteRejectCode | 'closed' | 'timeout' | 'no-json'
    ) {
        super(message);
        this.name = 'FaustRemoteError';
    }
}

export type FaustRemoteDspState = 'connecting' | 'open' | 'closed';

/** `stream` bytes queued past which a continuous value is not sent. */
const STREAM_HIGH_WATER = 4096;
/** Pings sent at once when the host wants timestamps, to know its clock soon. */
const CLOCK_BURST = 4;

const now = () => globalThis.performance.now();

const unref = <T>(timer: T): T => {
    (timer as { unref?: () => void }).unref?.();
    return timer;
};

/**
 * A DSP running on a host, controlled from here: the remote control side.
 *
 * It behaves as the node does for everything that controls it -- parameters,
 * output and input handlers, sensors, MIDI -- and produces no sound. Values
 * are written locally at once, so `getParamValue` answers without a round
 * trip, and changes made elsewhere (on the host, by another remote control,
 * by a sensor) arrive through the input parameter handler, as they do on a
 * node.
 *
 * Events: `statechange` when `state` changes, `rtt` on each measured round
 * trip (`detail`: milliseconds), `error` (`detail`: the error).
 */
export class FaustRemoteDsp extends EventTarget implements IFaustRemoteControl {
    readonly #transport: FaustRemoteTransport;
    readonly #options: Required<Omit<FaustRemoteDspOptions, 'token' | 'json'>> &
        Pick<FaustRemoteDspOptions, 'token' | 'json'>;
    readonly #assembler = new FaustRemoteChunkAssembler();

    #state: FaustRemoteDspState = 'connecting';
    #mode: FaustRemoteMode = 'bi';
    #json = '';
    #meta: FaustDspMeta | null = null;
    #ui: FaustRemoteUI = {
        inputs: [],
        outputs: [],
        aliases: {},
        hasAcc: false,
        hasGyr: false
    };
    #inputs: string[] = [];
    readonly #inputIndex = new Map<string, number>();
    readonly #items = new Map<string, FaustUIInputItem>();
    readonly #values = new Map<string, number>();
    #outputs: string[] = [];
    #outValues: number[] = [];
    #voices = 0;
    #group: string | undefined;

    #seq = 0;
    readonly #lastSeq = new Map<number, number>();
    readonly #gestureTimers = new Map<number, ReturnType<typeof setTimeout>>();
    #lastAcc: [number, number, number] | null = null;
    #lastGyr: [number, number, number] | null = null;

    #pingTimer: ReturnType<typeof setInterval> | null = null;
    #pingSeq = 0;
    readonly #clock = new FaustRemoteClock();
    /** The host's playout delay in ms; 0 when it applies values as they come. */
    #delay = 0;
    /** The `time` of each continuous input's last value, for its resend. */
    readonly #lastTime = new Map<number, number | undefined>();

    #outputHandler: OutputParamHandler | null = null;
    #inputHandler: InputParamHandler | null = null;

    #welcome: {
        resolve: (welcome: FaustRemoteWelcomeMessage) => void;
        reject: (error: FaustRemoteError) => void;
    } | null = null;

    private constructor(
        transport: FaustRemoteTransport,
        options: FaustRemoteDspOptions
    ) {
        super();
        this.#transport = transport;
        this.#options = {
            id: randomId(8),
            mode: 'bi',
            timeout: 10000,
            pingInterval: 1000,
            gestureEnd: 100,
            sensorThreshold: 0.01,
            ...options
        };
    }

    /**
     * Introduce this remote control to the host on an open connection, and
     * resolve once the host has welcomed it.
     *
     * @throws {FaustRemoteError} if the host refuses (`code` says why), the
     * connection closes, or no welcome comes in time
     */
    /**
     * Connect to a host over WebRTC, through a signaling channel, then
     * introduce this remote control as `connect` does. The signaling channel
     * is closed once the connection is open: no control goes through it.
     *
     * @throws {FaustRemoteError} as `connect` does, or an `Error` if the
     * connection does not open
     */
    static async connectRTC(
        signaling: FaustSignaling,
        options: FaustRemoteDspOptions = {},
        rtc: FaustRTCOptions = {}
    ): Promise<FaustRemoteDsp> {
        try {
            const transport = await callHost(signaling, rtc);
            return await FaustRemoteDsp.connect(transport, options);
        } finally {
            signaling.close();
        }
    }

    /**
     * Connect to a host through the WebSocket relay of the server at `url`,
     * then introduce this remote control as `connect` does: the fallback
     * when `connectRTC` cannot open a connection.
     *
     * @param url - the server's origin, e.g. `location.origin`
     */
    static async connectRelay(
        url: string,
        room: string,
        options: FaustRemoteDspOptions & { token: string },
        relay: FaustRelayOptions = {}
    ): Promise<FaustRemoteDsp> {
        const transport = await connectRelay(url, room, options.token, relay);
        return FaustRemoteDsp.connect(transport, options);
    }

    static async connect(
        transport: FaustRemoteTransport,
        options: FaustRemoteDspOptions = {}
    ): Promise<FaustRemoteDsp> {
        const dsp = new FaustRemoteDsp(transport, options);
        const hash =
            options.json !== undefined
                ? await sha256Hex(options.json)
                : undefined;
        const welcome = await new Promise<FaustRemoteWelcomeMessage>(
            (resolve, reject) => {
                const timer = setTimeout(() => {
                    dsp.#welcome = null;
                    transport.close('timeout');
                    reject(new FaustRemoteError('no welcome', 'timeout'));
                }, dsp.#options.timeout);
                dsp.#welcome = {
                    resolve: (welcome) => {
                        clearTimeout(timer);
                        resolve(welcome);
                    },
                    reject: (error) => {
                        clearTimeout(timer);
                        reject(error);
                    }
                };
                transport.onmessage = (channel, text) =>
                    dsp.#receive(channel, text);
                transport.onclose = (reason) => dsp.#closed(reason);
                dsp.#send({
                    type: 'hello',
                    v: PROTOCOL_VERSION,
                    id: dsp.#options.id,
                    token: options.token,
                    mode: dsp.#options.mode,
                    hash
                });
            }
        );
        dsp.#open(welcome);
        return dsp;
    }

    /** `connecting` until the welcome, `open`, then `closed` for good. */
    get state() {
        return this.#state;
    }

    /** The mode the host granted. */
    get mode() {
        return this.#mode;
    }

    /** Shortest recent round trip to the host, in milliseconds; NaN before the first. */
    get rtt() {
        return this.#clock.rtt;
    }

    /** The recent round trips, in milliseconds, oldest first. */
    get rttSamples() {
        return this.#clock.rtts;
    }

    /**
     * The host's clock minus this one's, in milliseconds, as estimated from
     * the pings; null before the first answer.
     */
    get clockOffset() {
        return this.#clock.offset;
    }

    /** The host's playout delay in milliseconds; 0 if it has none. */
    get playoutDelay() {
        return this.#delay;
    }

    /**
     * Now, in the host's clock, if the host wants timestamps and its clock is
     * known; otherwise undefined, and the host applies the value on arrival.
     */
    #stamp() {
        const offset = this.#clock.offset;
        return this.#delay > 0 && offset !== null ? now() + offset : undefined;
    }

    /** Say goodbye to the host and close the connection. */
    close(reason = 'bye') {
        if (this.#state === 'closed') return;
        this.#send({ type: 'bye', reason });
        this.#transport.close(reason);
        this.#closed(reason);
    }

    // ---------------------------------------------------------- parameters

    setParamValue(path: string, value: number) {
        const address = this.#ui.aliases[path] ?? path;
        const i = this.#inputIndex.get(address);
        const item = this.#items.get(address);
        if (i === undefined || !item || !Number.isFinite(value)) return;
        if (isRemoteOff(item)) {
            // The DSP keeps it from remote controls: nothing is sent, and
            // the control is given the host's value back
            const hostValue = this.#values.get(address) ?? 0;
            queueMicrotask(() => this.#inputHandler?.(address, hostValue));
            return;
        }
        this.#values.set(address, value);
        if (this.#state !== 'open') return;
        const time = this.#stamp();
        if (isDiscrete(item) || this.#options.gestureEnd <= 0) {
            // A lost button release would leave a note sounding
            this.#send({ type: 'param', i, value, time });
            return;
        }
        this.#seq += 1;
        const seq = this.#seq;
        this.#lastSeq.set(i, seq);
        this.#lastTime.set(i, time);
        if (this.#transport.bufferedAmount('stream') <= STREAM_HIGH_WATER)
            this.#send({ type: 'param', i, value, seq, time }, 'stream');
        // The stream may drop the last value of the gesture, which nothing
        // would replace: send it again, reliably, once the control rests
        const pending = this.#gestureTimers.get(i);
        if (pending) clearTimeout(pending);
        this.#gestureTimers.set(
            i,
            setTimeout(() => {
                this.#gestureTimers.delete(i);
                this.#send({
                    type: 'param',
                    i,
                    value: this.#values.get(address)!,
                    seq: this.#lastSeq.get(i),
                    // Its own moment, so the host plays it where it belongs
                    time: this.#lastTime.get(i)
                });
            }, this.#options.gestureEnd)
        );
    }

    getParamValue(path: string) {
        const address = this.#ui.aliases[path] ?? path;
        return this.#values.get(address) ?? 0;
    }

    getParams() {
        return [...this.#inputs];
    }

    getMeta(): FaustDspMeta {
        return this.#meta!;
    }

    getUI() {
        return this.#meta!.ui;
    }

    getJSON() {
        return this.#json;
    }

    getDescriptors() {
        return this.#ui.inputs;
    }

    /**
     * As on a node, plus one thing a node does not need: the handler is
     * given the last bargraph values at once (in a microtask), since the host
     * computed them before this remote control was there to see.
     */
    setOutputParamHandler(handler: OutputParamHandler | null) {
        this.#outputHandler = handler;
        if (!handler) return;
        queueMicrotask(() => {
            if (this.#outputHandler !== handler) return;
            this.#outputs.forEach((path, k) =>
                handler(path, this.#outValues[k])
            );
        });
    }
    getOutputParamHandler() {
        return this.#outputHandler;
    }
    callOutputParamHandler(path: string, value: number) {
        this.#outputHandler?.(path, value);
    }

    /**
     * As on a node, plus one thing a node does not need: the handler is
     * given every parameter's current value at once (in a microtask). A UI
     * built from the JSON starts from the `init` values, which is right for a
     * node that has just been created and wrong for a host that has been
     * running: this is what brings it to the host's state.
     */
    setInputParamHandler(handler: InputParamHandler | null) {
        this.#inputHandler = handler;
        if (!handler) return;
        queueMicrotask(() => {
            if (this.#inputHandler !== handler) return;
            for (const [path, value] of this.#values) handler(path, value);
        });
    }
    getInputParamHandler() {
        return this.#inputHandler;
    }
    callInputParamHandler(path: string, value: number) {
        this.#inputHandler?.(path, value);
    }

    /** Last bargraph value received, by address. */
    getOutputValue(path: string) {
        const k = this.#outputs.indexOf(path);
        return k === -1 ? 0 : this.#outValues[k];
    }

    /** The group of controls the host gave this remote control, if it gives groups. */
    get group() {
        return this.#group;
    }

    /** Voices sounding on the host, for a polyphonic DSP. */
    getNumActiveVoices() {
        return this.#voices;
    }

    // ----------------------------------------------------------------- MIDI

    midiMessage(data: number[] | Uint8Array) {
        const bytes = Array.from(data);
        if (this.#state !== 'open' || !isChannelVoiceMessage(bytes)) return;
        this.#send({ type: 'midi', data: bytes, time: this.#stamp() });
    }
    keyOn(channel: number, pitch: number, velocity: number) {
        this.midiMessage([0x90 | (channel & 0xf), pitch, velocity]);
    }
    keyOff(channel: number, pitch: number, velocity: number) {
        this.midiMessage([0x80 | (channel & 0xf), pitch, velocity]);
    }
    ctrlChange(channel: number, ctrl: number, value: number) {
        this.midiMessage([0xb0 | (channel & 0xf), ctrl, value]);
    }
    pitchWheel(channel: number, value: number) {
        this.midiMessage([
            0xe0 | (channel & 0xf),
            value & 0x7f,
            (value >> 7) & 0x7f
        ]);
    }

    // -------------------------------------------------------------- sensors

    get hasAccInput() {
        return this.#ui.hasAcc;
    }

    get hasGyrInput() {
        return this.#ui.hasGyr;
    }

    /**
     * Send a raw accelerometer reading; the host maps it through the DSP's
     * `[acc:...]` metadata. `invert` is this device's: Android reports the
     * opposite sign.
     */
    propagateAcc(
        accelerationIncludingGravity: NonNullable<
            DeviceMotionEvent['accelerationIncludingGravity']
        >,
        invert = false
    ) {
        if (this.#state !== 'open' || !this.hasAccInput) return;
        if (!accelerationIncludingGravity) return;
        const { x, y, z } = accelerationIncludingGravity;
        if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(z))
            return;
        if (this.#unchanged(this.#lastAcc, x, y, z)) return;
        if (this.#transport.bufferedAmount('stream') > STREAM_HIGH_WATER)
            return;
        this.#lastAcc = [x, y, z];
        this.#seq += 1;
        this.#send(
            {
                type: 'acc',
                x,
                y,
                z,
                invert,
                seq: this.#seq,
                time: this.#stamp()
            },
            'stream'
        );
    }

    /** Send a raw orientation reading; see `propagateAcc`. */
    propagateGyr(
        event: Pick<DeviceOrientationEvent, 'alpha' | 'beta' | 'gamma'>
    ) {
        if (this.#state !== 'open' || !this.hasGyrInput || !event) return;
        const { alpha, beta, gamma } = event;
        if (
            !isFiniteNumber(alpha) ||
            !isFiniteNumber(beta) ||
            !isFiniteNumber(gamma)
        )
            return;
        if (this.#unchanged(this.#lastGyr, alpha, beta, gamma)) return;
        if (this.#transport.bufferedAmount('stream') > STREAM_HIGH_WATER)
            return;
        this.#lastGyr = [alpha, beta, gamma];
        this.#seq += 1;
        this.#send(
            {
                type: 'gyr',
                alpha,
                beta,
                gamma,
                seq: this.#seq,
                time: this.#stamp()
            },
            'stream'
        );
    }

    #unchanged(
        last: [number, number, number] | null,
        a: number,
        b: number,
        c: number
    ) {
        const threshold = this.#options.sensorThreshold;
        return (
            last !== null &&
            Math.abs(a - last[0]) < threshold &&
            Math.abs(b - last[1]) < threshold &&
            Math.abs(c - last[2]) < threshold
        );
    }

    #handleDeviceMotion = ({
        accelerationIncludingGravity
    }: DeviceMotionEvent) => {
        if (!accelerationIncludingGravity) return;
        const isAndroid = /Android/i.test(
            globalThis.navigator?.userAgent ?? ''
        );
        this.propagateAcc(accelerationIncludingGravity, isAndroid);
    };

    #handleDeviceOrientation = ({
        alpha,
        beta,
        gamma
    }: DeviceOrientationEvent) => this.propagateGyr({ alpha, beta, gamma });

    /**
     * Listen to this device's motion and orientation, for the axes the DSP
     * uses. On iOS, permission has to have been asked for first, from a user
     * gesture.
     */
    startSensors() {
        if (typeof window === 'undefined') return;
        if (this.hasAccInput)
            window.addEventListener(
                'devicemotion',
                this.#handleDeviceMotion,
                true
            );
        if (this.hasGyrInput)
            window.addEventListener(
                'deviceorientation',
                this.#handleDeviceOrientation,
                true
            );
    }

    stopSensors() {
        if (typeof window === 'undefined') return;
        window.removeEventListener(
            'devicemotion',
            this.#handleDeviceMotion,
            true
        );
        window.removeEventListener(
            'deviceorientation',
            this.#handleDeviceOrientation,
            true
        );
    }

    // ------------------------------------------------------------ the wire

    #open(welcome: FaustRemoteWelcomeMessage) {
        const json = welcome.json ?? this.#options.json;
        if (json === undefined) {
            this.close('no DSP description');
            throw new FaustRemoteError(
                'the host sent no DSP description and none was given',
                'no-json'
            );
        }
        this.#mode = welcome.mode;
        this.#json = json;
        this.#meta = JSON.parse(json) as FaustDspMeta;
        this.#ui = readUI(this.#meta.ui);
        // The host's lists are the authority on indices
        this.#inputs = welcome.inputs;
        this.#inputs.forEach((path, i) => this.#inputIndex.set(path, i));
        for (const item of this.#ui.inputs) this.#items.set(item.address, item);
        this.#inputs.forEach((path, i) =>
            this.#values.set(path, welcome.values[i])
        );
        this.#outputs = welcome.outputs;
        this.#outValues = [...welcome.outputValues];
        this.#voices = welcome.voices;
        this.#group = welcome.group;
        this.#delay = welcome.delay ?? 0;
        this.#setState('open');
        const ping = () => {
            this.#pingSeq += 1;
            this.#send({ type: 'ping', s: this.#pingSeq, t0: now() });
        };
        // Timestamps need the host's clock: a few pings now, and keep pinging
        // to follow the drift, whatever `pingInterval` says
        const interval =
            this.#options.pingInterval > 0
                ? this.#options.pingInterval
                : this.#delay > 0
                  ? 1000
                  : 0;
        if (this.#delay > 0)
            for (let n = 0; n < CLOCK_BURST; n += 1) setTimeout(ping, n * 20);
        if (interval > 0) this.#pingTimer = unref(setInterval(ping, interval));
    }

    #receive(channel: FaustRemoteChannel, text: string) {
        try {
            let message = parseHostMessage(text);
            if (message?.type === 'chunk') {
                const whole = this.#assembler.push(message);
                if (whole === null) return;
                message = parseHostMessage(whole);
                if (message?.type === 'chunk') return;
            }
            if (message) this.#handle(message);
        } catch (error) {
            this.dispatchEvent(new CustomEvent('error', { detail: error }));
        }
    }

    #handle(message: FaustRemoteHostMessage) {
        switch (message.type) {
            case 'welcome':
                if (this.#state === 'connecting') {
                    this.#welcome?.resolve(message);
                    this.#welcome = null;
                }
                return;
            case 'reject':
                this.#welcome?.reject(
                    new FaustRemoteError(message.reason, message.code)
                );
                this.#welcome = null;
                return;
            case 'out': {
                const indices = message.i ?? message.values.map((_, k) => k);
                indices.forEach((k, n) => {
                    if (k >= this.#outputs.length) return;
                    this.#outValues[k] = message.values[n];
                    this.#outputHandler?.(this.#outputs[k], message.values[n]);
                });
                return;
            }
            case 'sync': {
                const path = this.#inputs[message.i];
                if (path === undefined) return;
                this.#values.set(path, message.value);
                this.#inputHandler?.(path, message.value);
                return;
            }
            case 'voices':
                this.#voices = message.count;
                return;
            case 'pong': {
                const t3 = now();
                const rtt = t3 - message.t0 - (message.t2 - message.t1);
                this.#clock.add(message.t0, message.t1, message.t2, t3);
                this.dispatchEvent(new CustomEvent('rtt', { detail: rtt }));
                return;
            }
            case 'bye':
                this.#transport.close(message.reason ?? 'bye');
                this.#closed(message.reason ?? 'bye');
                return;
        }
    }

    #send(
        message: FaustRemoteClientMessage,
        channel: FaustRemoteChannel = 'ctl'
    ) {
        if (this.#state === 'closed') return;
        try {
            this.#transport.send(channel, JSON.stringify(message));
        } catch (error) {
            this.dispatchEvent(new CustomEvent('error', { detail: error }));
        }
    }

    #closed(reason: string) {
        if (this.#state === 'closed') return;
        this.#welcome?.reject(new FaustRemoteError(reason, 'closed'));
        this.#welcome = null;
        if (this.#pingTimer) clearInterval(this.#pingTimer);
        this.#pingTimer = null;
        for (const timer of this.#gestureTimers.values()) clearTimeout(timer);
        this.#gestureTimers.clear();
        this.stopSensors();
        this.#setState('closed');
    }

    #setState(state: FaustRemoteDspState) {
        this.#state = state;
        this.dispatchEvent(new CustomEvent('statechange', { detail: state }));
    }
}

const isFiniteNumber = (x: unknown): x is number =>
    typeof x === 'number' && Number.isFinite(x);
