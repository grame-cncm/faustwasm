import type {
    IFaustMonoWebAudioNode,
    InputParamHandler,
    OutputParamHandler
} from '../FaustWebAudioDsp';
import {
    FaustRemoteError,
    type FaustRemoteDsp,
    type IFaustRemoteControl
} from './FaustRemoteDsp';
import { sensorTargets, topLevelGroups, type SensorTarget } from './sensors';
import { readUI } from './ui';

/**
 * What the bridge needs from the local node: every Faust node has it.
 * `getParams`, when there, is what tells that the node runs the host's DSP.
 */
export type FaustLocalNode = Pick<
    IFaustMonoWebAudioNode,
    | 'setParamValue'
    | 'getParamValue'
    | 'setOutputParamHandler'
    | 'setInputParamHandler'
    | 'midiMessage'
> &
    Partial<Pick<IFaustMonoWebAudioNode, 'getParams'>>;

const isFiniteNumber = (x: unknown): x is number =>
    typeof x === 'number' && Number.isFinite(x);

/**
 * A remote control that also plays the DSP itself: a local Faust node, with
 * its own sound, kept in step with the host.
 *
 * It has the control part of a node's API, so a UI is built on it as on a
 * node, and what the UI shows is the local node's state -- what one hears:
 * - a change made here goes to the local node at once, then to the host, so
 *   one hears oneself with no network delay;
 * - a change made elsewhere (on the host, by another remote control, or the
 *   host's correction of a refused change) reaches the local node;
 * - bargraphs come from the local node's own computation;
 * - this phone's sensors drive the local node at once, with the DSP's own
 *   curves, on the controls that are this phone's to drive: all of them
 *   under the host's `shared` sensor policy, those of its group under
 *   `assigned` with `assign: 'groups'`, none under `mean`, where the right
 *   value is the host's mean. Values coming back for those controls are
 *   then ignored, so the two do not fight over them. The readings also go
 *   to the host, as without local sound.
 *
 * The local sound is the DSP computed here with the host's settings, not
 * the host's sound: oscillators are not in phase, noises differ, and a
 * change made elsewhere is heard a network delay later. See section
 * 19 of `docs/remote-control.md`.
 */
export class FaustLocalSound implements IFaustRemoteControl {
    readonly #dsp: FaustRemoteDsp;
    readonly #node: FaustLocalNode;
    readonly #aliases: Record<string, string>;
    readonly #localAcc: SensorTarget[];
    readonly #localGyr: SensorTarget[];
    /** Controls this phone's sensors have driven here: theirs from now on. */
    readonly #local = new Set<string>();
    #outputHandler: OutputParamHandler | null = null;
    #inputHandler: InputParamHandler | null = null;

    /**
     * @param dsp - a connected remote control
     * @param node - a node of the same DSP, playing on this device
     * @throws FaustRemoteError (`dsp-mismatch`) if the node lacks controls
     *   the host has: it plays another DSP (files served for another one
     *   than the host runs), and would sound nothing like the host. Nothing
     *   is done to the node or the remote control then.
     */
    constructor(dsp: FaustRemoteDsp, node: FaustLocalNode) {
        const local = node.getParams?.();
        if (local) {
            const here = new Set(local);
            const missing = dsp.getParams().filter((path) => !here.has(path));
            if (missing.length > 0)
                throw new FaustRemoteError(
                    `the DSP that would play here is not the one the host runs: ${missing.length} of the host's controls are missing here (${missing[0]}${missing.length > 1 ? ', ...' : ''})`,
                    'dsp-mismatch'
                );
        }
        this.#dsp = dsp;
        this.#node = node;
        const ui = readUI(dsp.getUI());
        this.#aliases = ui.aliases;

        // Which sensor controls are this phone's to drive here
        const targets = sensorTargets(ui.inputs);
        let mine: (path: string) => boolean = () => true;
        if (dsp.sensorPolicy === 'mean') {
            mine = () => false;
        } else if (dsp.sensorPolicy === 'assigned') {
            const group = topLevelGroups(dsp.getUI()).find(
                (candidate) => candidate.label === dsp.group
            );
            mine = group ? (path) => group.paths.has(path) : () => false;
        }
        this.#localAcc = targets.acc.filter((target) => mine(target.path));
        this.#localGyr = targets.gyr.filter((target) => mine(target.path));

        // The local DSP starts from the host's state
        for (const path of dsp.getParams())
            node.setParamValue(path, dsp.getParamValue(path));
        // The UI shows what the local DSP does
        node.setOutputParamHandler((path, value) =>
            this.#outputHandler?.(path, value)
        );
        node.setInputParamHandler((path, value) =>
            this.#inputHandler?.(path, value)
        );
        // Changes made elsewhere reach the local DSP; the host's bargraphs
        // are not needed, the local DSP computes its own
        dsp.setOutputParamHandler(null);
        dsp.setInputParamHandler((path, value) => {
            if (!this.#local.has(path)) node.setParamValue(path, value);
        });
    }

    /** Detach from the remote control and the node; both keep running. */
    close() {
        this.stopSensors();
        this.#node.setOutputParamHandler(null);
        this.#node.setInputParamHandler(null);
        this.#dsp.setInputParamHandler(null);
    }

    // ---------------------------------------------------------- parameters

    setParamValue(path: string, value: number) {
        const address = this.#aliases[path] ?? path;
        if (!Number.isFinite(value)) return;
        // Heard at once; the host may still refuse it, and its correction
        // then comes back to the local node
        this.#node.setParamValue(address, value);
        this.#dsp.setParamValue(address, value);
    }
    getParamValue(path: string) {
        return this.#node.getParamValue(this.#aliases[path] ?? path);
    }
    getParams() {
        return this.#dsp.getParams();
    }
    getMeta() {
        return this.#dsp.getMeta();
    }
    getUI() {
        return this.#dsp.getUI();
    }
    getJSON() {
        return this.#dsp.getJSON();
    }
    getDescriptors() {
        return this.#dsp.getDescriptors();
    }

    setOutputParamHandler(handler: OutputParamHandler | null) {
        this.#outputHandler = handler;
    }
    getOutputParamHandler() {
        return this.#outputHandler;
    }
    callOutputParamHandler(path: string, value: number) {
        this.#outputHandler?.(path, value);
    }
    setInputParamHandler(handler: InputParamHandler | null) {
        this.#inputHandler = handler;
    }
    getInputParamHandler() {
        return this.#inputHandler;
    }
    callInputParamHandler(path: string, value: number) {
        this.#inputHandler?.(path, value);
    }

    // ----------------------------------------------------------------- MIDI

    midiMessage(data: number[] | Uint8Array) {
        this.#node.midiMessage(data);
        this.#dsp.midiMessage(data);
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
        return this.#dsp.hasAccInput;
    }
    get hasGyrInput() {
        return this.#dsp.hasGyrInput;
    }

    /** Drive the local node with this phone's own reading, then send it. */
    propagateAcc(
        accelerationIncludingGravity: NonNullable<
            DeviceMotionEvent['accelerationIncludingGravity']
        >,
        invert = false
    ) {
        if (!accelerationIncludingGravity) return;
        const { x, y, z } = accelerationIncludingGravity;
        if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(z))
            return;
        // Android reports the opposite sign
        const sign = invert ? -1 : 1;
        this.#drive(this.#localAcc, [sign * x, sign * y, sign * z]);
        this.#dsp.propagateAcc(accelerationIncludingGravity, invert);
    }

    /** See `propagateAcc`. */
    propagateGyr(
        event: Pick<DeviceOrientationEvent, 'alpha' | 'beta' | 'gamma'>
    ) {
        if (!event) return;
        const { alpha, beta, gamma } = event;
        if (
            !isFiniteNumber(alpha) ||
            !isFiniteNumber(beta) ||
            !isFiniteNumber(gamma)
        )
            return;
        this.#drive(this.#localGyr, [alpha, beta, gamma]);
        this.#dsp.propagateGyr(event);
    }

    #drive(targets: SensorTarget[], axes: [number, number, number]) {
        for (const target of targets) {
            this.#local.add(target.path);
            this.#node.setParamValue(
                target.path,
                target.convert(axes[target.axis])
            );
        }
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
     * gesture. Do not also call the remote control's own `startSensors`:
     * each reading would be sent twice.
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
}
