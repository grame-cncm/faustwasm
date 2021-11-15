//@ts-check
/**
 * @typedef {import("./types").AudioParamDescriptor} AudioParamDescriptor
 * @typedef {import("./types").FaustDspDistribution} FaustDspDistribution
 * @typedef {import("./types").FaustDspMeta} FaustDspMeta
 * @typedef {import("./types").FaustUIDescriptor} FaustUIDescriptor
 * @typedef {import("./types").IFaustUIGroup} IFaustUIGroup
 * @typedef {import("./types").IFaustUIItem} IFaustUIItem
 * @typedef {import("./types").FaustWebAssemblyExports} FaustWebAssemblyExports
 * @typedef {import("./types").FaustWebAssemblyMixerExports} FaustWebAssemblyMixerExports
 * @typedef {import("./types").FaustAudioWorkletNodeOptions} FaustAudioWorkletNodeOptions
 * @typedef {import("./types").AudioWorkletGlobalScope} AudioWorkletGlobalScope
 */

/**
 * @param {string} processorId
 * @param {number} voices
 * @param {FaustDspMeta} dspMeta
 * @param {FaustDspMeta} effectMeta
 */
const getFaustAudioWorkletProcessor = (processorId, voices, dspMeta, effectMeta) => {
    /**
     * @param {number} note
     */
    const midiToFreq = (note) => 440.0 * 2 ** ((note - 69) / 12);

    /**
     * @param {number} v
     * @param {number} mn0
     * @param {number} mx0
     * @param {number} mn1
     * @param {number} mx1
     */
    const remap = (v, mn0, mx0, mn1, mx1) => (v - mn0) / (mx0 - mn0) * (mx1 - mn1) + mn1;

    /**
     * @param {any} o
     * @param {string} p
     */
    const findPath = (o, p) => {
        if (typeof o !== "object") return false;
        if (o.address) {
            return (o.address === p);
        }
        for (const k in o) {
            if (findPath(o[k], p)) return true;
        }
        return false;
    };
    /**
     * @param {number} voices 
     * @param {WebAssembly.Memory} memory 
     * @returns 
     */
    const createWasmImport = (voices, memory) => ({
        env: {
            memory: voices ? memory : undefined, memoryBase: 0, tableBase: 0,
            _abs: Math.abs,
            // Float version
            _acosf: Math.acos, _asinf: Math.asin, _atanf: Math.atan, _atan2f: Math.atan2,
            _ceilf: Math.ceil, _cosf: Math.cos, _expf: Math.exp, _floorf: Math.floor,
            _fmodf: (/** @type {number} */x, /** @type {number} */y) => x % y,
            _logf: Math.log, _log10f: Math.log10, _max_f: Math.max, _min_f: Math.min,
            _remainderf: (/** @type {number} */x, /** @type {number} */y) => x - Math.round(x / y) * y,
            _powf: Math.pow, _roundf: Math.fround, _sinf: Math.sin, _sqrtf: Math.sqrt, _tanf: Math.tan,
            _acoshf: Math.acosh, _asinhf: Math.asinh, _atanhf: Math.atanh,
            _coshf: Math.cosh, _sinhf: Math.sinh, _tanhf: Math.tanh,
            _isnanf: Number.isNaN, _isinff: (/** @type {number} */x) => !isFinite(x),
            _copysignf: (/** @type {number} */x, /** @type {number} */y) => (Math.sign(x) === Math.sign(y) ? x : -x),
    
            // Double version
            _acos: Math.acos, _asin: Math.asin, _atan: Math.atan, _atan2: Math.atan2,
            _ceil: Math.ceil, _cos: Math.cos, _exp: Math.exp, _floor: Math.floor,
            _fmod: (/** @type {number} */x, /** @type {number} */y) => x % y,
            _log: Math.log, _log10: Math.log10, _max_: Math.max, _min_: Math.min,
            _remainder: (/** @type {number} */x, /** @type {number} */y) => x - Math.round(x / y) * y,
            _pow: Math.pow, _round: Math.fround, _sin: Math.sin, _sqrt: Math.sqrt, _tan: Math.tan,
            _acosh: Math.acosh, _asinh: Math.asinh, _atanh: Math.atanh,
            _cosh: Math.cosh, _sinh: Math.sinh, _tanh: Math.tanh,
            _isnan: Number.isNaN, _isinf: (/** @type {number} */x) => !isFinite(x),
            _copysign: (/** @type {number} */x, /** @type {number} */y) => (Math.sign(x) === Math.sign(y) ? x : -x),
    
            table: new WebAssembly.Table({ initial: 0, element: "anyfunc" })
        }
    });

    /**
     * @param {number} voicesIn
     * @param {FaustDspMeta} dspMeta
     * @param {FaustDspMeta} effectMeta
     * @param {number} bufferSize
     */
    const createWasmMemory = (voicesIn, dspMeta, effectMeta, bufferSize) => {
        // Hack : at least 4 voices (to avoid weird wasm memory bug?)
        const voices = Math.max(4, voicesIn);
        // Memory allocator
        const ptrSize = 4;
        const sampleSize = 4;
        const pow2limit = (/** @type {number} */x) => {
            let n = 65536; // Minimum = 64 kB
            while (n < x) { n *= 2; }
            return n;
        };
        const effectSize = effectMeta ? effectMeta.size : 0;
        let memorySize = pow2limit(
            effectSize
            + dspMeta.size * voices
            + (dspMeta.inputs + dspMeta.outputs * 2)
            * (ptrSize + bufferSize * sampleSize)
        ) / 65536;
        memorySize = Math.max(2, memorySize); // As least 2
        return new WebAssembly.Memory({ initial: memorySize, maximum: memorySize });
    };


    /** @type {AudioWorkletGlobalScope} */
    // @ts-ignore
    const { registerProcessor, AudioWorkletProcessor, sampleRate } = globalThis;

    class FaustProcessor extends AudioWorkletProcessor {
        /** @type {number} */
        static bufferSize = 128;
        // JSON parsing functions
        /**
         * @param {FaustUIDescriptor} ui
         * @param {AudioParamDescriptor[] | FaustProcessor} obj
         * @param {(...args: any[]) => any} callback
         */
        static parseUI(ui, obj, callback) {
            for (let i = 0; i < ui.length; i++) {
                this.parseGroup(ui[i], obj, callback);
            }
        }
        /**
         * @param {IFaustUIGroup} group
         * @param {AudioParamDescriptor[] | FaustProcessor} obj
         * @param {(...args: any[]) => any} callback
         */
        static parseGroup(group, obj, callback) {
            if (group.items) {
                this.parseItems(group.items, obj, callback);
            }
        }
        /**
         * @param {IFaustUIItem[]} items
         * @param {AudioParamDescriptor[] | FaustProcessor} obj
         * @param {(...args: any[]) => any} callback
         */
        static parseItems(items, obj, callback) {
            for (let i = 0; i < items.length; i++) {
                callback(items[i], obj, callback);
            }
        }
        /**
         * @param {IFaustUIItem} item
         * @param {AudioParamDescriptor[]} obj
         * @param {(...args: any[]) => any} callback
         */
        static parseItem(item, obj, callback) {
            if (item.type === "vgroup" || item.type === "hgroup" || item.type === "tgroup") {
                FaustProcessor.parseItems(item.items, obj, callback); // callback may not binded to this
            } else if (item.type === "hbargraph" || item.type === "vbargraph") {
                // Nothing
            } else if (item.type === "vslider" || item.type === "hslider" || item.type === "nentry") {
                if (!voices || (!item.address.endsWith("/gate") && !item.address.endsWith("/freq") && !item.address.endsWith("/gain"))) {
                    obj.push({ name: item.address, defaultValue: item.init || 0, minValue: item.min || 0, maxValue: item.max || 0 });
                }
            } else if (item.type === "button" || item.type === "checkbox") {
                if (!voices || (!item.address.endsWith("/gate") && !item.address.endsWith("/freq") && !item.address.endsWith("/gain"))) {
                    obj.push({ name: item.address, defaultValue: item.init || 0, minValue: 0, maxValue: 1 });
                }
            }
        }
        /**
         * @param {IFaustUIItem} item
         * @param {FaustProcessor} obj
         * @param {(...args: any[]) => any} callback
         */
        static parseItem2(item, obj, callback) {
            if (item.type === "vgroup" || item.type === "hgroup" || item.type === "tgroup") {
                FaustProcessor.parseItems(item.items, obj, callback); // callback may not binded to this
            } else if (item.type === "hbargraph" || item.type === "vbargraph") {
                // Keep bargraph adresses
                obj.outputsItems.push(item.address);
                obj.pathTable$[item.address] = item.index;
            } else if (item.type === "vslider" || item.type === "hslider" || item.type === "button" || item.type === "checkbox" || item.type === "nentry") {
                // Keep inputs adresses
                obj.inputsItems.push(item.address);
                obj.pathTable$[item.address] = item.index;
                if (!item.meta) return;
                item.meta.forEach((meta) => {
                    const { midi } = meta;
                    if (!midi) return;
                    const strMidi = midi.trim();
                    if (strMidi === "pitchwheel") {
                        obj.fPitchwheelLabel.push({ path: item.address, min: item.min, max: item.max });
                    } else {
                        const matched = strMidi.match(/^ctrl\s(\d+)/);
                        if (!matched) return;
                        obj.fCtrlLabel[parseInt(matched[1])].push({ path: item.address, min: item.min, max: item.max });
                    }
                });
            }
        }
        static get parameterDescriptors() {
            /**
             * Analyse JSON to generate AudioParam parameters
             * @type {AudioParamDescriptor[]}
             */
            const params = [];
            this.parseUI(dspMeta.ui, params, this.parseItem);
            if (effectMeta) this.parseUI(effectMeta.ui, params, this.parseItem);
            return params;
        }
        
        /**
         * @param {FaustAudioWorkletNodeOptions} options 
         */
        constructor(options) {
            super(options);
            this.bufferSize = FaustProcessor.bufferSize;
            this.voices = voices;
            /** @type {FaustDspDistribution} */
            const faustDsp = { ...options.processorOptions, dspMeta, effectMeta };
            this.instantiateWasm(faustDsp, voices);
            this.destroyed = false;
            this.dspMeta = faustDsp.dspMeta;

            /**
             * @param {MessageEvent} e
             */
            this.handleMessage = (e) => { // use arrow function for binding
                const msg = e.data;
                switch (msg.type) {
                    // Generic MIDI message
                    case "midi": this.midiMessage(msg.data); break;
                    // Typed MIDI message
                    case "keyOn": this.keyOn(msg.data[0], msg.data[1], msg.data[2]); break;
                    case "keyOff": this.keyOff(msg.data[0], msg.data[1], msg.data[2]); break;
                    case "ctrlChange": this.ctrlChange(msg.data[0], msg.data[1], msg.data[2]); break;
                    case "pitchWheel": this.pitchWheel(msg.data[0], msg.data[1]); break;
                    // Generic data message
                    case "param": this.setParamValue(msg.data.path, msg.data.value); break;
                    // case "patch": this.onpatch(msg.data); break;
                    case "destroy": {
                        this.port.close();
                        this.destroyed = true;
                        delete this.outputHandler;
                        delete this.computeHandler;
                        break;
                    }
                    default:
                }
            };
            this.port.onmessage = this.handleMessage; // Naturally binded with arrow function property

            /** @type {(address: string, value: number) => any} */
            this.outputHandler = (path, value) => this.port.postMessage({ path, value, type: "param" });
            /** @type {(bufferSize: number) => any} */
            this.computeHandler = null;

            /** @type {number} */
            this.$ins = null;
            /** @type {number} */
            this.$outs = null;

            /** @type {Float32Array[]} */
            this.dspInChannnels = [];
            /** @type {Float32Array[]} */
            this.dspOutChannnels = [];

            /** @type {{ path: string; min: number; max: number }[]} */
            this.fPitchwheelLabel = [];
            /** @type {{ path: string; min: number; max: number }[][]} */
            this.fCtrlLabel = new Array(128).fill(null).map(() => []);

            this.numIn = this.dspMeta.inputs;
            this.numOut = this.dspMeta.outputs;

            // Memory allocator
            this.ptrSize = 4;
            this.sampleSize = 4;

            // Create the WASM instance
            /** @type {FaustWebAssemblyExports} */
            // @ts-ignore
            this.factory = this.dspInstance.exports;
            this.HEAP = this.voices ? this.memory.buffer : this.factory.memory.buffer;
            this.HEAP32 = new Int32Array(this.HEAP);
            this.HEAPF32 = new Float32Array(this.HEAP);

            // console.log(this.HEAP);
            // console.log(this.HEAP32);
            // console.log(this.HEAPF32);

            // bargraph
            this.outputsTimer = 5;
            /** @type {string[]} */
            this.outputsItems = [];

            // input items
            /** @type {string[]} */
            this.inputsItems = [];

            // Start of HEAP index

            // DSP is placed first with index 0. Audio buffer start at the end of DSP.
            this.$audioHeap = this.voices ? 0 : this.dspMeta.size;

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
                this.effectMeta = effectMeta;
                /** @type {number} */
                this.$mixing = null;
                /** @type {number[]} */
                this.fFreqLabel$ = [];
                /** @type {number[]} */
                this.fGateLabel$ = [];
                /** @type {number[]} */
                this.fGainLabel$ = [];
                this.fDate = 0;

                /** @type {FaustWebAssemblyMixerExports} */
                // @ts-ignore
                this.mixer = this.mixerInstance.exports;
                /** @type {FaustWebAssemblyExports} */
                // @ts-ignore
                this.effect = this.effectInstance ? this.effectInstance.exports : null;

                // Start of DSP memory ('polyphony' DSP voices)
                /** @type {number[]} */
                this.dspVoices$ = [];
                /** @type {number[]} */
                this.dspVoicesState = [];
                /** @type {number[]} */
                this.dspVoicesLevel = [];
                /** @type {number[]} */
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

            /** @type {{ [address: string]: number }} */
            this.pathTable$ = {};

            this.$buffer = 0;
            /** @type {{ type: string; data: any }[]} */
            this.cachedEvents = [];

            // Init resulting DSP
            this.setup();
        }
        /**
         * @param {FaustDspDistribution} faustDsp 
         * @param {number} voices
         */
        instantiateWasm(faustDsp, voices) {
            const { dspModule, dspMeta, effectModule, effectMeta, mixerModule } = faustDsp;
            const memory = createWasmMemory(voices, dspMeta, effectMeta, FaustProcessor.bufferSize);
            this.memory = memory;
            const imports = createWasmImport(voices, memory);
            this.dspInstance = new WebAssembly.Instance(dspModule, imports);
            if (effectModule) {
                this.effectInstance = new WebAssembly.Instance(effectModule, imports);
            }
            if (voices) {
                const mixerImports = { imports: { print: console.log }, memory: { memory } };
                this.mixerInstance = new WebAssembly.Instance(mixerModule, mixerImports);
            }
        }
        updateOutputs() {
            if (this.outputsItems.length > 0 && this.outputHandler && this.outputsTimer-- === 0) {
                this.outputsTimer = 5;
                this.outputsItems.forEach(item => this.outputHandler(item, this.factory.getParamValue(this.$dsp, this.pathTable$[item])));
            }
        }

        /**
         * @param {FaustUIDescriptor} ui
         */
        parseUI(ui) {
            return FaustProcessor.parseUI(ui, this, FaustProcessor.parseItem2);
        }
        /**
         * @param {IFaustUIGroup} group
         */
        parseGroup(group) {
            return FaustProcessor.parseGroup(group, this, FaustProcessor.parseItem2);
        }
        /**
         * @param {IFaustUIItem[]} items
         */
        parseItems(items) {
            return FaustProcessor.parseItems(items, this, FaustProcessor.parseItem2);
        }
        /**
         * @param {IFaustUIItem} item
         */
        parseItem(item) {
            return FaustProcessor.parseItem2(item, this, FaustProcessor.parseItem2);
        }

        /**
         * @param {string} path
         * @param {number} val
         */
        setParamValue(path, val) {
            if (this.voices) {
                if (this.effect && findPath(this.effectMeta.ui, path)) this.effect.setParamValue(this.$effect, this.pathTable$[path], val);
                else this.dspVoices$.forEach($voice => this.factory.setParamValue($voice, this.pathTable$[path], val));
            } else {
                this.factory.setParamValue(this.$dsp, this.pathTable$[path], val);
            }
        }
        /**
         * @param {string} path
         */
        getParamValue(path) {
            if (this.voices) {
                if (this.effect && findPath(this.effectMeta.ui, path)) return this.effect.getParamValue(this.$effect, this.pathTable$[path]);
                return this.factory.getParamValue(this.dspVoices$[0], this.pathTable$[path]);
            }
            return this.factory.getParamValue(this.$dsp, this.pathTable$[path]);
        }
        setup() {
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
                this.dspVoices$.forEach($voice => this.factory.init($voice, sampleRate));
                // Init effect
                if (this.effect) this.effect.init(this.$effect, sampleRate);
            } else {
                // Init DSP
                this.factory.init(this.$dsp, sampleRate); // 'sampleRate' is defined in AudioWorkletGlobalScope
            }
        }
        // Poly only methods
        /**
         * @param {number} pitch
         */
        getPlayingVoice(pitch) {
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
        /**
         * @param {number} voice
         */
        allocVoice(voice) {
            if (!this.voices) return null;
            // so that envelop is always re-initialized
            this.factory.instanceClear(this.dspVoices$[voice]);
            this.dspVoicesDate[voice] = this.fDate++;
            this.dspVoicesState[voice] = this.kActiveVoice;
            return voice;
        }
        getFreeVoice() {
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
        /**
         * @param {number} channel
         * @param {number} pitch
         * @param {number} velocity
         */
        keyOn(channel, pitch, velocity) {
            if (!this.voices) return;
            const voice = this.getFreeVoice();
            // console.log("keyOn voice " + voice);
            this.fFreqLabel$.forEach($ => this.factory.setParamValue(this.dspVoices$[voice], $, midiToFreq(pitch)));
            this.fGateLabel$.forEach($ => this.factory.setParamValue(this.dspVoices$[voice], $, 1));
            this.fGainLabel$.forEach($ => this.factory.setParamValue(this.dspVoices$[voice], $, velocity / 127));
            this.dspVoicesState[voice] = pitch;
        }
        /**
         * @param {number} channel
         * @param {number} pitch
         * @param {number} velocity
         */
        keyOff(channel, pitch, velocity) {
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
        }
        /**
         * @param {number} channel
         * @param {number} ctrl
         * @param {number} value
         */
        ctrlChange(channel, ctrl, value) {
            if (ctrl === 123 || ctrl === 120) {
                this.allNotesOff();
            }
            if (!this.fCtrlLabel[ctrl].length) return;
            this.fCtrlLabel[ctrl].forEach((ctrl) => {
                const { path } = ctrl;
                this.setParamValue(path, remap(value, 0, 127, ctrl.min, ctrl.max));
                this.outputHandler?.(path, this.getParamValue(path));
            });
        }
        /**
         * @param {number} channel
         * @param {number} wheel
         */
        pitchWheel(channel, wheel) {
            this.fPitchwheelLabel.forEach((pw) => {
                this.setParamValue(pw.path, remap(wheel, 0, 16383, pw.min, pw.max));
                this.outputHandler?.(pw.path, this.getParamValue(pw.path));
            });
        }
        /**
         * 
         * @param {Float32Array[][]} inputs 
         * @param {Float32Array[][]} outputs 
         * @param {Record<string, Float32Array>} parameters 
         * @returns 
         */
        process(inputs, outputs, parameters) {
            if (this.destroyed) return false;
            const input = inputs[0];
            const output = outputs[0];
            // Check inputs
            if (this.numIn > 0 && (!input || !input[0] || input[0].length === 0)) {
                // console.log("Process input error");
                return true;
            }
            // Check outputs
            if (this.numOut > 0 && (!output || !output[0] || output[0].length === 0)) {
                // console.log("Process output error");
                return true;
            }
            // Copy inputs
            if (input !== undefined) {
                for (let chan = 0; chan < Math.min(this.numIn, input.length); ++chan) {
                    const dspInput = this.dspInChannnels[chan];
                    dspInput.set(input[chan]);
                }
            }
            // Update controls (possibly needed for sample accurate control)
            for (const path in parameters) {
                const paramArray = parameters[path];
                this.setParamValue(path, paramArray[0]);
            }
            // Possibly call an externally given callback (for instance to synchronize playing a MIDIFile...)
            this.computeHandler?.(this.bufferSize);
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
            // Update bargraph
            this.updateOutputs();
            // Copy outputs
            if (output !== undefined) {
                for (let i = 0; i < Math.min(this.numOut, output.length); i++) {
                    const dspOutput = this.dspOutChannnels[i];
                    output[i].set(dspOutput);
                }
                this.port.postMessage({ type: "plot", value: output, index: this.$buffer++, events: this.cachedEvents });
                this.cachedEvents = [];
            }
            return true;
        }
        printMemory() {
            console.log("============== Memory layout ==============");
            console.log("dspMeta.size: " + this.dspMeta.size);
            console.log("$audioHeap: " + this.$audioHeap);
            console.log("$$audioHeapInputs: " + this.$$audioHeapInputs);
            console.log("$$audioHeapOutputs: " + this.$$audioHeapOutputs);
            console.log("$$audioHeapMixing: " + this.$$audioHeapMixing);
            console.log("$audioHeapInputs: " + this.$audioHeapInputs);
            console.log("$audioHeapOutputs: " + this.$audioHeapOutputs);
            console.log("$audioHeapMixing: " + this.$audioHeapMixing);
            console.log("$dsp: " + this.$dsp);
            if (this.dspVoices$) this.dspVoices$.forEach(($voice, i) => console.log("dspVoices$[" + i + "]: " + $voice));
            console.log("$effect: " + this.$effect);
            console.log("$mixing: " + this.$mixing);
        }
    }

    // Globals
    // Synchronously compile and instantiate the WASM module
    try {
        registerProcessor(processorId, FaustProcessor);
    } catch (error) {
        console.warn(error);
    }
};

export default getFaustAudioWorkletProcessor;
