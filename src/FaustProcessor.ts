import FaustDsp from "./FaustDsp";
import { FaustDspMeta, FaustUIDescriptor, FaustWebAssemblyExports, FaustWebAssemblyMixerExports, IFaustUIGroup, IFaustUIItem } from "./types";
import { createWasmImport, createWasmMemory, findPath, midiToFreq, remap } from "./utils";

class FaustProcessor {
    private dsp: FaustDsp;
    private dspModule: WebAssembly.Module;
    private effectModule?: WebAssembly.Module;
    private mixerModule?: WebAssembly.Module;

    private dspMeta: FaustDspMeta;
    private effectMeta?: FaustDspMeta;

    private dspInstance: WebAssembly.Instance;
    private effectInstance?: WebAssembly.Instance;
    private mixerInstance?: WebAssembly.Instance;
    private memory?: WebAssembly.Memory;

    private bufferSize: number;
    private sampleRate: number;
    private voices: number;
    private $ins: number;
    private $outs: number;
    private dspInChannnels: Float32Array[];
    private dspOutChannnels: Float32Array[];
    private fPitchwheelLabel: { path: string; min: number; max: number }[];
    private fCtrlLabel: { path: string; min: number; max: number }[][];
    private numIn: number;
    private numOut: number;
    private ptrSize: number;
    private inputsItems: string[];
    private outputsItems: string[];
    private pathTable$: { [address: string]: number };
    private sampleSize: number;
    private $audioHeap: number;
    private $$audioHeapInputs: number;
    private $$audioHeapOutputs: number;
    private $audioHeapInputs: number;
    private $audioHeapOutputs: number;
    private $dsp: number;
    private factory: FaustWebAssemblyExports;
    private HEAP: ArrayBuffer;
    private HEAP32: Int32Array;
    private HEAPF32: Float32Array;
    private output: Float32Array[];

    private $effect?: number;
    private $mixing?: number;
    private fFreqLabel$?: number[];
    private fGateLabel$?: number[];
    private fGainLabel$?: number[];
    private fDate?: number;
    private $$audioHeapMixing?: number;
    private $audioHeapMixing?: number;
    private mixer?: FaustWebAssemblyMixerExports;
    private effect?: FaustWebAssemblyExports;
    private dspVoices$?: number[];
    private dspVoicesState?: number[];
    private dspVoicesLevel?: number[];
    private dspVoicesDate?: number[];
    private kActiveVoice?: number;
    private kFreeVoice?: number;
    private kReleaseVoice?: number;
    private kNoVoice?: number;

    $sample: number;

    constructor(options: { dsp: FaustDsp; bufferSize?: number; sampleRate?: number; voices?: number, mixerModule?: WebAssembly.Module }) {
        const { dsp, mixerModule, bufferSize, sampleRate, voices } = options;
        if (!dsp) throw new Error("No Dsp input");
        if (this.factory) throw new Error("Processor already initiated.");

        this.dsp = dsp;
        const { mainMeta, mainModule, effectMeta, effectModule } = dsp;
        this.dspMeta = mainMeta;
        this.dspModule = mainModule;
        this.effectMeta = effectMeta;
        this.effectModule = effectModule;
        this.mixerModule = mixerModule

        this.bufferSize = bufferSize || 1024;
        this.sampleRate = sampleRate || 48000;
        this.voices = voices || 0;

    }

    async initialize() {
        this.$ins = null;
        this.$outs = null;

        this.dspInChannnels = [];
        this.dspOutChannnels = [];

        this.fPitchwheelLabel = [];
        this.fCtrlLabel = new Array(128).fill(null).map(() => []);

        this.numIn = this.dspMeta.inputs;
        this.numOut = this.dspMeta.outputs;

        // Memory allocator
        this.ptrSize = 4;
        this.sampleSize = 4;

        // Create the WASM instance
        await this.instantiateWasm(this.dsp, this.mixerModule);
        this.factory = this.dspInstance.exports as FaustWebAssemblyExports;
        this.HEAP = this.voices ? this.memory.buffer : this.factory.memory.buffer;
        this.HEAP32 = new Int32Array(this.HEAP);
        this.HEAPF32 = new Float32Array(this.HEAP);

        this.output = new Array(this.numOut).fill(null).map(() => new Float32Array(this.bufferSize));

        // input items
        this.inputsItems = [];

        // DSP is placed first with index 0. Audio buffer start at the end of DSP.
        this.$audioHeap = this.dspMeta.size;

        // Setup pointers offset
        this.$$audioHeapInputs = this.$audioHeap;
        this.$$audioHeapOutputs = this.$$audioHeapInputs + this.numIn * this.ptrSize;

        // Setup buffer offset
        this.$audioHeapInputs = this.$$audioHeapOutputs + (this.numOut * this.ptrSize);
        this.$audioHeapOutputs = this.$audioHeapInputs + (this.numIn * this.bufferSize * this.sampleSize);
        if (this.voices) {
            this.$$audioHeapMixing = this.$$audioHeapOutputs + this.numOut * this.ptrSize;
            // Setup buffer offset
            this.$audioHeapInputs = this.$$audioHeapMixing + this.numOut * this.ptrSize;
            this.$audioHeapOutputs = this.$audioHeapInputs + this.numIn * this.bufferSize * this.sampleSize;
            this.$audioHeapMixing = this.$audioHeapOutputs + this.numOut * this.bufferSize * this.sampleSize;
            this.$dsp = this.$audioHeapMixing + this.numOut * this.bufferSize * this.sampleSize;
        } else {
            this.$audioHeapInputs = this.$$audioHeapOutputs + this.numOut * this.ptrSize;
            this.$audioHeapOutputs = this.$audioHeapInputs + this.numIn * this.bufferSize * this.sampleSize;
            // Start of DSP memory : Mono DSP is placed first with index 0
            this.$dsp = 0;
        }

        if (this.voices) {
            this.effectMeta = this.effectMeta;
            this.$mixing = null;
            this.fFreqLabel$ = [];
            this.fGateLabel$ = [];
            this.fGainLabel$ = [];
            this.fDate = 0;

            this.mixer = this.mixerInstance.exports as FaustWebAssemblyMixerExports;
            this.effect = this.effectInstance ? this.effectInstance.exports as FaustWebAssemblyExports : null;

            // Start of DSP memory ('polyphony' DSP voices)
            this.dspVoices$ = [];
            this.dspVoicesState = [];
            this.dspVoicesLevel = [];
            this.dspVoicesDate = [];

            this.kActiveVoice = 0;
            this.kFreeVoice = -1;
            this.kReleaseVoice = -2;
            this.kNoVoice = -3;

            for (let i = 0; i < this.voices; i++) {
                this.dspVoices$[i] = this.$dsp + i * this.dspMeta.size;
                this.dspVoicesState[i] = this.kFreeVoice;
                this.dspVoicesLevel[i] = 0;
                this.dspVoicesDate[i] = 0;
            }
            // Effect memory starts after last voice
            this.$effect = this.dspVoices$[this.voices - 1] + this.dspMeta.size;
        }

        this.pathTable$ = {};

        this.$sample = 0;

        this.setup();
    }
    private setup() {
        if (this.numIn > 0) {
            this.$ins = this.$$audioHeapInputs;
            for (let i = 0; i < this.numIn; i++) {
                this.HEAP32[(this.$ins >> 2) + i] = this.$audioHeapInputs + this.bufferSize * this.sampleSize * i;
            }
            // Prepare Ins buffer tables
            const dspInChans = this.HEAP32.subarray(this.$ins >> 2, (this.$ins + this.numIn * this.ptrSize) >> 2);
            for (let i = 0; i < this.numIn; i++) {
                this.dspInChannnels[i] = this.HEAPF32.subarray(dspInChans[i] >> 2, (dspInChans[i] + this.bufferSize * this.sampleSize) >> 2);
            }
        }
        if (this.numOut > 0) {
            this.$outs = this.$$audioHeapOutputs;
            if (this.voices) this.$mixing = this.$$audioHeapMixing;
            for (let i = 0; i < this.numOut; i++) {
                this.HEAP32[(this.$outs >> 2) + i] = this.$audioHeapOutputs + this.bufferSize * this.sampleSize * i;
                if (this.voices) this.HEAP32[(this.$mixing >> 2) + i] = this.$audioHeapMixing + this.bufferSize * this.sampleSize * i;
            }
            // Prepare Out buffer tables
            const dspOutChans = this.HEAP32.subarray(this.$outs >> 2, (this.$outs + this.numOut * this.ptrSize) >> 2);
            for (let i = 0; i < this.numOut; i++) {
                this.dspOutChannnels[i] = this.HEAPF32.subarray(dspOutChans[i] >> 2, (dspOutChans[i] + this.bufferSize * this.sampleSize) >> 2);
            }
        }
        // Parse UI
        this.parseUI(this.dspMeta.ui);
        if (this.effect) this.parseUI(this.effectMeta.ui);

        // keep 'keyOn/keyOff' labels
        if (this.voices) {
            this.inputsItems.forEach((item) => {
                if (item.endsWith("/gate")) this.fGateLabel$.push(this.pathTable$[item]);
                else if (item.endsWith("/freq")) this.fFreqLabel$.push(this.pathTable$[item]);
                else if (item.endsWith("/gain")) this.fGainLabel$.push(this.pathTable$[item]);
            });
            // Init DSP voices
            this.dspVoices$.forEach($voice => this.factory.init($voice, this.sampleRate));
            // Init effect
            if (this.effect) this.effect.init(this.$effect, this.sampleRate);
        } else {
            // Init DSP
            this.factory.init(this.$dsp, this.sampleRate);
        }
    }
    private async instantiateWasm(dsp: FaustDsp, mixerModule?: WebAssembly.Module) {
        const memory = createWasmMemory(this.voices, this.dspMeta, this.effectMeta, this.bufferSize);
        this.memory = memory;
        const imports = createWasmImport(this.voices, memory);
        this.dspInstance = await WebAssembly.instantiate(dsp.mainModule, imports);
        if (dsp.effectModule) {
            this.effectInstance = await WebAssembly.instantiate(dsp.effectModule, imports);
        }
        if (this.voices) {
            const mixerImports = { imports: { print: console.log }, memory: { memory } };
            this.mixerInstance = await new WebAssembly.Instance(mixerModule, mixerImports);
        }
    }
    private parseUI(ui: FaustUIDescriptor) {
        ui.forEach(group => this.parseGroup(group));
    }
    private parseGroup(group: IFaustUIGroup) {
        if (group.items) this.parseItems(group.items);
    }
    private parseItems(items: IFaustUIItem[]) {
        items.forEach(item => this.parseItem(item));
    }
    private parseItem(item: IFaustUIItem) {
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
    setParamValue(path: string, val: number) {
        if (this.voices) {
            if (this.effect && findPath(this.effectMeta.ui, path)) this.effect.setParamValue(this.$effect, this.pathTable$[path], val);
            else this.dspVoices$.forEach($voice => this.factory.setParamValue($voice, this.pathTable$[path], val));
        } else {
            this.factory.setParamValue(this.$dsp, this.pathTable$[path], val);
        }
    }
    getParamValue(path: string) {
        if (this.voices) {
            if (this.effect && findPath(this.effectMeta.ui, path)) return this.effect.getParamValue(this.$effect, this.pathTable$[path]);
            return this.factory.getParamValue(this.dspVoices$[0], this.pathTable$[path]);
        }
        return this.factory.getParamValue(this.$dsp, this.pathTable$[path]);
    }
    // Poly only methods
    private getPlayingVoice(pitch: number) {
        if (!this.voices) return null;
        let voice = this.kNoVoice;
        let oldestDatePlaying = Number.MAX_VALUE;
        for (let i = 0; i < this.voices; i++) {
            if (this.dspVoicesState[i] === pitch) {
                // Keeps oldest playing voice
                if (this.dspVoicesDate[i] < oldestDatePlaying) {
                    oldestDatePlaying = this.dspVoicesDate[i];
                    voice = i;
                }
            }
        }
        return voice;
    }
    private allocVoice(voice: number) {
        if (!this.voices) return null;
        // so that envelop is always re-initialized
        this.factory.instanceClear(this.dspVoices$[voice]);
        this.dspVoicesDate[voice] = this.fDate++;
        this.dspVoicesState[voice] = this.kActiveVoice;
        return voice;
    }
    private getFreeVoice() {
        if (!this.voices) return null;
        for (let i = 0; i < this.voices; i++) {
            if (this.dspVoicesState[i] === this.kFreeVoice) return this.allocVoice(i);
        }
        let voiceRelease = this.kNoVoice;
        let voicePlaying = this.kNoVoice;
        let oldestDateRelease = Number.MAX_VALUE;
        let oldestDatePlaying = Number.MAX_VALUE;
        for (let i = 0; i < this.voices; i++) { // Scan all voices
            // Try to steal a voice in kReleaseVoice mode...
            if (this.dspVoicesState[i] === this.kReleaseVoice) {
                // Keeps oldest release voice
                if (this.dspVoicesDate[i] < oldestDateRelease) {
                    oldestDateRelease = this.dspVoicesDate[i];
                    voiceRelease = i;
                }
            } else if (this.dspVoicesDate[i] < oldestDatePlaying) {
                oldestDatePlaying = this.dspVoicesDate[i];
                voicePlaying = i;
            }
        }
        // Then decide which one to steal
        if (oldestDateRelease !== Number.MAX_VALUE) {
            // console.log(`Steal release voice : voice_date = ${this.dspVoicesDate[voiceRelease]} cur_date = ${this.fDate} voice = ${voiceRelease}`);
            return this.allocVoice(voiceRelease);
        }
        if (oldestDatePlaying !== Number.MAX_VALUE) {
            // console.log(`Steal playing voice : voice_date = ${this.dspVoicesDate[voicePlaying]} cur_date = ${this.fDate} voice = ${voicePlaying}`);
            return this.allocVoice(voicePlaying);
        }
        return this.kNoVoice;
    }
    keyOn(channel: number, pitch: number, velocity: number) {
        if (!this.voices) return;
        const voice = this.getFreeVoice();
        // console.log("keyOn voice " + voice);
        this.fFreqLabel$.forEach($ => this.factory.setParamValue(this.dspVoices$[voice], $, midiToFreq(pitch)));
        this.fGateLabel$.forEach($ => this.factory.setParamValue(this.dspVoices$[voice], $, 1));
        this.fGainLabel$.forEach($ => this.factory.setParamValue(this.dspVoices$[voice], $, velocity / 127));
        this.dspVoicesState[voice] = pitch;
    }
    keyOff(channel: number, pitch: number, velocity: number) {
        if (!this.voices) return;
        const voice = this.getPlayingVoice(pitch);
        if (voice === this.kNoVoice) return; // console.log("Playing voice not found...");
        // console.log("keyOff voice " + voice);
        this.fGateLabel$.forEach($ => this.factory.setParamValue(this.dspVoices$[voice], $, 0)); // No use of velocity for now...
        this.dspVoicesState[voice] = this.kReleaseVoice; // Release voice
    }
    allNotesOff() {
        if (!this.voices) return;
        for (let i = 0; i < this.voices; i++) {
            this.fGateLabel$.forEach($gate => this.factory.setParamValue(this.dspVoices$[i], $gate, 0));
            this.dspVoicesState[i] = this.kReleaseVoice;
        }
    }

    midiMessage(data: number[] | Uint8Array) {
        const cmd = data[0] >> 4;
        const channel = data[0] & 0xf;
        const data1 = data[1];
        const data2 = data[2];
        if (channel === 9) return;
        if (cmd === 8 || (cmd === 9 && data2 === 0)) this.keyOff(channel, data1, data2);
        else if (cmd === 9) this.keyOn(channel, data1, data2);
        else if (cmd === 11) this.ctrlChange(channel, data1, data2);
        else if (cmd === 14) this.pitchWheel(channel, data2 * 128.0 + data1);
    }
    ctrlChange(channel: number, ctrl: number, value: number) {
        if (ctrl === 123 || ctrl === 120) {
            this.allNotesOff();
        }
        if (!this.fCtrlLabel[ctrl].length) return;
        this.fCtrlLabel[ctrl].forEach((ctrl) => {
            const { path } = ctrl;
            this.setParamValue(path, remap(value, 0, 127, ctrl.min, ctrl.max));
        });
    }
    pitchWheel(channel: number, wheel: number) {
        this.fPitchwheelLabel.forEach((pw) => {
            this.setParamValue(pw.path, remap(wheel, 0, 16383, pw.min, pw.max));
        });
    }
    compute(inputs: Float32Array[] = []) {
        if (!this.factory) return this.output;
        for (let i = 0; i < this.numIn; i++) {
            this.dspInChannnels[i].fill(0);
            if (inputs[i]) this.dspInChannnels[i].set(inputs[i]);
        }
        if (this.voices) {
            this.mixer.clearOutput(this.bufferSize, this.numOut, this.$outs); // First clear the outputs
            for (let i = 0; i < this.voices; i++) { // Compute all running voices
                this.factory.compute(this.dspVoices$[i], this.bufferSize, this.$ins, this.$mixing); // Compute voice
                this.mixer.mixVoice(this.bufferSize, this.numOut, this.$mixing, this.$outs); // Mix it in result
            }
            if (this.effect) this.effect.compute(this.$effect, this.bufferSize, this.$outs, this.$outs); // Apply effect. Not a typo, effect is applied on the outs.
        } else {
            this.factory.compute(this.$dsp, this.bufferSize, this.$ins, this.$outs); // Compute
        }
        // Copy outputs
        if (this.output !== undefined) {
            for (let i = 0; i < this.numOut; i++) {
                this.output[i].set(this.dspOutChannnels[i]);
            }
        }
        this.$sample += this.bufferSize;
        return this.output;
    }
    generate(inputs: Float32Array[] = [], length = this.bufferSize, onUpdate?: (sample: number) => any) {
        let l = 0;
        const outputs = new Array(this.numOut).fill(null).map(() => new Float32Array(length));
        while (l < length) {
            const sliceLength = Math.min(length - l, this.bufferSize);
            const inputsCompute: Float32Array[] = [];
            for (let i = 0; i < this.numIn; i++) {
                let input: Float32Array;
                if (inputs[i]) {
                    if (inputs[i].length <= l) {
                        input = new Float32Array(sliceLength);
                    } else if (inputs[i].length > l + sliceLength) {
                        input = inputs[i].subarray(l, l + sliceLength);
                    } else {
                        input = inputs[i].subarray(l, inputs[i].length);
                    }
                }
                inputsCompute[i] = input;
            }
            const outputsComputed = this.compute(inputsCompute);
            for (let i = 0; i < this.numOut; i++) {
                const output = outputsComputed[i];
                if (sliceLength < this.bufferSize) {
                    outputs[i].set(output.subarray(0, sliceLength), l);
                } else {
                    outputs[i].set(output, l);
                }
            }
            l += this.bufferSize;
            onUpdate?.(l);
        }
        return outputs;
    }
}

export default FaustProcessor;
