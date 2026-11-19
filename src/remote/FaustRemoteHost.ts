import type {
    IFaustMonoWebAudioNode,
    InputParamHandler,
    OutputParamHandler
} from '../FaustWebAudioDsp';
import type { FaustUIInputItem } from '../types';
import {
    PROTOCOL_VERSION,
    parseClientMessage,
    randomId,
    sha256Hex,
    splitMessage,
    type FaustRemoteClientMessage,
    type FaustRemoteHelloMessage,
    type FaustRemoteHostMessage,
    type FaustRemoteMode,
    type FaustRemoteRejectCode
} from './protocol';
import { listenRelay, type FaustRelayOptions } from './relay';
import { answerPeers, type FaustRTCOptions } from './rtc';
import type { FaustSignaling } from './signaling';
import type { FaustRemoteChannel, FaustRemoteTransport } from './transport';
import {
    sensorTargets,
    topLevelGroups,
    type Group,
    type SensorTarget
} from './sensors';
import { inputRange, isRemoteOff, readUI } from './ui';

/**
 * What the host needs from a node: every Faust node, mono or polyphonic,
 * AudioWorklet or ScriptProcessor, has it.
 *
 * Only the public node API is used. The host never reaches the processor, so
 * a remote write is, for the audio thread, the same as a local one.
 */
export type FaustRemoteHostTarget = Pick<
    IFaustMonoWebAudioNode,
    | 'getJSON'
    | 'getMeta'
    | 'setParamValue'
    | 'getParamValue'
    | 'setOutputParamHandler'
    | 'getOutputParamHandler'
    | 'setInputParamHandler'
    | 'getInputParamHandler'
    | 'midiMessage'
    | 'propagateAcc'
    | 'propagateGyr'
    | 'hasAccInput'
    | 'hasGyrInput'
> & {
    /** Polyphonic nodes only. */
    getNumActiveVoices?(): number;
    /** The node's context: its clock is what timestamped values are played on. */
    readonly context?: { readonly currentTime: number };
};

/** A remote control, as the host's events and `clients` show it. */
export interface FaustRemoteClientInfo {
    readonly id: string;
    readonly mode: FaustRemoteMode;
    /** The group of controls it was given, with `assign: 'groups'`. */
    readonly group?: string;
}

export interface FaustRemoteHostOptions {
    /** Required in `hello` when set. */
    token?: string;
    /** `uni` imposes the unidirectional mode on every remote control. Default `bi`. */
    mode?: FaustRemoteMode;
    /**
     * `shared`: every remote control writes, the last write wins. `exclusive`:
     * only the remote control that joined first writes; the others watch.
     * Default `shared`.
     */
    policy?: 'shared' | 'exclusive';
    /**
     * Which addresses a given remote control may write. Default: all.
     * `'groups'`: each remote control is given the next top-level group of
     * the DSP that no other one holds, and may write only the controls in
     * it; a remote control that finds none free may write nothing. A group
     * is freed when its remote control leaves.
     */
    assign?:
        | ((client: FaustRemoteClientInfo) => (path: string) => boolean)
        | 'groups';
    /** Which addresses remote controls may write at all. Default: all. */
    expose?: (path: string) => boolean;
    /** Default 16. */
    maxClients?: number;
    /** Most bargraph and parameter updates per second to one remote control. Default 30. */
    outputRate?: number;
    /** Change below which a bargraph is not resent, as a fraction of its range. Default 0.001. */
    outputDeadband?: number;
    /** Milliseconds without a message after which a remote control is dropped. Default 3000. */
    livenessTimeout?: number;
    /** Most messages per second accepted from one remote control. Default 200. */
    maxMessageRate?: number;
    /** Milliseconds during which a write is not echoed to its writer. Default 500. */
    echoWindow?: number;
    /**
     * Seconds by which timestamped values are delayed, so that they are
     * applied as regularly as they were sent, whatever the network did to
     * them in between. `null` (the default) applies every value on arrival.
     * Parameters and MIDI are then applied on the exact sample; sensor
     * readings, which a node cannot schedule, by a timer, to a few ms.
     */
    playoutDelay?: number | null;
    /**
     * What the sensors of several remote controls do to the controls with
     * `[acc:...]` and `[gyr:...]` metadata. `shared` (default): every
     * reading drives every one of them, the latest wins. `mean`: they follow
     * the mean of the remote controls' latest readings (a circular mean for
     * the compass and tilt angles of the gyroscope). `assigned`: each remote
     * control's readings drive only the ones it may write (see `assign`),
     * mapped by the host with the DSP's own curves.
     */
    sensorPolicy?: 'shared' | 'mean' | 'assigned';
    /** Milliseconds a reading counts in the `mean`. Default 1000. */
    sensorWindow?: number;
}

/** `stream` bytes queued past which a remote control is skipped for a tick. */
const STREAM_HIGH_WATER = 4096;

interface Client {
    readonly transport: FaustRemoteTransport;
    info: FaustRemoteClientInfo | null;
    /** Between a valid `hello` and the end. */
    open: boolean;
    helloPending: boolean;
    closing: boolean;
    assigned: (path: string) => boolean;
    /** Last sequence number applied, per key (`p<index>`, `acc`, `gyr`). */
    readonly seqs: Map<string, number>;
    /** Last value written, per input index, and when: the echo filter. */
    readonly written: Map<number, { value: number; at: number }>;
    /** Buttons this remote control holds down. */
    readonly held: Set<number>;
    /** Notes it holds, as `channel << 8 | pitch`. */
    readonly notes: Set<number>;
    /** The latest context time a value of this remote control is scheduled for. */
    lastScheduled: number;
    /** Sensor readings waiting for their time. */
    readonly timers: Set<ReturnType<typeof setTimeout>>;
    /** Its latest readings, sign corrected, for the `mean`. */
    acc: { x: number; y: number; z: number; at: number } | null;
    gyr: { alpha: number; beta: number; gamma: number; at: number } | null;
    /** The group it holds, with `assign: 'groups'`. */
    group: Group | null;
    /** Bargraph values as this remote control last received them. */
    outSent: Float64Array;
    lastMessageAt: number;
    windowStart: number;
    windowCount: number;
}

const now = () => globalThis.performance.now();

/** Do not let a housekeeping timer keep a Node process alive. */
const unref = <T>(timer: T): T => {
    (timer as { unref?: () => void }).unref?.();
    return timer;
};

/**
 * The host side of remote control: puts a node at the disposal of remote
 * controls connected through any `FaustRemoteTransport`.
 *
 * The host is the authority. It accepts only addresses of its own DSP, holds
 * every value to its control's range, and when a remote control goes away
 * releases what it held -- buttons and notes -- so a lost phone cannot leave a
 * note sounding.
 *
 * A node has one output and one input parameter handler. The host chains
 * whatever the page had set before it was created (the page's own UI, say)
 * and gives it back on `close()`. A page that sets a handler after creating
 * the host replaces the host's, which then no longer sees bargraphs or
 * parameter changes; create the host last.
 *
 * Events: `join` and `leave` (`detail`: a `FaustRemoteClientInfo`), `error`
 * (`detail`: the error). Nothing the network does throws into the page.
 */
export class FaustRemoteHost extends EventTarget {
    readonly #node: FaustRemoteHostTarget;
    readonly #options: Required<
        Omit<
            FaustRemoteHostOptions,
            'token' | 'assign' | 'expose' | 'playoutDelay'
        >
    > &
        Pick<
            FaustRemoteHostOptions,
            'token' | 'assign' | 'expose' | 'playoutDelay'
        >;
    /** Controls driven by each sensor, for the `assigned` policy. */
    readonly #accTargets: SensorTarget[];
    readonly #gyrTargets: SensorTarget[];
    /** Top-level groups, for `assign: 'groups'`. */
    readonly #groups: Group[];
    readonly #session = randomId(8);
    readonly #json: string;
    #hash: Promise<string> | null = null;

    readonly #inputs: FaustUIInputItem[];
    /** Inputs the DSP keeps from remote controls, by `[remote:off]`. */
    readonly #remoteOff = new Set<number>();
    /** Whether a remote control's sensor readings may drive anything. */
    readonly #remoteAcc: boolean;
    readonly #remoteGyr: boolean;
    readonly #inputIndex = new Map<string, number>();
    readonly #outputs: string[];
    readonly #outputIndex = new Map<string, number>();
    readonly #outputThreshold: number[];
    readonly #outValues: Float64Array;
    #lastOutFlush = -Infinity;
    #voices = 0;

    readonly #pendingSync = new Map<number, number>();
    #lastSyncFlush = -Infinity;
    #syncTimer: ReturnType<typeof setTimeout> | null = null;

    readonly #clients = new Map<FaustRemoteTransport, Client>();
    #livenessTimer: ReturnType<typeof setInterval> | null = null;
    readonly #listeners: (() => void)[] = [];
    #chunkId = 0;
    #closed = false;

    readonly #previousOutput: OutputParamHandler | null;
    readonly #previousInput: InputParamHandler | null;
    readonly #outputHandler: OutputParamHandler;
    readonly #inputHandler: InputParamHandler;

    constructor(
        node: FaustRemoteHostTarget,
        options: FaustRemoteHostOptions = {}
    ) {
        super();
        this.#node = node;
        this.#options = {
            mode: 'bi',
            policy: 'shared',
            maxClients: 16,
            outputRate: 30,
            outputDeadband: 0.001,
            livenessTimeout: 3000,
            maxMessageRate: 200,
            echoWindow: 500,
            sensorPolicy: 'shared',
            sensorWindow: 1000,
            ...options
        };
        this.#json = node.getJSON();
        const ui = readUI(node.getMeta().ui);
        this.#inputs = ui.inputs;
        ui.inputs.forEach((item, i) => {
            this.#inputIndex.set(item.address, i);
            if (isRemoteOff(item)) this.#remoteOff.add(i);
        });
        // The node applies every sensor mapping at once: a remote reading is
        // only taken while one of the controls it drives is the remote
        // controls' to drive
        this.#remoteAcc = ui.hasAcc;
        this.#remoteGyr = ui.hasGyr;
        const targets = sensorTargets(ui.inputs);
        this.#accTargets = targets.acc;
        this.#gyrTargets = targets.gyr;
        this.#groups = topLevelGroups(node.getMeta().ui);
        this.#outputs = ui.outputs.map((item) => item.address);
        this.#outputs.forEach((path, k) => this.#outputIndex.set(path, k));
        this.#outputThreshold = ui.outputs.map((item) => {
            const range = (item.max ?? 0) - (item.min ?? 0);
            return Number.isFinite(range)
                ? Math.abs(range) * this.#options.outputDeadband
                : 0;
        });
        this.#outValues = new Float64Array(this.#outputs.length);
        this.#voices = node.getNumActiveVoices?.() ?? 0;

        this.#previousOutput = node.getOutputParamHandler();
        this.#previousInput = node.getInputParamHandler();
        const previousOutput = this.#previousOutput;
        const previousInput = this.#previousInput;
        this.#outputHandler = (path, value) => {
            previousOutput?.(path, value);
            this.#onOutput(path, value);
        };
        this.#inputHandler = (path, value) => {
            previousInput?.(path, value);
            this.#onInput(path, value);
        };
        node.setOutputParamHandler(this.#outputHandler);
        node.setInputParamHandler(this.#inputHandler);
    }

    /** The remote controls past their handshake, in the order they joined. */
    get clients(): FaustRemoteClientInfo[] {
        return this.#open().map((client) => client.info!);
    }

    /** Take a remote control on a connection that is already open. */
    /**
     * Change the token a remote control must give in `hello`, for a new
     * session. Remote controls already connected stay connected.
     */
    setToken(token: string | undefined) {
        this.#options.token = token;
    }

    /**
     * Answer the WebRTC offers of remote controls arriving through a
     * signaling channel, and accept each connection that opens. Stops on
     * `close()`, or when the returned function is called (connections
     * already open stay).
     */
    listen(signaling: FaustSignaling, options: FaustRTCOptions = {}) {
        if (this.#closed) return () => {};
        return this.#track(
            answerPeers(
                signaling,
                (transport) => this.accept(transport),
                options,
                (error) => this.#error(error)
            )
        );
    }

    /** Keep a listener's stop for `close()`, and return it, also forgotten when called. */
    #track(stop: () => void) {
        this.#listeners.push(stop);
        return () => {
            const index = this.#listeners.indexOf(stop);
            if (index !== -1) this.#listeners.splice(index, 1);
            stop();
        };
    }

    /**
     * Accept remote controls through the WebSocket relay of the server at
     * `url`, for those that cannot connect over WebRTC. Use it along with
     * `listen`: a remote control tries WebRTC first. Stops on `close()`, or
     * when the returned function is called.
     *
     * @param url - the server's origin, e.g. `location.origin`
     */
    listenRelay(
        url: string,
        room: string,
        token: string,
        options: FaustRelayOptions = {}
    ) {
        if (this.#closed) return () => {};
        return this.#track(
            listenRelay(
                url,
                room,
                token,
                (transport) => this.accept(transport),
                options,
                (error) => this.#error(error)
            )
        );
    }

    accept(transport: FaustRemoteTransport) {
        if (this.#closed) {
            transport.close('host closed');
            return;
        }
        const client: Client = {
            transport,
            info: null,
            open: false,
            helloPending: false,
            closing: false,
            assigned: () => true,
            seqs: new Map(),
            written: new Map(),
            held: new Set(),
            notes: new Set(),
            lastScheduled: -Infinity,
            timers: new Set(),
            acc: null,
            gyr: null,
            group: null,
            outSent: new Float64Array(this.#outputs.length),
            lastMessageAt: now(),
            windowStart: now(),
            windowCount: 0
        };
        this.#clients.set(transport, client);
        transport.onmessage = (channel, text) =>
            this.#receive(client, channel, text);
        transport.onclose = (reason) => this.#drop(client, reason, false);
        if (!this.#livenessTimer) {
            const period = Math.max(50, this.#options.livenessTimeout / 3);
            this.#livenessTimer = unref(
                setInterval(() => this.#checkLiveness(), period)
            );
        }
    }

    /**
     * Say goodbye to every remote control, release what they held, and give
     * the node back the handlers it had. The node keeps running.
     */
    close() {
        if (this.#closed) return;
        this.#closed = true;
        for (const stop of this.#listeners.splice(0)) stop();
        for (const client of [...this.#clients.values()])
            this.#drop(client, 'host closed', true);
        if (this.#livenessTimer) clearInterval(this.#livenessTimer);
        if (this.#syncTimer) clearTimeout(this.#syncTimer);
        this.#livenessTimer = null;
        this.#syncTimer = null;
        // Only if nobody replaced ours in the meantime
        if (this.#node.getOutputParamHandler() === this.#outputHandler)
            this.#node.setOutputParamHandler(this.#previousOutput);
        if (this.#node.getInputParamHandler() === this.#inputHandler)
            this.#node.setInputParamHandler(this.#previousInput);
    }

    // ------------------------------------------------------------ receiving

    #receive(client: Client, channel: FaustRemoteChannel, text: string) {
        try {
            if (client.closing) return;
            const message = parseClientMessage(text);
            if (!message) return;
            const t = now();
            client.lastMessageAt = t;
            if (message.type !== 'bye' && !this.#admit(client, t)) return;
            if (!client.open) {
                if (message.type === 'hello' && !client.helloPending) {
                    client.helloPending = true;
                    this.#hello(client, message).catch((error) =>
                        this.#error(error)
                    );
                } else if (message.type === 'bye') {
                    this.#drop(client, 'bye', false);
                }
                return;
            }
            this.#handle(client, message, t);
        } catch (error) {
            this.#error(error);
        }
    }

    /** The rate limit: whether one more message fits in this second. */
    #admit(client: Client, t: number) {
        if (t - client.windowStart >= 1000) {
            client.windowStart = t;
            client.windowCount = 0;
        }
        client.windowCount += 1;
        return client.windowCount <= this.#options.maxMessageRate;
    }

    async #hello(client: Client, hello: FaustRemoteHelloMessage) {
        const reject = (code: FaustRemoteRejectCode, reason: string) => {
            this.#send(client, { type: 'reject', code, reason });
            this.#drop(client, reason, false);
        };
        if (hello.v !== PROTOCOL_VERSION)
            return reject('version', `protocol ${PROTOCOL_VERSION} expected`);
        if (
            this.#options.token !== undefined &&
            hello.token !== this.#options.token
        )
            return reject('token', 'invalid token');
        if (hello.hash !== undefined) {
            this.#hash ??= sha256Hex(this.#json);
            const hash = await this.#hash;
            if (client.closing || this.#closed) return;
            if (hello.hash !== hash)
                return reject('dsp-mismatch', 'not the DSP this host runs');
        }
        // A remote control coming back replaces its previous session
        for (const other of this.#open()) {
            if (other.info!.id === hello.id)
                this.#drop(other, 'replaced', true);
        }
        if (this.#open().length >= this.#options.maxClients)
            return reject('full', 'too many remote controls');

        let info: FaustRemoteClientInfo = {
            id: hello.id,
            mode: this.#options.mode === 'uni' ? 'uni' : hello.mode
        };
        client.info = info;
        if (this.#options.assign === 'groups') {
            const held = new Set(this.#open().map((other) => other.group));
            const group =
                this.#groups.find((candidate) => !held.has(candidate)) ?? null;
            client.group = group;
            client.info = info = { ...info, group: group?.label };
            client.assigned = (path) => group?.paths.has(path) ?? false;
        } else {
            client.assigned = this.#options.assign?.(info) ?? (() => true);
        }
        client.outSent = Float64Array.from(this.#outValues);
        client.open = true;
        this.#send(client, {
            type: 'welcome',
            v: PROTOCOL_VERSION,
            session: this.#session,
            mode: info.mode,
            json: info.mode === 'bi' ? this.#json : undefined,
            inputs: this.#inputs.map((item) => item.address),
            outputs: this.#outputs,
            values: this.#inputs.map((item) =>
                finite(this.#node.getParamValue(item.address))
            ),
            outputValues: Array.from(this.#outValues),
            voices: this.#voices,
            rates: { out: this.#options.outputRate },
            delay: this.#timed()
                ? this.#options.playoutDelay! * 1000
                : undefined,
            group: client.group?.label,
            sensors: this.#options.sensorPolicy
        });
        this.dispatchEvent(new CustomEvent('join', { detail: info }));
    }

    #handle(client: Client, message: FaustRemoteClientMessage, t: number) {
        switch (message.type) {
            case 'param': {
                const item = this.#inputs[message.i];
                if (!item) return;
                if (this.#remoteOff.has(message.i)) {
                    // Kept from remote controls by the DSP: refused, and the
                    // real value sent back so the writer's control returns
                    this.#send(client, {
                        type: 'sync',
                        i: message.i,
                        value: finite(this.#node.getParamValue(item.address))
                    });
                    return;
                }
                if (!this.#mayWrite(client, item.address)) {
                    // Refused: the real value goes back, so the writer's
                    // control does not stay on a value nothing applied
                    this.#send(client, {
                        type: 'sync',
                        i: message.i,
                        value: finite(this.#node.getParamValue(item.address))
                    });
                    return;
                }
                if (!this.#fresh(client, `p${message.i}`, message.seq)) return;
                const [min, max] = inputRange(item);
                const value = Math.min(max, Math.max(min, message.value));
                // The value asked for, not the one applied: if the two differ,
                // the echo is not filtered and corrects the writer's control
                client.written.set(message.i, { value: message.value, at: t });
                if (item.type === 'button') {
                    if (value !== 0) client.held.add(message.i);
                    else client.held.delete(message.i);
                }
                this.#node.setParamValue(
                    item.address,
                    value,
                    this.#when(client, message.time)
                );
                return;
            }
            case 'acc': {
                if (!this.#remoteAcc || !this.#mayDrive(client)) return;
                if (!this.#fresh(client, 'acc', message.seq)) return;
                const policy = this.#options.sensorPolicy;
                if (policy !== 'assigned' && !this.#node.hasAccInput) return;
                // Android reports the opposite sign: corrected here, once,
                // so that readings of different phones can be combined
                const sign = message.invert ? -1 : 1;
                const x = sign * message.x;
                const y = sign * message.y;
                const z = sign * message.z;
                if (policy === 'assigned') {
                    this.#drive(
                        client,
                        this.#accTargets,
                        [x, y, z],
                        message.time
                    );
                } else if (policy === 'mean') {
                    client.acc = { x, y, z, at: t };
                    const mean = this.#meanAcc(t);
                    this.#later(client, message.time, () =>
                        this.#node.propagateAcc(mean, false)
                    );
                } else {
                    this.#later(client, message.time, () =>
                        this.#node.propagateAcc({ x, y, z }, false)
                    );
                }
                return;
            }
            case 'gyr': {
                if (!this.#remoteGyr || !this.#mayDrive(client)) return;
                if (!this.#fresh(client, 'gyr', message.seq)) return;
                const policy = this.#options.sensorPolicy;
                if (policy !== 'assigned' && !this.#node.hasGyrInput) return;
                const { alpha, beta, gamma } = message;
                if (policy === 'assigned') {
                    this.#drive(
                        client,
                        this.#gyrTargets,
                        [alpha, beta, gamma],
                        message.time
                    );
                } else if (policy === 'mean') {
                    client.gyr = { alpha, beta, gamma, at: t };
                    const mean = this.#meanGyr(t);
                    this.#later(client, message.time, () =>
                        this.#node.propagateGyr(mean)
                    );
                } else {
                    this.#later(client, message.time, () =>
                        this.#node.propagateGyr({ alpha, beta, gamma })
                    );
                }
                return;
            }
            case 'midi': {
                if (!this.#mayDrive(client)) return;
                trackNotes(client.notes, message.data);
                this.#node.midiMessage(
                    message.data,
                    this.#when(client, message.time)
                );
                return;
            }
            case 'ping':
                this.#send(client, {
                    type: 'pong',
                    s: message.s,
                    t0: message.t0,
                    t1: t,
                    t2: now()
                });
                return;
            case 'bye':
                this.#drop(client, message.reason ?? 'bye', false);
                return;
            case 'hello':
                // Already open: a second hello changes nothing
                return;
        }
    }

    #timed() {
        const delay = this.#options.playoutDelay;
        return (
            delay !== null &&
            delay !== undefined &&
            delay > 0 &&
            this.#node.context !== undefined
        );
    }

    /**
     * The context time to apply a timestamped value at: its own moment, as
     * many seconds later as the playout delay says, whatever the network
     * took. Undefined -- now -- without a playout delay, without a timestamp,
     * or when the network took longer than the delay.
     *
     * `time` is in the host's clock (the remote control converted it): the
     * message's age is read against `performance.now()`, and only that age is
     * carried over to the context's clock.
     */
    #when(client: Client, time: number | undefined) {
        if (!this.#timed() || time === undefined) return undefined;
        const context = this.#node.context!;
        const delay = this.#options.playoutDelay!;
        // A stamp a little ahead of now is the clock estimate's error, the
        // same for every message: kept, so the spacing is kept. Bounded, so
        // that no stamp schedules a value more than twice the delay ahead.
        const age = Math.max(-delay, (now() - time) / 1000);
        const at = context.currentTime + delay - age;
        if (at <= context.currentTime) return undefined;
        client.lastScheduled = Math.max(client.lastScheduled, at);
        return at;
    }

    /** Run `apply` at a timestamped value's time, by a timer: for sensor readings. */
    #later(client: Client, time: number | undefined, apply: () => void) {
        const at = this.#when(client, time);
        if (at === undefined) return apply();
        const timer = setTimeout(
            () => {
                client.timers.delete(timer);
                apply();
            },
            (at - this.#node.context!.currentTime) * 1000
        );
        client.timers.add(timer);
    }

    /**
     * The `assigned` policy: map one remote control's reading onto the
     * controls of that sensor it may write, with the DSP's curves, and write
     * them. Not recorded as its writes, so that the echo reaches it: its
     * sliders follow its gesture, as under the other policies.
     */
    #drive(
        client: Client,
        targets: SensorTarget[],
        axes: [number, number, number],
        time: number | undefined
    ) {
        for (const target of targets) {
            if (!this.#mayWrite(client, target.path)) continue;
            this.#node.setParamValue(
                target.path,
                target.convert(axes[target.axis]),
                this.#when(client, time)
            );
        }
    }

    /** The mean of the accelerometer readings of the last `sensorWindow` ms. */
    #meanAcc(t: number) {
        const recent = this.#open()
            .map((client) => client.acc)
            .filter(
                (acc): acc is NonNullable<Client['acc']> =>
                    acc !== null && t - acc.at <= this.#options.sensorWindow
            );
        const mean = (key: 'x' | 'y' | 'z') =>
            recent.reduce((sum, acc) => sum + acc[key], 0) / recent.length;
        return { x: mean('x'), y: mean('y'), z: mean('z') };
    }

    /**
     * The mean of the gyroscope readings of the last `sensorWindow` ms:
     * circular for alpha (compass, 0 to 360) and beta (-180 to 180), where
     * 350 and 10 average to 0, not 180; plain for gamma (-90 to 90).
     */
    #meanGyr(t: number) {
        const recent = this.#open()
            .map((client) => client.gyr)
            .filter(
                (gyr): gyr is NonNullable<Client['gyr']> =>
                    gyr !== null && t - gyr.at <= this.#options.sensorWindow
            );
        const circular = (key: 'alpha' | 'beta') => {
            let sin = 0;
            let cos = 0;
            for (const gyr of recent) {
                sin += Math.sin((gyr[key] * Math.PI) / 180);
                cos += Math.cos((gyr[key] * Math.PI) / 180);
            }
            return (Math.atan2(sin, cos) * 180) / Math.PI;
        };
        const alpha = (circular('alpha') + 360) % 360;
        const gamma =
            recent.reduce((sum, gyr) => sum + gyr.gamma, 0) / recent.length;
        return { alpha, beta: circular('beta'), gamma };
    }

    /** `exclusive`: only the first remote control to have joined drives. */
    #mayDrive(client: Client) {
        return (
            this.#options.policy !== 'exclusive' || this.#open()[0] === client
        );
    }

    #mayWrite(client: Client, path: string) {
        return (
            this.#mayDrive(client) &&
            (this.#options.expose?.(path) ?? true) &&
            client.assigned(path)
        );
    }

    /**
     * Whether a message is newer than the last one applied for its key.
     *
     * Equal is fresh: the last value of a gesture is sent again on the
     * reliable channel under the sequence number it had on the other one.
     */
    #fresh(client: Client, key: string, seq: number | undefined) {
        if (seq === undefined) return true;
        const last = client.seqs.get(key);
        if (last !== undefined && seq < last) return false;
        client.seqs.set(key, seq);
        return true;
    }

    // -------------------------------------------------------------- sending

    #onOutput(path: string, value: number) {
        const k = this.#outputIndex.get(path);
        if (k === undefined || !Number.isFinite(value)) return;
        this.#outValues[k] = value;
        const t = now();
        if (t - this.#lastOutFlush < 1000 / this.#options.outputRate) return;
        this.#lastOutFlush = t;
        for (const client of this.#open()) {
            if (client.info!.mode !== 'bi') continue;
            this.#flushOutputs(client);
        }
        const voices = this.#node.getNumActiveVoices?.();
        if (voices !== undefined && voices !== this.#voices) {
            this.#voices = voices;
            this.#broadcast({ type: 'voices', count: voices });
        }
    }

    #flushOutputs(client: Client) {
        // Skipped, not queued: what is not sent now goes with the next tick,
        // compared against what this remote control last received
        if (client.transport.bufferedAmount('stream') > STREAM_HIGH_WATER)
            return;
        const changed: number[] = [];
        this.#outValues.forEach((value, k) => {
            // Written so that a NaN never compares as "unchanged"
            if (
                !(
                    Math.abs(value - client.outSent[k]) <=
                    this.#outputThreshold[k]
                )
            )
                changed.push(k);
        });
        if (changed.length === 0) return;
        changed.forEach((k) => (client.outSent[k] = this.#outValues[k]));
        // Entries a message can hold at the most a number and an index take
        const perMessage = Math.max(
            1,
            Math.floor((client.transport.maxMessageSize - 64) / 48)
        );
        if (
            changed.length === this.#outputs.length &&
            changed.length <= perMessage
        ) {
            this.#send(
                client,
                { type: 'out', values: Array.from(this.#outValues) },
                'stream'
            );
            return;
        }
        for (let start = 0; start < changed.length; start += perMessage) {
            const i = changed.slice(start, start + perMessage);
            this.#send(
                client,
                { type: 'out', i, values: i.map((k) => this.#outValues[k]) },
                'stream'
            );
        }
    }

    #onInput(path: string, value: number) {
        const i = this.#inputIndex.get(path);
        if (i === undefined || !Number.isFinite(value)) return;
        this.#pendingSync.set(i, value);
        if (this.#syncTimer) return;
        const wait =
            1000 / this.#options.outputRate - (now() - this.#lastSyncFlush);
        if (wait <= 0) this.#flushSync();
        else
            this.#syncTimer = unref(
                setTimeout(() => {
                    this.#syncTimer = null;
                    this.#flushSync();
                }, wait)
            );
    }

    #flushSync() {
        const t = now();
        this.#lastSyncFlush = t;
        const pending = [...this.#pendingSync];
        this.#pendingSync.clear();
        for (const client of this.#open()) {
            if (client.info!.mode !== 'bi') continue;
            for (const [i, value] of pending) {
                // Do not send a writer its own write back while it may still
                // be moving the control: its slider would jump backwards
                const written = client.written.get(i);
                if (
                    written &&
                    t - written.at < this.#options.echoWindow &&
                    Math.fround(written.value) === Math.fround(value)
                )
                    continue;
                this.#send(client, { type: 'sync', i, value });
            }
        }
    }

    #broadcast(message: FaustRemoteHostMessage) {
        for (const client of this.#open()) {
            if (client.info!.mode === 'bi') this.#send(client, message);
        }
    }

    #send(
        client: Client,
        message: FaustRemoteHostMessage,
        channel: FaustRemoteChannel = 'ctl'
    ) {
        if (client.closing) return;
        const text = JSON.stringify(message);
        try {
            if (channel === 'stream') {
                client.transport.send('stream', text);
            } else {
                this.#chunkId += 1;
                for (const chunk of splitMessage(
                    text,
                    client.transport.maxMessageSize,
                    this.#chunkId
                ))
                    client.transport.send('ctl', chunk);
            }
        } catch (error) {
            this.#error(error);
            this.#drop(client, 'send failed', false);
        }
    }

    // ------------------------------------------------------------ the end

    #checkLiveness() {
        const t = now();
        for (const client of [...this.#clients.values()]) {
            if (t - client.lastMessageAt > this.#options.livenessTimeout)
                this.#drop(client, 'timeout', true);
        }
    }

    /**
     * Release what a remote control held, then forget it.
     *
     * A button goes back to 0 unless another remote control holds it too, and
     * every note it started and did not end is ended.
     */
    #drop(client: Client, reason: string, sayBye: boolean) {
        if (client.closing) return;
        for (const timer of client.timers) clearTimeout(timer);
        client.timers.clear();
        if (client.open) {
            // After whatever of this remote control is still scheduled: a
            // release played before the press it releases would leave the
            // note on
            const currentTime = this.#node.context?.currentTime ?? 0;
            const after =
                client.lastScheduled > currentTime
                    ? client.lastScheduled + 0.001
                    : undefined;
            for (const i of client.held) {
                const heldElsewhere = this.#open().some(
                    (other) => other !== client && other.held.has(i)
                );
                if (!heldElsewhere)
                    this.#node.setParamValue(this.#inputs[i].address, 0, after);
            }
            for (const note of client.notes)
                this.#node.midiMessage(
                    [0x80 | (note >> 8), note & 0x7f, 0],
                    after
                );
            client.held.clear();
            client.notes.clear();
        }
        if (sayBye) this.#send(client, { type: 'bye', reason });
        client.closing = true;
        const wasOpen = client.open;
        client.open = false;
        this.#clients.delete(client.transport);
        client.transport.close(reason);
        if (this.#clients.size === 0 && this.#livenessTimer) {
            clearInterval(this.#livenessTimer);
            this.#livenessTimer = null;
        }
        if (wasOpen)
            this.dispatchEvent(
                new CustomEvent('leave', { detail: client.info })
            );
    }

    #open() {
        return [...this.#clients.values()].filter((client) => client.open);
    }

    #error(error: unknown) {
        this.dispatchEvent(new CustomEvent('error', { detail: error }));
    }
}

const finite = (value: number) => (Number.isFinite(value) ? value : 0);

/** Keep the set of notes a remote control holds in step with its MIDI. */
const trackNotes = (notes: Set<number>, data: number[]) => {
    const [status, a, b] = data;
    const kind = status & 0xf0;
    const channel = status & 0x0f;
    if (kind === 0x90 && b > 0) notes.add((channel << 8) | a);
    else if (kind === 0x80 || kind === 0x90) notes.delete((channel << 8) | a);
    else if (kind === 0xb0 && (a === 120 || a === 123)) {
        for (const note of notes) if (note >> 8 === channel) notes.delete(note);
    }
};
