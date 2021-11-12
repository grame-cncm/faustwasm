//@ts-check
/**
 * @typedef {import("./types").FaustDspDistribution} FaustDspDistribution
 * @typedef {import("./types").FaustUIDescriptor} FaustUIDescriptor
 * @typedef {import("./types").IFaustUIGroup} IFaustUIGroup
 * @typedef {import("./types").IFaustUIItem} IFaustUIItem
 */

/**
 * @param {number} v
 * @param {number} mn0
 * @param {number} mx0
 * @param {number} mn1
 * @param {number} mx1
 */
const remap = (v, mn0, mx0, mn1, mx1) => (v - mn0) / (mx0 - mn0) * (mx1 - mn1) + mn1;

class FaustNode extends AudioWorkletNode {
    /**
     * @param {BaseAudioContext} context
     * @param {string} name
     * @param {FaustDspDistribution} faustDsp
     * @param {number} [voices]
     */
    constructor(context, name, faustDsp, voices = 0) {
        super(context, name, {
            numberOfInputs: 1,
            numberOfOutputs: 1,
            channelCount: Math.max(1, faustDsp.dspMeta.inputs),
            outputChannelCount: [faustDsp.dspMeta.outputs],
            channelCountMode: "explicit",
            channelInterpretation: "speakers",
            processorOptions: {
                dspModule: faustDsp.dspModule,
                effectModule: faustDsp.effectModule,
                mixerModule: faustDsp.mixerModule
            }
        });

        // Patch it with additional functions
        /**
         * @param {MessageEvent} e
         */
        this.port.onmessage = (e) => {
            if (e.data.type === "param" && this.outputHandler) {
                this.outputHandler(e.data.path, e.data.value);
            }
        };
        this.voices = voices;
        this.dspMeta = faustDsp.dspMeta;
        this.effectMeta = faustDsp.effectMeta;
        this.outputHandler = null;
        /** @type {string[]} */
        this.inputsItems = [];
        /** @type {string[]} */
        this.outputsItems = [];
        /** @type {{ path: string; min: number; max: number }[]} */
        this.fPitchwheelLabel = [];
        /** @type {{ path: string; min: number; max: number }[][]} */
        this.fCtrlLabel = new Array(128).fill(null).map(() => []);
        this.parseUI(this.dspMeta.ui);
        if (this.effectMeta) this.parseUI(this.effectMeta.ui);
        try {
            if (this.parameters) this.parameters.forEach(p => p.automationRate = "k-rate");
        } catch (e) {} // eslint-disable-line no-empty
    }
    /**
     * @param {FaustUIDescriptor} ui
     */
    parseUI(ui) {
        ui.forEach(group => this.parseGroup(group));
    }
    /**
     * @param {IFaustUIGroup} group
     */
    parseGroup(group) {
        if (group.items) this.parseItems(group.items);
    }
    /**
     * @param {IFaustUIItem[]} items
     */
    parseItems(items) {
        items.forEach(item => this.parseItem(item));
    }
    /**
     * @param {IFaustUIItem} item
     */
    parseItem(item) {
        if (item.type === "vgroup" || item.type === "hgroup" || item.type === "tgroup") {
            this.parseItems(item.items);
        } else if (item.type === "hbargraph" || item.type === "vbargraph") {
            // Keep bargraph adresses
            this.outputsItems.push(item.address);
        } else if (item.type === "vslider" || item.type === "hslider" || item.type === "button" || item.type === "checkbox" || item.type === "nentry") {
            // Keep inputs adresses
            this.inputsItems.push(item.address);
            if (!item.meta) return;
            item.meta.forEach((meta) => {
                const { midi } = meta;
                if (!midi) return;
                const strMidi = midi.trim();
                if (strMidi === "pitchwheel") {
                    this.fPitchwheelLabel.push({ path: item.address, min: item.min, max: item.max });
                } else {
                    const matched = strMidi.match(/^ctrl\s(\d+)/);
                    if (!matched) return;
                    this.fCtrlLabel[parseInt(matched[1])].push({ path: item.address, min: item.min, max: item.max });
                }
            });
        }
    }
    /**
     * Instantiates a new polyphonic voice.
     *
     * @param {number} channel - the MIDI channel (0..15, not used for now)
     * @param {number} pitch - the MIDI pitch (0..127)
     * @param {number} velocity - the MIDI velocity (0..127)
     * @memberof FaustAudioWorkletNode
     */
    keyOn(channel, pitch, velocity) {
        const e = { type: "keyOn", data: [channel, pitch, velocity] };
        this.port.postMessage(e);
    }
    /**
     * De-instantiates a polyphonic voice.
     *
     * @param {number} channel - the MIDI channel (0..15, not used for now)
     * @param {number} pitch - the MIDI pitch (0..127)
     * @param {number} velocity - the MIDI velocity (0..127)
     * @memberof FaustAudioWorkletNode
     */
    keyOff(channel, pitch, velocity) {
        const e = { type: "keyOff", data: [channel, pitch, velocity] };
        this.port.postMessage(e);
    }
    /**
     * Gently terminates all the active voices.
     *
     * @memberof FaustAudioWorkletNode
     */
    allNotesOff() {
        const e = { type: "ctrlChange", data: [0, 123, 0] };
        this.port.postMessage(e);
    }
    /**
     * @param {number} channel
     * @param {number} ctrlIn
     * @param {number} valueIn
     */
    ctrlChange(channel, ctrlIn, valueIn) {
        const e = { type: "ctrlChange", data: [channel, ctrlIn, valueIn] };
        this.port.postMessage(e);
        if (!this.fCtrlLabel[ctrlIn].length) return;
        this.fCtrlLabel[ctrlIn].forEach((ctrl) => {
            const { path } = ctrl;
            const value = remap(valueIn, 0, 127, ctrl.min, ctrl.max);
            const param = this.parameters.get(path);
            if (param) param.setValueAtTime(value, this.context.currentTime);
        });
    }
    /**
     * @param {number} channel
     * @param {number} wheel
     */
    pitchWheel(channel, wheel) {
        const e = { type: "pitchWheel", data: [channel, wheel] };
        this.port.postMessage(e);
        this.fPitchwheelLabel.forEach((pw) => {
            const { path } = pw;
            const value = remap(wheel, 0, 16383, pw.min, pw.max);
            const param = this.parameters.get(path);
            if (param) param.setValueAtTime(value, this.context.currentTime);
        });
    }
    /**
     * @param {number[] | Uint8Array} data
     */
    midiMessage(data) {
        const cmd = data[0] >> 4;
        const channel = data[0] & 0xf;
        const data1 = data[1];
        const data2 = data[2];
        if (channel === 9) return;
        if (cmd === 8 || (cmd === 9 && data2 === 0)) this.keyOff(channel, data1, data2);
        else if (cmd === 9) this.keyOn(channel, data1, data2);
        else if (cmd === 11) this.ctrlChange(channel, data1, data2);
        else if (cmd === 14) this.pitchWheel(channel, data2 * 128.0 + data1);
        else this.port.postMessage({ data, type: "midi" });
    }
    /**
     * @param {string} path
     * @param {number} value
     */
    setParamValue(path, value) {
        const e = { type: "param", data: { path, value } };
        this.port.postMessage(e);
        const param = this.parameters.get(path);
        if (param) param.setValueAtTime(value, this.context.currentTime);
    }
    /**
     * @param {string} path
     */
    getParamValue(path) {
        const param = this.parameters.get(path);
        if (param) return param.value;
        return null;
    }
    /**
     * @param {(address: string, value: number) => any} handler
     */
    setOutputParamHandler(handler) {
        this.outputHandler = handler;
    }
    getOutputParamHandler() {
        return this.outputHandler;
    }
    getNumInputs() {
        return this.dspMeta.inputs;
    }
    getNumOutputs() {
        return this.dspMeta.outputs;
    }
    getParams() {
        return this.inputsItems;
    }
    getJSON() {
        if (this.voices) {
            const o = this.dspMeta;
            const e = this.effectMeta;
            const r = { ...o };
            if (e) {
                r.ui = [{ type: "tgroup", label: "Sequencer", items: [
                    { type: "vgroup", label: "Instrument", items: o.ui },
                    { type: "vgroup", label: "Effect", items: e.ui }
                ] }];
            } else {
                r.ui = [{ type: "tgroup", label: "Polyphonic", items: [
                    { type: "vgroup", label: "Voices", items: o.ui }
                ] }];
            }
            return JSON.stringify(r);
        }
        return JSON.stringify(this.dspMeta);
    }
    getUI() {
        if (this.voices) {
            const o = this.dspMeta;
            const e = this.effectMeta;
            if (e) {
                return [{ type: "tgroup", label: "Sequencer", items: [
                    { type: "vgroup", label: "Instrument", items: o.ui },
                    { type: "vgroup", label: "Effect", items: e.ui }
                ] }];
            }
            return [{ type: "tgroup", label: "Polyphonic", items: [
                { type: "vgroup", label: "Voices", items: o.ui }
            ] }];
        }
        return this.dspMeta.ui;
    }
    destroy() {
        this.port.postMessage({ type: "destroy" });
        this.port.close();
        delete this.outputHandler;
    }
}

export default FaustNode
