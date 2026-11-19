/**
 * Fakes shared by the remote control tests: a DSP description, and a node
 * that records what a host asks of it.
 */

/** A DSP description: two sliders, one per sensor, a button and a bargraph. */
export const describe = (name = 't') => ({
    name,
    filename: `${name}.dsp`,
    compile_options: '',
    include_pathnames: [],
    inputs: 0,
    outputs: 1,
    size: 0,
    version: '2.94.0',
    library_list: [],
    meta: [],
    ui: [
        {
            type: 'vgroup',
            label: name,
            items: [
                {
                    type: 'hslider',
                    label: 'freq',
                    shortname: 'freq',
                    address: `/${name}/freq`,
                    url: '',
                    index: 0,
                    init: 440,
                    min: 20,
                    max: 2000,
                    step: 1
                },
                {
                    type: 'button',
                    label: 'gate',
                    shortname: 'gate',
                    address: `/${name}/gate`,
                    url: '',
                    index: 4
                },
                {
                    type: 'hslider',
                    label: 'tilt',
                    shortname: 'tilt',
                    address: `/${name}/tilt`,
                    url: '',
                    index: 8,
                    init: 0,
                    min: 0,
                    max: 1,
                    step: 0.01,
                    meta: [{ acc: '0 0 -10 0 10' }]
                },
                {
                    type: 'hslider',
                    label: 'turn',
                    shortname: 'turn',
                    address: `/${name}/turn`,
                    url: '',
                    index: 12,
                    init: 0,
                    min: 0,
                    max: 1,
                    step: 0.01,
                    meta: [{ gyr: '0 0 -90 0 90' }]
                },
                {
                    type: 'hbargraph',
                    label: 'level',
                    shortname: 'level',
                    address: `/${name}/level`,
                    index: 16,
                    min: 0,
                    max: 1
                }
            ]
        }
    ]
});
export const JSON_TEXT = JSON.stringify(describe());
export const FREQ = '/t/freq';
export const GATE = '/t/gate';
export const LEVEL = '/t/level';

/**
 * The node API the host uses, recording every call.
 *
 * `setParamValue` calls the input handler afterwards with the float32 value,
 * as the DSP does once it has applied a write: that echo is what the host's
 * parameter synchronisation feeds on.
 */
export class FakeNode {
    constructor(json = JSON_TEXT) {
        this.json = json;
        this.meta = JSON.parse(json);
        /** @type {Map<string, number>} */
        this.values = new Map([[FREQ, 440]]);
        /** @type {[string, number][]} */
        this.writes = [];
        /** @type {number[][]} */
        this.midi = [];
        /** @type {[number, number, number, boolean][]} */
        this.acc = [];
        /** @type {[number, number, number][]} */
        this.gyr = [];
        this.hasAccInput = true;
        this.hasGyrInput = true;
        this.voices = 0;
        /** @type {((path: string, value: number) => void) | null} */
        this.outputHandler = null;
        /** @type {((path: string, value: number) => void) | null} */
        this.inputHandler = null;
    }
    getJSON() {
        return this.json;
    }
    getMeta() {
        return this.meta;
    }
    /** @param {string} path @param {number} value */
    setParamValue(path, value) {
        this.writes.push([path, value]);
        this.values.set(path, value);
        this.inputHandler?.(path, Math.fround(value));
    }
    /** @param {string} path */
    getParamValue(path) {
        return this.values.get(path) ?? 0;
    }
    setOutputParamHandler(handler) {
        this.outputHandler = handler;
    }
    getOutputParamHandler() {
        return this.outputHandler;
    }
    setInputParamHandler(handler) {
        this.inputHandler = handler;
    }
    getInputParamHandler() {
        return this.inputHandler;
    }
    /** @param {number[] | Uint8Array} data */
    midiMessage(data) {
        this.midi.push(Array.from(data));
    }
    propagateAcc({ x, y, z }, invert) {
        this.acc.push([x, y, z, invert]);
    }
    propagateGyr({ alpha, beta, gamma }) {
        this.gyr.push([alpha, beta, gamma]);
    }
    getNumActiveVoices() {
        return this.voices;
    }
    /** A bargraph tick, as the DSP produces one every few blocks. */
    emit(path, value) {
        this.outputHandler?.(path, value);
    }
    /** The writes that reached a path, in order. */
    writesTo(path) {
        return this.writes.filter(([p]) => p === path).map(([, v]) => v);
    }
}
