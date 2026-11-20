import type {
    InputParamHandler,
    OutputParamHandler
} from '../FaustWebAudioDsp';
import type { FaustDspMeta } from '../types';
import type { FaustRemoteHostTarget } from './FaustRemoteHost';
import { now } from './runtime';
import { sensorTargets, type SensorTarget } from './sensors';
import { readUI } from './ui';

export interface FaustRemoteHubOptions {
    /**
     * A parameter written through the hub: by a remote control, by sensors,
     * or by `setParamValue`. Where the hub forwards it to whatever really
     * runs the DSP (a `faustgen~` in a Max patch, say). Not called for
     * `update`, which reports a change made there.
     */
    onwrite?: (path: string, value: number) => void;
    /** A MIDI message from a remote control, to forward the same way. */
    onmidi?: (data: number[]) => void;
}

const isFiniteNumber = (x: unknown): x is number =>
    typeof x === 'number' && Number.isFinite(x);

/**
 * A host target without a DSP: what `FaustRemoteHost` needs from a node,
 * built from a DSP's JSON alone, for when the DSP runs somewhere the host
 * cannot reach as a Web Audio node -- a Max patch, another process, or
 * nowhere at all (phones playing the DSP themselves, section 19.5 of
 * `docs/remote-control.md`).
 *
 * It keeps the value of every input, and reports in both directions:
 * - a write coming through it (`setParamValue`, sensors, a remote control
 *   through the host) is stored, handed to `onwrite`, then to the input
 *   handler, as a node reports its own changes, so that the host passes it
 *   on to the other remote controls;
 * - a change made where the DSP runs comes in through `update` (stored, then
 *   the input handler, not `onwrite`), and a bargraph value through
 *   `output` (the output handler).
 *
 * Sensor readings are mapped with the DSP's own curves, as a node does,
 * except that a control marked `[remote:off]` is never driven by them. A
 * timestamped write (the host's timed mode) is applied by a timer, to a
 * millisecond or so: the hub's `context` is a clock, not an audio context.
 */
export class FaustRemoteHub implements FaustRemoteHostTarget {
    readonly #json: string;
    readonly #meta: FaustDspMeta;
    readonly #values = new Map<string, number>();
    readonly #acc: SensorTarget[];
    readonly #gyr: SensorTarget[];
    readonly #options: FaustRemoteHubOptions;
    readonly #timers = new Set<ReturnType<typeof setTimeout>>();
    #outputHandler: OutputParamHandler | null = null;
    #inputHandler: InputParamHandler | null = null;

    /** Seconds, on the same clock as the host's timestamps. */
    readonly context = {
        get currentTime() {
            return now() / 1000;
        }
    };

    /**
     * @param json - the DSP's JSON, as `faust -json` or a factory gives it
     */
    constructor(json: string, options: FaustRemoteHubOptions = {}) {
        this.#json = json;
        this.#meta = JSON.parse(json);
        this.#options = options;
        const ui = readUI(this.#meta.ui);
        for (const item of ui.inputs)
            this.#values.set(item.address, item.init ?? 0);
        for (const item of ui.outputs) this.#values.set(item.address, 0);
        const targets = sensorTargets(ui.inputs);
        this.#acc = targets.acc;
        this.#gyr = targets.gyr;
    }

    getJSON() {
        return this.#json;
    }
    getMeta() {
        return this.#meta;
    }
    /** The input addresses, in UI order. */
    getParams() {
        return readUI(this.#meta.ui).inputs.map((item) => item.address);
    }

    /**
     * Write a parameter, now or at `time` (seconds on `context`): stored,
     * given to `onwrite`, then reported to the input handler.
     */
    setParamValue(path: string, value: number, time?: number) {
        if (!this.#values.has(path) || !isFiniteNumber(value)) return;
        const apply = () => {
            this.#values.set(path, value);
            this.#options.onwrite?.(path, value);
            this.#inputHandler?.(path, value);
        };
        this.#at(time, apply);
    }

    getParamValue(path: string) {
        return this.#values.get(path) ?? 0;
    }

    /**
     * A change made where the DSP runs (a slider in the patch, a preset):
     * stored and reported to the input handler, so that remote controls
     * follow it; not given back to `onwrite`.
     */
    update(path: string, value: number) {
        if (!this.#values.has(path) || !isFiniteNumber(value)) return;
        this.#values.set(path, value);
        this.#inputHandler?.(path, value);
    }

    /** A bargraph value computed where the DSP runs. */
    output(path: string, value: number) {
        if (!this.#values.has(path) || !isFiniteNumber(value)) return;
        this.#values.set(path, value);
        this.#outputHandler?.(path, value);
    }

    setOutputParamHandler(handler: OutputParamHandler | null) {
        this.#outputHandler = handler;
    }
    getOutputParamHandler() {
        return this.#outputHandler;
    }
    setInputParamHandler(handler: InputParamHandler | null) {
        this.#inputHandler = handler;
    }
    getInputParamHandler() {
        return this.#inputHandler;
    }

    /** A MIDI message, now or at `time`, handed to `onmidi`. */
    midiMessage(data: number[] | Uint8Array, time?: number) {
        const message = Array.from(data);
        this.#at(time, () => this.#options.onmidi?.(message));
    }

    get hasAccInput() {
        return this.#acc.length > 0;
    }
    get hasGyrInput() {
        return this.#gyr.length > 0;
    }

    propagateAcc(
        accelerationIncludingGravity: NonNullable<
            DeviceMotionEvent['accelerationIncludingGravity']
        >,
        invert = false
    ) {
        const { x, y, z } = accelerationIncludingGravity;
        const sign = invert ? -1 : 1;
        this.#drive(this.#acc, [x, y, z], sign);
    }

    propagateGyr(
        event: Pick<DeviceOrientationEvent, 'alpha' | 'beta' | 'gamma'>
    ) {
        this.#drive(this.#gyr, [event.alpha, event.beta, event.gamma], 1);
    }

    #drive(
        targets: SensorTarget[],
        axes: (number | null | undefined)[],
        sign: number
    ) {
        for (const target of targets) {
            const value = axes[target.axis];
            if (isFiniteNumber(value))
                this.setParamValue(target.path, target.convert(sign * value));
        }
    }

    #at(time: number | undefined, apply: () => void) {
        const delay =
            time === undefined ? 0 : (time - this.context.currentTime) * 1000;
        if (!(delay > 0)) return apply();
        const timer = setTimeout(() => {
            this.#timers.delete(timer);
            apply();
        }, delay);
        this.#timers.add(timer);
    }

    /** Cancel the timestamped writes still waiting. */
    close() {
        for (const timer of this.#timers) clearTimeout(timer);
        this.#timers.clear();
    }
}
