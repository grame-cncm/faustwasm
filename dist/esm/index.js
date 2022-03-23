// src/instantiateFaustModuleFromFile.ts
var instantiateFaustModuleFromFile = async (jsFile, dataFile = jsFile.replace(/c?js$/, "data"), wasmFile = jsFile.replace(/c?js$/, "wasm")) => {
  let FaustModule;
  let dataBinary;
  let wasmBinary;
  FaustModule = (await import(jsFile)).default;
  if (typeof globalThis.fetch === "function") {
    dataBinary = await (await fetch(dataFile)).arrayBuffer();
    wasmBinary = new Uint8Array(await (await fetch(wasmFile)).arrayBuffer());
  } else {
    const fs = await import("fs/promises");
    const { fileURLToPath } = await import("url");
    dataBinary = (await fs.readFile(fileURLToPath(dataFile))).buffer;
    wasmBinary = (await fs.readFile(fileURLToPath(wasmFile))).buffer;
  }
  const faustModule = await FaustModule({
    wasmBinary,
    getPreloadedPackage: (remotePackageName, remotePackageSize) => {
      if (remotePackageName === "libfaust-wasm.data")
        return dataBinary;
      return new ArrayBuffer(0);
    }
  });
  return faustModule;
};
var instantiateFaustModuleFromFile_default = instantiateFaustModuleFromFile;

// src/FaustAudioWorkletProcessor.ts
var getFaustAudioWorkletProcessor = (dependencies, faustData) => {
  const { registerProcessor, AudioWorkletProcessor, sampleRate } = globalThis;
  const {
    FaustBaseWebAudioDsp: FaustBaseWebAudioDsp2,
    FaustWasmInstantiator: FaustWasmInstantiator2
  } = dependencies;
  const {
    dspName,
    dspMeta,
    effectMeta,
    poly
  } = faustData;
  class FaustAudioWorkletProcessor extends AudioWorkletProcessor {
    constructor(options) {
      super(options);
      this.port.onmessage = (e) => this.handleMessageAux(e);
    }
    static get parameterDescriptors() {
      const params = [];
      const callback = (item) => {
        if (item.type === "vslider" || item.type === "hslider" || item.type === "nentry") {
          if (!poly || !item.address.endsWith("/gate") && !item.address.endsWith("/freq") && !item.address.endsWith("/gain")) {
            params.push({ name: item.address, defaultValue: item.init || 0, minValue: item.min || 0, maxValue: item.max || 0 });
          }
        } else if (item.type === "button" || item.type === "checkbox") {
          if (!poly || !item.address.endsWith("/gate") && !item.address.endsWith("/freq") && !item.address.endsWith("/gain")) {
            params.push({ name: item.address, defaultValue: item.init || 0, minValue: 0, maxValue: 1 });
          }
        }
      };
      FaustBaseWebAudioDsp2.parseUI(dspMeta.ui, callback);
      if (effectMeta)
        FaustBaseWebAudioDsp2.parseUI(effectMeta.ui, callback);
      return params;
    }
    process(inputs, outputs, parameters) {
      for (const path in parameters) {
        const paramArray = parameters[path];
        this.fDSPCode.setParamValue(path, paramArray[0]);
      }
      return this.fDSPCode.compute(inputs[0], outputs[0]);
    }
    handleMessageAux(e) {
      const msg = e.data;
      switch (msg.type) {
        case "midi":
          this.midiMessage(msg.data);
          break;
        case "ctrlChange":
          this.ctrlChange(msg.data[0], msg.data[1], msg.data[2]);
          break;
        case "pitchWheel":
          this.pitchWheel(msg.data[0], msg.data[1]);
          break;
        case "param":
          this.setParamValue(msg.data.path, msg.data.value);
          break;
        case "setPlotHandler": {
          if (msg.data) {
            this.fDSPCode.setPlotHandler((output, index, events) => this.port.postMessage({ type: "plot", value: output, index, events }));
          } else {
            this.fDSPCode.setPlotHandler(null);
          }
          break;
        }
        case "start": {
          this.fDSPCode.start();
          break;
        }
        case "stop": {
          this.fDSPCode.stop();
          break;
        }
        case "destroy": {
          this.port.close();
          this.fDSPCode.destroy();
          break;
        }
        default:
          break;
      }
    }
    setParamValue(path, value) {
      this.fDSPCode.setParamValue(path, value);
    }
    midiMessage(data) {
      this.fDSPCode.midiMessage(data);
    }
    ctrlChange(channel, ctrl, value) {
      this.fDSPCode.ctrlChange(channel, ctrl, value);
    }
    pitchWheel(channel, wheel) {
      this.fDSPCode.pitchWheel(channel, wheel);
    }
  }
  class FaustMonoAudioWorkletProcessor extends FaustAudioWorkletProcessor {
    constructor(options) {
      super(options);
      const { FaustMonoWebAudioDsp: FaustWebAudioMonoDSP } = dependencies;
      const { factory, sampleSize } = options.processorOptions;
      const instance = FaustWasmInstantiator2.createSyncMonoDSPInstance(factory);
      this.fDSPCode = new FaustWebAudioMonoDSP(instance, sampleRate, sampleSize, 128);
      this.fDSPCode.setOutputParamHandler((path, value) => this.port.postMessage({ path, value, type: "param" }));
      this.fDSPCode.start();
    }
  }
  class FaustPolyAudioWorkletProcessor extends FaustAudioWorkletProcessor {
    constructor(options) {
      super(options);
      this.handleMessageAux = (e) => {
        const msg = e.data;
        switch (msg.type) {
          case "keyOn":
            this.keyOn(msg.data[0], msg.data[1], msg.data[2]);
            break;
          case "keyOff":
            this.keyOff(msg.data[0], msg.data[1], msg.data[2]);
            break;
          default:
            super.handleMessageAux(e);
            break;
        }
      };
      const { FaustPolyWebAudioDsp: FaustWebAudioPolyDSP } = dependencies;
      const { voiceFactory, mixerModule, voices, effectFactory, sampleSize } = options.processorOptions;
      const instance = FaustWasmInstantiator2.createSyncPolyDSPInstance(voiceFactory, mixerModule, voices, effectFactory);
      this.fDSPCode = new FaustWebAudioPolyDSP(instance, sampleRate, sampleSize, 128);
      this.port.onmessage = (e) => this.handleMessageAux(e);
      this.fDSPCode.setOutputParamHandler((path, value) => this.port.postMessage({ path, value, type: "param" }));
      this.fDSPCode.start();
    }
    midiMessage(data) {
      const cmd = data[0] >> 4;
      const channel = data[0] & 15;
      const data1 = data[1];
      const data2 = data[2];
      if (cmd === 8 || cmd === 9 && data2 === 0)
        this.keyOff(channel, data1, data2);
      else if (cmd === 9)
        this.keyOn(channel, data1, data2);
      else
        super.midiMessage(data);
    }
    keyOn(channel, pitch, velocity) {
      this.fDSPCode.keyOn(channel, pitch, velocity);
    }
    keyOff(channel, pitch, velocity) {
      this.fDSPCode.keyOff(channel, pitch, velocity);
    }
    allNotesOff(hard) {
      this.fDSPCode.allNotesOff(hard);
    }
  }
  try {
    if (poly) {
      registerProcessor(dspName || "mydsp_poly", FaustPolyAudioWorkletProcessor);
    } else {
      registerProcessor(dspName || "mydsp", FaustMonoAudioWorkletProcessor);
    }
  } catch (error) {
    console.warn(error);
  }
};
var FaustAudioWorkletProcessor_default = getFaustAudioWorkletProcessor;

// src/FaustCompiler.ts
var sha256 = async (str) => {
  if (crypto.subtle) {
    const inputBuffer = new TextEncoder().encode(str);
    const hashBuffer = await crypto.subtle.digest("SHA-256", inputBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
    return hashHex;
  }
  return crypto.createHash("sha256").update(str).digest("hex");
};
var _FaustCompiler = class {
  constructor(libFaust) {
    this.fLibFaust = libFaust;
    this.fErrorMessage = "";
  }
  intVec2intArray(vec) {
    const size = vec.size();
    const ui8Code = new Uint8Array(size);
    for (let i = 0; i < size; i++) {
      ui8Code[i] = vec.get(i);
    }
    return ui8Code;
  }
  async createDSPFactory(name, code, args, poly) {
    if (_FaustCompiler.gFactories.size > 10) {
      _FaustCompiler.gFactories.clear();
    }
    let shaKey = await sha256(name + code + args + (poly ? "poly" : "mono"));
    if (_FaustCompiler.gFactories.has(shaKey)) {
      return _FaustCompiler.gFactories.get(shaKey) || null;
    } else {
      try {
        const faustWasm = this.fLibFaust.createDSPFactory(name, code, args, !poly);
        try {
          const code2 = this.intVec2intArray(faustWasm.data);
          faustWasm.data.delete();
          const module = await WebAssembly.compile(code2);
          const factory = { cfactory: faustWasm.cfactory, code: code2, module, json: faustWasm.json, poly };
          this.deleteDSPFactory(factory);
          _FaustCompiler.gFactories.set(shaKey, factory);
          return factory;
        } catch (e) {
          console.error(e);
          return null;
        }
      } catch {
        this.fErrorMessage = this.fLibFaust.getErrorAfterException();
        console.error(`=> exception raised while running createDSPFactory: ${this.fErrorMessage}`);
        this.fLibFaust.cleanupAfterException();
        return null;
      }
    }
  }
  version() {
    return this.fLibFaust.version();
  }
  getErrorMessage() {
    return this.fErrorMessage;
  }
  async createMonoDSPFactory(name, code, args) {
    return this.createDSPFactory(name, code, args, false);
  }
  async createPolyDSPFactory(name, code, args) {
    return this.createDSPFactory(name, code, args, true);
  }
  deleteDSPFactory(factory) {
    this.fLibFaust.deleteDSPFactory(factory.cfactory);
    factory.cfactory = 0;
  }
  expandDSP(code, args) {
    try {
      return this.fLibFaust.expandDSP("FaustDSP", code, args);
    } catch {
      this.fErrorMessage = this.fLibFaust.getErrorAfterException();
      console.error(`=> exception raised while running expandDSP: ${this.fErrorMessage}`);
      this.fLibFaust.cleanupAfterException();
      return null;
    }
  }
  generateAuxFiles(name, code, args) {
    try {
      return this.fLibFaust.generateAuxFiles(name, code, args);
    } catch {
      this.fErrorMessage = this.fLibFaust.getErrorAfterException();
      console.error(`=> exception raised while running generateAuxFiles: ${this.fErrorMessage}`);
      this.fLibFaust.cleanupAfterException();
      return false;
    }
  }
  deleteAllDSPFactories() {
    this.fLibFaust.deleteAllDSPFactories();
  }
  fs() {
    return this.fLibFaust.fs();
  }
  async getAsyncInternalMixerModule(isDouble = false) {
    const bufferKey = isDouble ? "mixer64Buffer" : "mixer32Buffer";
    const moduleKey = isDouble ? "mixer64Module" : "mixer32Module";
    if (this[moduleKey])
      return { mixerBuffer: this[bufferKey], mixerModule: this[moduleKey] };
    const path = isDouble ? "/usr/rsrc/mixer64.wasm" : "/usr/rsrc/mixer32.wasm";
    const mixerBuffer = this.fs().readFile(path, { encoding: "binary" });
    this[bufferKey] = mixerBuffer;
    const mixerModule = await WebAssembly.compile(mixerBuffer);
    this[moduleKey] = mixerModule;
    return { mixerBuffer, mixerModule };
  }
  getSyncInternalMixerModule(isDouble = false) {
    const bufferKey = isDouble ? "mixer64Buffer" : "mixer32Buffer";
    const moduleKey = isDouble ? "mixer64Module" : "mixer32Module";
    if (this[moduleKey])
      return { mixerBuffer: this[bufferKey], mixerModule: this[moduleKey] };
    const path = isDouble ? "/usr/rsrc/mixer64.wasm" : "/usr/rsrc/mixer32.wasm";
    const mixerBuffer = this.fs().readFile(path, { encoding: "binary" });
    this[bufferKey] = mixerBuffer;
    const mixerModule = new WebAssembly.Module(mixerBuffer);
    this[moduleKey] = mixerModule;
    return { mixerBuffer, mixerModule };
  }
};
var FaustCompiler = _FaustCompiler;
FaustCompiler.gFactories = new Map();
var FaustCompiler_default = FaustCompiler;

// src/FaustDspInstance.ts
var FaustDspInstance = class {
  constructor(exports) {
    this.fExports = exports;
  }
  compute($dsp, count, $input, $output) {
    this.fExports.compute($dsp, count, $input, $output);
  }
  getNumInputs($dsp) {
    return this.fExports.getNumInputs($dsp);
  }
  getNumOutputs($dsp) {
    return this.fExports.getNumOutputs($dsp);
  }
  getParamValue($dsp, index) {
    return this.fExports.getParamValue($dsp, index);
  }
  getSampleRate($dsp) {
    return this.fExports.getSampleRate($dsp);
  }
  init($dsp, sampleRate) {
    this.fExports.init($dsp, sampleRate);
  }
  instanceClear($dsp) {
    this.fExports.instanceClear($dsp);
  }
  instanceConstants($dsp, sampleRate) {
    this.fExports.instanceConstants($dsp, sampleRate);
  }
  instanceInit($dsp, sampleRate) {
    this.fExports.instanceInit($dsp, sampleRate);
  }
  instanceResetUserInterface($dsp) {
    this.fExports.instanceResetUserInterface($dsp);
  }
  setParamValue($dsp, index, value) {
    this.fExports.setParamValue($dsp, index, value);
  }
};
var FaustDspInstance_default = FaustDspInstance;

// src/FaustWasmInstantiator.ts
var FaustWasmInstantiator = class {
  static createWasmImport(memory) {
    return {
      env: {
        memory: memory || new WebAssembly.Memory({ initial: 100 }),
        memoryBase: 0,
        tableBase: 0,
        _abs: Math.abs,
        _acosf: Math.acos,
        _asinf: Math.asin,
        _atanf: Math.atan,
        _atan2f: Math.atan2,
        _ceilf: Math.ceil,
        _cosf: Math.cos,
        _expf: Math.exp,
        _floorf: Math.floor,
        _fmodf: (x, y) => x % y,
        _logf: Math.log,
        _log10f: Math.log10,
        _max_f: Math.max,
        _min_f: Math.min,
        _remainderf: (x, y) => x - Math.round(x / y) * y,
        _powf: Math.pow,
        _roundf: Math.fround,
        _sinf: Math.sin,
        _sqrtf: Math.sqrt,
        _tanf: Math.tan,
        _acoshf: Math.acosh,
        _asinhf: Math.asinh,
        _atanhf: Math.atanh,
        _coshf: Math.cosh,
        _sinhf: Math.sinh,
        _tanhf: Math.tanh,
        _isnanf: Number.isNaN,
        _isinff: (x) => !isFinite(x),
        _copysignf: (x, y) => Math.sign(x) === Math.sign(y) ? x : -x,
        _acos: Math.acos,
        _asin: Math.asin,
        _atan: Math.atan,
        _atan2: Math.atan2,
        _ceil: Math.ceil,
        _cos: Math.cos,
        _exp: Math.exp,
        _floor: Math.floor,
        _fmod: (x, y) => x % y,
        _log: Math.log,
        _log10: Math.log10,
        _max_: Math.max,
        _min_: Math.min,
        _remainder: (x, y) => x - Math.round(x / y) * y,
        _pow: Math.pow,
        _round: Math.fround,
        _sin: Math.sin,
        _sqrt: Math.sqrt,
        _tan: Math.tan,
        _acosh: Math.acosh,
        _asinh: Math.asinh,
        _atanh: Math.atanh,
        _cosh: Math.cosh,
        _sinh: Math.sinh,
        _tanh: Math.tanh,
        _isnan: Number.isNaN,
        _isinf: (x) => !isFinite(x),
        _copysign: (x, y) => Math.sign(x) === Math.sign(y) ? x : -x,
        table: new WebAssembly.Table({ initial: 0, element: "anyfunc" })
      }
    };
  }
  static createWasmMemory(voicesIn, sampleSize, dspMeta, effectMeta, bufferSize) {
    const voices = Math.max(4, voicesIn);
    const ptrSize = sampleSize;
    const pow2limit = (x) => {
      let n = 65536;
      while (n < x) {
        n *= 2;
      }
      return n;
    };
    const effectSize = effectMeta ? effectMeta.size : 0;
    let memorySize = pow2limit(effectSize + dspMeta.size * voices + (dspMeta.inputs + dspMeta.outputs * 2) * (ptrSize + bufferSize * sampleSize)) / 65536;
    memorySize = Math.max(2, memorySize);
    return new WebAssembly.Memory({ initial: memorySize, maximum: memorySize });
  }
  static createMonoDSPInstanceAux(instance, json) {
    const functions = instance.exports;
    const api = new FaustDspInstance_default(functions);
    const memory = instance.exports.memory;
    return { memory, api, json };
  }
  static createMemoryAux(voices, voiceFactory, effectFactory) {
    const voiceMeta = JSON.parse(voiceFactory.json);
    const effectMeta = effectFactory && effectFactory.json ? JSON.parse(effectFactory.json) : null;
    const sampleSize = voiceMeta.compile_options.match("-double") ? 8 : 4;
    return this.createWasmMemory(voices, sampleSize, voiceMeta, effectMeta, 8192);
  }
  static createMixerAux(mixerModule, memory) {
    const mixerImport = {
      imports: { print: console.log },
      memory: { memory }
    };
    const mixerInstance = new WebAssembly.Instance(mixerModule, mixerImport);
    const mixerFunctions = mixerInstance.exports;
    return mixerFunctions;
  }
  static async loadDSPFactory(wasmPath, jsonPath) {
    const wasmFile = await fetch(wasmPath);
    if (!wasmFile.ok) {
      console.error(`=> exception raised while running loadDSPFactory, file not found: ${wasmPath}`);
      return null;
    }
    try {
      const wasmBuffer = await wasmFile.arrayBuffer();
      const module = await WebAssembly.compile(wasmBuffer);
      const jsonFile = await fetch(jsonPath);
      const json = await jsonFile.text();
      const meta = JSON.parse(json);
      const cOptions = meta.compile_options;
      const poly = cOptions.indexOf("wasm-e") !== -1;
      return { cfactory: 0, code: new Uint8Array(wasmBuffer), module, json, poly };
    } catch (e) {
      console.error(`=> exception raised while running loadDSPFactory: ${e}`);
      return null;
    }
  }
  static async loadDSPMixer(mixerPath, fs) {
    try {
      let mixerBuffer = null;
      if (fs) {
        mixerBuffer = fs.readFile(mixerPath, { encoding: "binary" });
      } else {
        const mixerFile = await fetch(mixerPath);
        mixerBuffer = await mixerFile.arrayBuffer();
      }
      return WebAssembly.compile(mixerBuffer);
    } catch (e) {
      console.error(`=> exception raised while running loadMixer: ${e}`);
      return null;
    }
  }
  static async createAsyncMonoDSPInstance(factory) {
    const instance = await WebAssembly.instantiate(factory.module, this.createWasmImport());
    return this.createMonoDSPInstanceAux(instance, factory.json);
  }
  static createSyncMonoDSPInstance(factory) {
    const instance = new WebAssembly.Instance(factory.module, this.createWasmImport());
    return this.createMonoDSPInstanceAux(instance, factory.json);
  }
  static async createAsyncPolyDSPInstance(voiceFactory, mixerModule, voices, effectFactory) {
    const memory = this.createMemoryAux(voices, voiceFactory, effectFactory);
    const voiceInstance = await WebAssembly.instantiate(voiceFactory.module, this.createWasmImport(memory));
    const voiceFunctions = voiceInstance.exports;
    const voiceAPI = new FaustDspInstance_default(voiceFunctions);
    const mixerAPI = this.createMixerAux(mixerModule, memory);
    if (effectFactory) {
      const effectInstance = await WebAssembly.instantiate(effectFactory.module, this.createWasmImport(memory));
      const effectFunctions = effectInstance.exports;
      const effectAPI = new FaustDspInstance_default(effectFunctions);
      return {
        memory,
        voices,
        voiceAPI,
        effectAPI,
        mixerAPI,
        voiceJSON: voiceFactory.json,
        effectJSON: effectFactory.json
      };
    } else {
      return {
        memory,
        voices,
        voiceAPI,
        mixerAPI,
        voiceJSON: voiceFactory.json
      };
    }
  }
  static createSyncPolyDSPInstance(voiceFactory, mixerModule, voices, effectFactory) {
    const memory = this.createMemoryAux(voices, voiceFactory, effectFactory);
    const voiceInstance = new WebAssembly.Instance(voiceFactory.module, this.createWasmImport(memory));
    const voiceFunctions = voiceInstance.exports;
    const voiceAPI = new FaustDspInstance_default(voiceFunctions);
    const mixerAPI = this.createMixerAux(mixerModule, memory);
    if (effectFactory) {
      const effectInstance = new WebAssembly.Instance(effectFactory.module, this.createWasmImport(memory));
      const effectFunctions = effectInstance.exports;
      const effectAPI = new FaustDspInstance_default(effectFunctions);
      return {
        memory,
        voices,
        voiceAPI,
        effectAPI,
        mixerAPI,
        voiceJSON: voiceFactory.json,
        effectJSON: effectFactory.json
      };
    } else {
      return {
        memory,
        voices,
        voiceAPI,
        mixerAPI,
        voiceJSON: voiceFactory.json
      };
    }
  }
};
var FaustWasmInstantiator_default = FaustWasmInstantiator;

// src/FaustOfflineProcessor.ts
var FaustOfflineProcessor = class {
  constructor(instance, bufferSize) {
    this.fDSPCode = instance;
    this.fBufferSize = bufferSize;
    this.fInputs = new Array(this.fDSPCode.getNumInputs()).fill(null).map(() => new Float32Array(bufferSize));
    this.fOutputs = new Array(this.fDSPCode.getNumOutputs()).fill(null).map(() => new Float32Array(bufferSize));
  }
  render(inputs = [], length = this.fBufferSize, onUpdate) {
    let l = 0;
    const outputs = new Array(this.fDSPCode.getNumOutputs()).fill(null).map(() => new Float32Array(length));
    this.fDSPCode.start();
    while (l < length) {
      const sliceLength = Math.min(length - l, this.fBufferSize);
      for (let i = 0; i < this.fDSPCode.getNumInputs(); i++) {
        let input;
        if (inputs[i]) {
          if (inputs[i].length <= l) {
            input = new Float32Array(sliceLength);
          } else if (inputs[i].length > l + sliceLength) {
            input = inputs[i].subarray(l, l + sliceLength);
          } else {
            input = inputs[i].subarray(l, inputs[i].length);
          }
        } else {
          input = new Float32Array(sliceLength);
        }
        this.fInputs[i] = input;
      }
      this.fDSPCode.compute(this.fInputs, this.fOutputs);
      for (let i = 0; i < this.fDSPCode.getNumOutputs(); i++) {
        const output = this.fOutputs[i];
        if (sliceLength < this.fBufferSize) {
          outputs[i].set(output.subarray(0, sliceLength), l);
        } else {
          outputs[i].set(output, l);
        }
      }
      l += this.fBufferSize;
      onUpdate?.(l);
    }
    this.fDSPCode.stop();
    return outputs;
  }
};
var FaustOfflineProcessor_default = FaustOfflineProcessor;

// src/FaustSvgDiagrams.ts
var FaustSvgDiagrams = class {
  constructor(compiler) {
    this.compiler = compiler;
  }
  from(name, code, args) {
    const fs = this.compiler.fs();
    try {
      const files2 = fs.readdir(`/${name}-svg/`);
      files2.filter((file) => file !== "." && file !== "..").forEach((file) => fs.unlink(`/${name}-svg/${file}`));
    } catch {
    }
    const success = this.compiler.generateAuxFiles(name, code, `-lang wasm -svg ${args}`);
    if (!success)
      throw new Error(this.compiler.getErrorMessage());
    const svgs = {};
    const files = fs.readdir(`/${name}-svg/`);
    files.filter((file) => file !== "." && file !== "..").forEach((file) => svgs[file] = fs.readFile(`/${name}-svg/${file}`, { encoding: "utf8" }));
    return svgs;
  }
};
var FaustSvgDiagrams_default = FaustSvgDiagrams;

// src/LibFaust.ts
var LibFaust = class {
  constructor(module) {
    this.fModule = module;
    this.fCompiler = new module.libFaustWasm();
    this.fFileSystem = this.fModule.FS;
  }
  module() {
    return this.fModule;
  }
  fs() {
    return this.fFileSystem;
  }
  version() {
    return this.fCompiler.version();
  }
  createDSPFactory(name, code, args, useInternalMemory) {
    return this.fCompiler.createDSPFactory(name, code, args, useInternalMemory);
  }
  deleteDSPFactory(cFactory) {
    return this.fCompiler.deleteDSPFactory(cFactory);
  }
  expandDSP(name, code, args) {
    return this.fCompiler.expandDSP(name, code, args);
  }
  generateAuxFiles(name, code, args) {
    return this.fCompiler.generateAuxFiles(name, code, args);
  }
  deleteAllDSPFactories() {
    return this.fCompiler.deleteAllDSPFactories();
  }
  getErrorAfterException() {
    return this.fCompiler.getErrorAfterException();
  }
  cleanupAfterException() {
    return this.fCompiler.cleanupAfterException();
  }
  getInfos(what) {
    return this.fCompiler.getInfos(what);
  }
  toString() {
    return `LibFaust module: ${this.fModule}, compiler: ${this.fCompiler}`;
  }
};
var LibFaust_default = LibFaust;

// src/WavEncoder.ts
var WavEncoder = class {
  static encode(audioBuffer, options) {
    const numberOfChannels = audioBuffer.length;
    const length = audioBuffer[0].length;
    const { shared, float } = options;
    const bitDepth = float ? 32 : options.bitDepth | 0 || 16;
    const byteDepth = bitDepth >> 3;
    const byteLength = length * numberOfChannels * byteDepth;
    const AB = shared ? globalThis.SharedArrayBuffer || globalThis.ArrayBuffer : globalThis.ArrayBuffer;
    const ab = new AB((44 + byteLength) * Uint8Array.BYTES_PER_ELEMENT);
    const dataView = new DataView(ab);
    const writer = new Writer(dataView);
    const format = {
      formatId: float ? 3 : 1,
      float: !!float,
      numberOfChannels,
      sampleRate: options.sampleRate,
      symmetric: !!options.symmetric,
      length,
      bitDepth,
      byteDepth
    };
    this.writeHeader(writer, format);
    this.writeData(writer, audioBuffer, format);
    return ab;
  }
  static writeHeader(writer, format) {
    const { formatId, sampleRate, bitDepth, numberOfChannels, length, byteDepth } = format;
    writer.string("RIFF");
    writer.uint32(writer.dataView.byteLength - 8);
    writer.string("WAVE");
    writer.string("fmt ");
    writer.uint32(16);
    writer.uint16(formatId);
    writer.uint16(numberOfChannels);
    writer.uint32(sampleRate);
    writer.uint32(sampleRate * numberOfChannels * byteDepth);
    writer.uint16(numberOfChannels * byteDepth);
    writer.uint16(bitDepth);
    writer.string("data");
    writer.uint32(length * numberOfChannels * byteDepth);
    return writer.pos;
  }
  static writeData(writer, audioBuffer, format) {
    const { bitDepth, float, length, numberOfChannels, symmetric } = format;
    if (bitDepth === 32 && float) {
      const { dataView, pos } = writer;
      const ab = dataView.buffer;
      const f32View = new Float32Array(ab, pos);
      if (numberOfChannels === 1) {
        f32View.set(audioBuffer[0]);
        return;
      }
      for (let ch = 0; ch < numberOfChannels; ch++) {
        const channel = audioBuffer[ch];
        for (let i = 0; i < length; i++) {
          f32View[i * numberOfChannels + ch] = channel[i];
        }
      }
      return;
    }
    const encoderOption = float ? "f" : symmetric ? "s" : "";
    const methodName = "pcm" + bitDepth + encoderOption;
    if (!writer[methodName]) {
      throw new TypeError("Not supported bit depth: " + bitDepth);
    }
    const write = writer[methodName].bind(writer);
    for (let i = 0; i < length; i++) {
      for (let j = 0; j < numberOfChannels; j++) {
        write(audioBuffer[j][i]);
      }
    }
  }
};
var Writer = class {
  constructor(dataView) {
    this.pos = 0;
    this.dataView = dataView;
  }
  int16(value) {
    this.dataView.setInt16(this.pos, value, true);
    this.pos += 2;
  }
  uint16(value) {
    this.dataView.setUint16(this.pos, value, true);
    this.pos += 2;
  }
  uint32(value) {
    this.dataView.setUint32(this.pos, value, true);
    this.pos += 4;
  }
  string(value) {
    for (let i = 0, imax = value.length; i < imax; i++) {
      this.dataView.setUint8(this.pos++, value.charCodeAt(i));
    }
  }
  pcm8(valueIn) {
    let value = valueIn;
    value = Math.max(-1, Math.min(value, 1));
    value = (value * 0.5 + 0.5) * 255;
    value = Math.round(value) | 0;
    this.dataView.setUint8(this.pos, value);
    this.pos += 1;
  }
  pcm8s(valueIn) {
    let value = valueIn;
    value = Math.round(value * 128) + 128;
    value = Math.max(0, Math.min(value, 255));
    this.dataView.setUint8(this.pos, value);
    this.pos += 1;
  }
  pcm16(valueIn) {
    let value = valueIn;
    value = Math.max(-1, Math.min(value, 1));
    value = value < 0 ? value * 32768 : value * 32767;
    value = Math.round(value) | 0;
    this.dataView.setInt16(this.pos, value, true);
    this.pos += 2;
  }
  pcm16s(valueIn) {
    let value = valueIn;
    value = Math.round(value * 32768);
    value = Math.max(-32768, Math.min(value, 32767));
    this.dataView.setInt16(this.pos, value, true);
    this.pos += 2;
  }
  pcm24(valueIn) {
    let value = valueIn;
    value = Math.max(-1, Math.min(value, 1));
    value = value < 0 ? 16777216 + value * 8388608 : value * 8388607;
    value = Math.round(value) | 0;
    const x0 = value >> 0 & 255;
    const x1 = value >> 8 & 255;
    const x2 = value >> 16 & 255;
    this.dataView.setUint8(this.pos + 0, x0);
    this.dataView.setUint8(this.pos + 1, x1);
    this.dataView.setUint8(this.pos + 2, x2);
    this.pos += 3;
  }
  pcm24s(valueIn) {
    let value = valueIn;
    value = Math.round(value * 8388608);
    value = Math.max(-8388608, Math.min(value, 8388607));
    const x0 = value >> 0 & 255;
    const x1 = value >> 8 & 255;
    const x2 = value >> 16 & 255;
    this.dataView.setUint8(this.pos + 0, x0);
    this.dataView.setUint8(this.pos + 1, x1);
    this.dataView.setUint8(this.pos + 2, x2);
    this.pos += 3;
  }
  pcm32(valueIn) {
    let value = valueIn;
    value = Math.max(-1, Math.min(value, 1));
    value = value < 0 ? value * 2147483648 : value * 2147483647;
    value = Math.round(value) | 0;
    this.dataView.setInt32(this.pos, value, true);
    this.pos += 4;
  }
  pcm32s(valueIn) {
    let value = valueIn;
    value = Math.round(value * 2147483648);
    value = Math.max(-2147483648, Math.min(value, 2147483647));
    this.dataView.setInt32(this.pos, value, true);
    this.pos += 4;
  }
  pcm32f(value) {
    this.dataView.setFloat32(this.pos, value, true);
    this.pos += 4;
  }
};
var WavEncoder_default = WavEncoder;

// src/WavDecoder.ts
var WavDecoder = class {
  static decode(buffer, options) {
    const dataView = new DataView(buffer);
    const reader = new Reader(dataView);
    if (reader.string(4) !== "RIFF") {
      throw new TypeError("Invalid WAV file");
    }
    reader.uint32();
    if (reader.string(4) !== "WAVE") {
      throw new TypeError("Invalid WAV file");
    }
    let format = null;
    let audioData = null;
    do {
      const chunkType = reader.string(4);
      const chunkSize = reader.uint32();
      if (chunkType === "fmt ") {
        format = this.decodeFormat(reader, chunkSize);
      } else if (chunkType === "data") {
        audioData = this.decodeData(reader, chunkSize, format, options || {});
      } else {
        reader.skip(chunkSize);
      }
    } while (audioData === null);
    return audioData;
  }
  static decodeFormat(reader, chunkSize) {
    const formats = {
      1: "lpcm",
      3: "lpcm"
    };
    const formatId = reader.uint16();
    if (!formats.hasOwnProperty(formatId)) {
      throw new TypeError("Unsupported format in WAV file: 0x" + formatId.toString(16));
    }
    const format = {
      formatId,
      float: formatId === 3,
      numberOfChannels: reader.uint16(),
      sampleRate: reader.uint32(),
      byteRate: reader.uint32(),
      blockSize: reader.uint16(),
      bitDepth: reader.uint16()
    };
    reader.skip(chunkSize - 16);
    return format;
  }
  static decodeData(reader, chunkSizeIn, format, options) {
    const chunkSize = Math.min(chunkSizeIn, reader.remain());
    const length = Math.floor(chunkSize / format.blockSize);
    const numberOfChannels = format.numberOfChannels;
    const sampleRate = format.sampleRate;
    const channelData = new Array(numberOfChannels);
    for (let ch = 0; ch < numberOfChannels; ch++) {
      const AB = options.shared ? globalThis.SharedArrayBuffer || globalThis.ArrayBuffer : globalThis.ArrayBuffer;
      const ab = new AB(length * Float32Array.BYTES_PER_ELEMENT);
      channelData[ch] = new Float32Array(ab);
    }
    this.readPCM(reader, channelData, length, format, options);
    return {
      numberOfChannels,
      length,
      sampleRate,
      channelData
    };
  }
  static readPCM(reader, channelData, length, format, options) {
    const bitDepth = format.bitDepth;
    const decoderOption = format.float ? "f" : options.symmetric ? "s" : "";
    const methodName = "pcm" + bitDepth + decoderOption;
    if (!reader[methodName]) {
      throw new TypeError("Not supported bit depth: " + format.bitDepth);
    }
    const read = reader[methodName].bind(reader);
    const numberOfChannels = format.numberOfChannels;
    for (let i = 0; i < length; i++) {
      for (let ch = 0; ch < numberOfChannels; ch++) {
        channelData[ch][i] = read();
      }
    }
  }
};
var Reader = class {
  constructor(dataView) {
    this.pos = 0;
    this.dataView = dataView;
  }
  remain() {
    return this.dataView.byteLength - this.pos;
  }
  skip(n) {
    this.pos += n;
  }
  uint8() {
    const data = this.dataView.getUint8(this.pos);
    this.pos += 1;
    return data;
  }
  int16() {
    const data = this.dataView.getInt16(this.pos, true);
    this.pos += 2;
    return data;
  }
  uint16() {
    const data = this.dataView.getUint16(this.pos, true);
    this.pos += 2;
    return data;
  }
  uint32() {
    const data = this.dataView.getUint32(this.pos, true);
    this.pos += 4;
    return data;
  }
  string(n) {
    let data = "";
    for (let i = 0; i < n; i++) {
      data += String.fromCharCode(this.uint8());
    }
    return data;
  }
  pcm8() {
    const data = this.dataView.getUint8(this.pos) - 128;
    this.pos += 1;
    return data < 0 ? data / 128 : data / 127;
  }
  pcm8s() {
    const data = this.dataView.getUint8(this.pos) - 127.5;
    this.pos += 1;
    return data / 127.5;
  }
  pcm16() {
    const data = this.dataView.getInt16(this.pos, true);
    this.pos += 2;
    return data < 0 ? data / 32768 : data / 32767;
  }
  pcm16s() {
    const data = this.dataView.getInt16(this.pos, true);
    this.pos += 2;
    return data / 32768;
  }
  pcm24() {
    const x0 = this.dataView.getUint8(this.pos + 0);
    const x1 = this.dataView.getUint8(this.pos + 1);
    const x2 = this.dataView.getUint8(this.pos + 2);
    const xx = x0 + (x1 << 8) + (x2 << 16);
    const data = xx > 8388608 ? xx - 16777216 : xx;
    this.pos += 3;
    return data < 0 ? data / 8388608 : data / 8388607;
  }
  pcm24s() {
    const x0 = this.dataView.getUint8(this.pos + 0);
    const x1 = this.dataView.getUint8(this.pos + 1);
    const x2 = this.dataView.getUint8(this.pos + 2);
    const xx = x0 + (x1 << 8) + (x2 << 16);
    const data = xx > 8388608 ? xx - 16777216 : xx;
    this.pos += 3;
    return data / 8388608;
  }
  pcm32() {
    const data = this.dataView.getInt32(this.pos, true);
    this.pos += 4;
    return data < 0 ? data / 2147483648 : data / 2147483647;
  }
  pcm32s() {
    const data = this.dataView.getInt32(this.pos, true);
    this.pos += 4;
    return data / 2147483648;
  }
  pcm32f() {
    const data = this.dataView.getFloat32(this.pos, true);
    this.pos += 4;
    return data;
  }
  pcm64f() {
    const data = this.dataView.getFloat64(this.pos, true);
    this.pos += 8;
    return data;
  }
};
var WavDecoder_default = WavDecoder;

// src/FaustWebAudioDsp.ts
var FaustBaseWebAudioDsp = class {
  constructor(sampleSize, bufferSize) {
    this.fOutputHandler = null;
    this.fComputeHandler = null;
    this.fCachedEvents = [];
    this.fBufferNum = 0;
    this.fPlotHandler = null;
    this.fBufferSize = bufferSize;
    this.fInChannels = [];
    this.fOutChannels = [];
    this.gPtrSize = sampleSize;
    this.gSampleSize = sampleSize;
    this.fOutputsTimer = 5;
    this.fInputsItems = [];
    this.fOutputsItems = [];
    this.fDescriptor = [];
    this.fPitchwheelLabel = [];
    this.fCtrlLabel = new Array(128).fill(null).map(() => []);
    this.fPathTable = {};
    this.fProcessing = false;
    this.fDestroyed = false;
    this.fUICallback = (item) => {
      if (item.type === "hbargraph" || item.type === "vbargraph") {
        this.fOutputsItems.push(item.address);
        this.fPathTable[item.address] = item.index;
      } else if (item.type === "vslider" || item.type === "hslider" || item.type === "button" || item.type === "checkbox" || item.type === "nentry") {
        this.fInputsItems.push(item.address);
        this.fPathTable[item.address] = item.index;
        this.fDescriptor.push(item);
        if (!item.meta)
          return;
        item.meta.forEach((meta) => {
          const { midi } = meta;
          if (!midi)
            return;
          const strMidi = midi.trim();
          if (strMidi === "pitchwheel") {
            this.fPitchwheelLabel.push({ path: item.address, min: item.min, max: item.max });
          } else {
            const matched = strMidi.match(/^ctrl\s(\d+)/);
            if (!matched)
              return;
            this.fCtrlLabel[parseInt(matched[1])].push({ path: item.address, min: item.min, max: item.max });
          }
        });
      }
    };
  }
  static remap(v, mn0, mx0, mn1, mx1) {
    return (v - mn0) / (mx0 - mn0) * (mx1 - mn1) + mn1;
  }
  static parseUI(ui, callback) {
    ui.forEach((group) => this.parseGroup(group, callback));
  }
  static parseGroup(group, callback) {
    if (group.items) {
      this.parseItems(group.items, callback);
    }
  }
  static parseItems(items, callback) {
    items.forEach((item) => this.parseItem(item, callback));
  }
  static parseItem(item, callback) {
    if (item.type === "vgroup" || item.type === "hgroup" || item.type === "tgroup") {
      this.parseItems(item.items, callback);
    } else {
      callback(item);
    }
  }
  updateOutputs() {
    if (this.fOutputsItems.length > 0 && this.fOutputHandler && this.fOutputsTimer-- === 0) {
      this.fOutputsTimer = 5;
      this.fOutputsItems.forEach((item) => this.fOutputHandler?.(item, this.getParamValue(item)));
    }
  }
  metadata(handler) {
    if (this.fJSONDsp.meta) {
      this.fJSONDsp.meta.forEach((meta) => handler(Object.keys(meta)[0], meta[Object.keys(meta)[0]]));
    }
  }
  compute(input, output) {
    return false;
  }
  setOutputParamHandler(handler) {
    this.fOutputHandler = handler;
  }
  getOutputParamHandler() {
    return this.fOutputHandler;
  }
  setComputeHandler(handler) {
    this.fComputeHandler = handler;
  }
  getComputeHandler() {
    return this.fComputeHandler;
  }
  setPlotHandler(handler) {
    this.fPlotHandler = handler;
  }
  getPlotHandler() {
    return this.fPlotHandler;
  }
  getNumInputs() {
    return -1;
  }
  getNumOutputs() {
    return -1;
  }
  midiMessage(data) {
    if (this.fPlotHandler)
      this.fCachedEvents.push({ data, type: "midi" });
    const cmd = data[0] >> 4;
    const channel = data[0] & 15;
    const data1 = data[1];
    const data2 = data[2];
    if (cmd === 11)
      return this.ctrlChange(channel, data1, data2);
    if (cmd === 14)
      return this.pitchWheel(channel, data2 * 128 + data1);
  }
  ctrlChange(channel, ctrl, value) {
    if (this.fPlotHandler)
      this.fCachedEvents.push({ type: "ctrlChange", data: [channel, ctrl, value] });
    if (this.fCtrlLabel[ctrl].length) {
      this.fCtrlLabel[ctrl].forEach((ctrl2) => {
        const { path } = ctrl2;
        this.setParamValue(path, FaustBaseWebAudioDsp.remap(value, 0, 127, ctrl2.min, ctrl2.max));
        if (this.fOutputHandler)
          this.fOutputHandler(path, this.getParamValue(path));
      });
    }
  }
  pitchWheel(channel, wheel) {
    if (this.fPlotHandler)
      this.fCachedEvents.push({ type: "pitchWheel", data: [channel, wheel] });
    this.fPitchwheelLabel.forEach((pw) => {
      this.setParamValue(pw.path, FaustBaseWebAudioDsp.remap(wheel, 0, 16383, pw.min, pw.max));
      if (this.fOutputHandler)
        this.fOutputHandler(pw.path, this.getParamValue(pw.path));
    });
  }
  setParamValue(path, value) {
  }
  getParamValue(path) {
    return 0;
  }
  getParams() {
    return this.fInputsItems;
  }
  getMeta() {
    return this.fJSONDsp;
  }
  getJSON() {
    return JSON.stringify(this.getMeta());
  }
  getUI() {
    return this.fJSONDsp.ui;
  }
  getDescriptors() {
    return this.fDescriptor;
  }
  start() {
    this.fProcessing = true;
  }
  stop() {
    this.fProcessing = false;
  }
  destroy() {
    this.fDestroyed = true;
    this.fOutputHandler = null;
    this.fComputeHandler = null;
    this.fPlotHandler = null;
  }
};
var FaustMonoWebAudioDsp = class extends FaustBaseWebAudioDsp {
  constructor(instance, sampleRate, sampleSize, bufferSize) {
    super(sampleSize, bufferSize);
    this.fInstance = instance;
    this.fJSONDsp = JSON.parse(this.fInstance.json);
    FaustBaseWebAudioDsp.parseUI(this.fJSONDsp.ui, this.fUICallback);
    this.initMemory();
    this.fInstance.api.init(this.fDSP, sampleRate);
  }
  initMemory() {
    this.fDSP = 0;
    const $audio = this.fJSONDsp.size;
    this.fAudioInputs = $audio;
    this.fAudioOutputs = this.fAudioInputs + this.getNumInputs() * this.gPtrSize;
    const $audioInputs = this.fAudioOutputs + this.getNumOutputs() * this.gPtrSize;
    const $audioOutputs = $audioInputs + this.getNumInputs() * this.fBufferSize * this.gSampleSize;
    const HEAP = this.fInstance.memory.buffer;
    const HEAP32 = new Int32Array(HEAP);
    const HEAPF = this.gSampleSize === 4 ? new Float32Array(HEAP) : new Float64Array(HEAP);
    if (this.getNumInputs() > 0) {
      for (let chan = 0; chan < this.getNumInputs(); chan++) {
        HEAP32[(this.fAudioInputs >> 2) + chan] = $audioInputs + this.fBufferSize * this.gSampleSize * chan;
      }
      const dspInChans = HEAP32.subarray(this.fAudioInputs >> 2, this.fAudioInputs + this.getNumInputs() * this.gPtrSize >> 2);
      for (let chan = 0; chan < this.getNumInputs(); chan++) {
        this.fInChannels[chan] = HEAPF.subarray(dspInChans[chan] >> Math.log2(this.gSampleSize), dspInChans[chan] + this.fBufferSize * this.gSampleSize >> Math.log2(this.gSampleSize));
      }
    }
    if (this.getNumOutputs() > 0) {
      for (let chan = 0; chan < this.getNumOutputs(); chan++) {
        HEAP32[(this.fAudioOutputs >> 2) + chan] = $audioOutputs + this.fBufferSize * this.gSampleSize * chan;
      }
      const dspOutChans = HEAP32.subarray(this.fAudioOutputs >> 2, this.fAudioOutputs + this.getNumOutputs() * this.gPtrSize >> 2);
      for (let chan = 0; chan < this.getNumOutputs(); chan++) {
        this.fOutChannels[chan] = HEAPF.subarray(dspOutChans[chan] >> Math.log2(this.gSampleSize), dspOutChans[chan] + this.fBufferSize * this.gSampleSize >> Math.log2(this.gSampleSize));
      }
    }
  }
  toString() {
    return `============== Mono Memory layout ==============
this.fBufferSize: ${this.fBufferSize}
this.fJSONDsp.size: ${this.fJSONDsp.size}
this.fAudioInputs: ${this.fAudioInputs}
this.fAudioOutputs: ${this.fAudioOutputs}
this.fDSP: ${this.fDSP}`;
  }
  compute(input, output) {
    if (this.fDestroyed)
      return false;
    if (!this.fProcessing)
      return true;
    if (this.getNumInputs() > 0 && (!input || !input[0] || input[0].length === 0)) {
      return true;
    }
    if (this.getNumOutputs() > 0 && (!output || !output[0] || output[0].length === 0)) {
      return true;
    }
    if (input !== void 0) {
      for (let chan = 0; chan < Math.min(this.getNumInputs(), input.length); ++chan) {
        const dspInput = this.fInChannels[chan];
        dspInput.set(input[chan]);
      }
    }
    if (this.fComputeHandler)
      this.fComputeHandler(this.fBufferSize);
    this.fInstance.api.compute(this.fDSP, this.fBufferSize, this.fAudioInputs, this.fAudioOutputs);
    this.updateOutputs();
    if (output !== void 0) {
      for (let chan = 0; chan < Math.min(this.getNumOutputs(), output.length); chan++) {
        const dspOutput = this.fOutChannels[chan];
        output[chan].set(dspOutput);
      }
      if (this.fPlotHandler) {
        this.fPlotHandler(output, this.fBufferNum++, this.fCachedEvents.length ? this.fCachedEvents : void 0);
        this.fCachedEvents = [];
      }
    }
    return true;
  }
  metadata(handler) {
    super.metadata(handler);
  }
  getNumInputs() {
    return this.fInstance.api.getNumInputs(this.fDSP);
  }
  getNumOutputs() {
    return this.fInstance.api.getNumOutputs(this.fDSP);
  }
  setParamValue(path, value) {
    if (this.fPlotHandler)
      this.fCachedEvents.push({ type: "param", data: { path, value } });
    this.fInstance.api.setParamValue(this.fDSP, this.fPathTable[path], value);
  }
  getParamValue(path) {
    return this.fInstance.api.getParamValue(this.fDSP, this.fPathTable[path]);
  }
  getMeta() {
    return this.fJSONDsp;
  }
  getJSON() {
    return this.fInstance.json;
  }
  getDescriptors() {
    return this.fDescriptor;
  }
  getUI() {
    return this.fJSONDsp.ui;
  }
};
var FaustWebAudioDspVoice = class {
  constructor($dsp, api, inputItems, pathTable, sampleRate) {
    FaustWebAudioDspVoice.kActiveVoice = 0;
    FaustWebAudioDspVoice.kFreeVoice = -1;
    FaustWebAudioDspVoice.kReleaseVoice = -2;
    FaustWebAudioDspVoice.kLegatoVoice = -3;
    FaustWebAudioDspVoice.kNoVoice = -4;
    FaustWebAudioDspVoice.VOICE_STOP_LEVEL = 5e-4;
    this.fKeyFun = (pitch) => FaustWebAudioDspVoice.midiToFreq(pitch);
    this.fVelFun = (velocity) => velocity / 127;
    this.fCurNote = FaustWebAudioDspVoice.kFreeVoice;
    this.fNextNote = this.fNextVel = -1;
    this.fLevel = 0;
    this.fDate = this.fRelease = 0;
    this.fDSP = $dsp;
    this.fAPI = api;
    this.fGateLabel = [];
    this.fGainLabel = [];
    this.fFreqLabel = [];
    this.fAPI.init(this.fDSP, sampleRate);
    this.extractPaths(inputItems, pathTable);
  }
  static midiToFreq(note) {
    return 440 * 2 ** ((note - 69) / 12);
  }
  extractPaths(inputItems, pathTable) {
    inputItems.forEach((item) => {
      if (item.endsWith("/gate")) {
        this.fGateLabel.push(pathTable[item]);
      } else if (item.endsWith("/freq")) {
        this.fKeyFun = (pitch) => FaustWebAudioDspVoice.midiToFreq(pitch);
        this.fFreqLabel.push(pathTable[item]);
      } else if (item.endsWith("/key")) {
        this.fKeyFun = (pitch) => pitch;
        this.fFreqLabel.push(pathTable[item]);
      } else if (item.endsWith("/gain")) {
        this.fVelFun = (velocity) => velocity / 127;
        this.fGainLabel.push(pathTable[item]);
      } else if (item.endsWith("/vel") && item.endsWith("/velocity")) {
        this.fVelFun = (velocity) => velocity;
        this.fGainLabel.push(pathTable[item]);
      }
    });
  }
  keyOn(pitch, velocity, legato = false) {
    if (legato) {
      this.fNextNote = pitch;
      this.fNextVel = velocity;
    } else {
      this.fFreqLabel.forEach((index) => this.fAPI.setParamValue(this.fDSP, index, this.fKeyFun(pitch)));
      this.fGateLabel.forEach((index) => this.fAPI.setParamValue(this.fDSP, index, 1));
      this.fGainLabel.forEach((index) => this.fAPI.setParamValue(this.fDSP, index, this.fVelFun(velocity)));
      this.fCurNote = pitch;
    }
  }
  keyOff(hard = false) {
    this.fGateLabel.forEach((index) => this.fAPI.setParamValue(this.fDSP, index, 0));
    if (hard) {
      this.fCurNote = FaustWebAudioDspVoice.kFreeVoice;
    } else {
      this.fRelease = this.fAPI.getSampleRate(this.fDSP) / 2;
      this.fCurNote = FaustWebAudioDspVoice.kReleaseVoice;
    }
  }
  computeLegato(bufferSize, $inputs, $outputZero, $outputsHalf) {
    let size = bufferSize / 2;
    this.fGateLabel.forEach((index) => this.fAPI.setParamValue(this.fDSP, index, 0));
    this.fAPI.compute(this.fDSP, size, $inputs, $outputZero);
    this.keyOn(this.fNextNote, this.fNextVel);
    this.fAPI.compute(this.fDSP, size, $inputs, $outputsHalf);
  }
  compute(bufferSize, $inputs, $outputs) {
    this.fAPI.compute(this.fDSP, bufferSize, $inputs, $outputs);
  }
  setParamValue(index, value) {
    this.fAPI.setParamValue(this.fDSP, index, value);
  }
  getParamValue(index) {
    return this.fAPI.getParamValue(this.fDSP, index);
  }
};
var FaustPolyWebAudioDsp = class extends FaustBaseWebAudioDsp {
  constructor(instance, sampleRate, sampleSize, bufferSize) {
    super(sampleSize, bufferSize);
    this.fInstance = instance;
    this.fJSONDsp = JSON.parse(this.fInstance.voiceJSON);
    this.fJSONEffect = this.fInstance.effectAPI && this.fInstance.effectJSON ? JSON.parse(this.fInstance.effectJSON) : null;
    FaustBaseWebAudioDsp.parseUI(this.fJSONDsp.ui, this.fUICallback);
    if (this.fJSONEffect)
      FaustBaseWebAudioDsp.parseUI(this.fJSONEffect.ui, this.fUICallback);
    this.initMemory();
    this.fVoiceTable = [];
    for (let voice = 0; voice < this.fInstance.voices; voice++) {
      this.fVoiceTable.push(new FaustWebAudioDspVoice(this.fJSONDsp.size * voice, this.fInstance.voiceAPI, this.fInputsItems, this.fPathTable, sampleRate));
    }
    if (this.fInstance.effectAPI)
      this.fInstance.effectAPI.init(this.fEffect, sampleRate);
  }
  initMemory() {
    this.fEffect = this.fJSONDsp.size * this.fInstance.voices;
    const $audio = this.fEffect + (this.fJSONEffect ? this.fJSONEffect.size : 0);
    this.fAudioInputs = $audio;
    this.fAudioOutputs = this.fAudioInputs + this.getNumInputs() * this.gPtrSize;
    this.fAudioMixing = this.fAudioOutputs + this.getNumOutputs() * this.gPtrSize;
    this.fAudioMixingHalf = this.fAudioMixing + this.getNumOutputs() * this.gPtrSize;
    const $audioInputs = this.fAudioMixingHalf + this.getNumOutputs() * this.gPtrSize;
    const $audioOutputs = $audioInputs + this.getNumInputs() * this.fBufferSize * this.gSampleSize;
    const $audioMixing = $audioOutputs + this.getNumOutputs() * this.fBufferSize * this.gSampleSize;
    const HEAP = this.fInstance.memory.buffer;
    const HEAP32 = new Int32Array(HEAP);
    const HEAPF = this.gSampleSize === 4 ? new Float32Array(HEAP) : new Float64Array(HEAP);
    if (this.getNumInputs() > 0) {
      for (let chan = 0; chan < this.getNumInputs(); chan++) {
        HEAP32[(this.fAudioInputs >> 2) + chan] = $audioInputs + this.fBufferSize * this.gSampleSize * chan;
      }
      const dspInChans = HEAP32.subarray(this.fAudioInputs >> 2, this.fAudioInputs + this.getNumInputs() * this.gPtrSize >> 2);
      for (let chan = 0; chan < this.getNumInputs(); chan++) {
        this.fInChannels[chan] = HEAPF.subarray(dspInChans[chan] >> Math.log2(this.gSampleSize), dspInChans[chan] + this.fBufferSize * this.gSampleSize >> Math.log2(this.gSampleSize));
      }
    }
    if (this.getNumOutputs() > 0) {
      for (let chan = 0; chan < this.getNumOutputs(); chan++) {
        HEAP32[(this.fAudioOutputs >> 2) + chan] = $audioOutputs + this.fBufferSize * this.gSampleSize * chan;
        HEAP32[(this.fAudioMixing >> 2) + chan] = $audioMixing + this.fBufferSize * this.gSampleSize * chan;
        HEAP32[(this.fAudioMixingHalf >> 2) + chan] = $audioMixing + this.fBufferSize * this.gSampleSize * chan + this.fBufferSize / 2 * this.gSampleSize;
      }
      const dspOutChans = HEAP32.subarray(this.fAudioOutputs >> 2, this.fAudioOutputs + this.getNumOutputs() * this.gPtrSize >> 2);
      for (let chan = 0; chan < this.getNumOutputs(); chan++) {
        this.fOutChannels[chan] = HEAPF.subarray(dspOutChans[chan] >> Math.log2(this.gSampleSize), dspOutChans[chan] + this.fBufferSize * this.gSampleSize >> Math.log2(this.gSampleSize));
      }
    }
  }
  toString() {
    return `============== Poly Memory layout ==============
this.fBufferSize: ${this.fBufferSize}
this.fJSONDsp.size: ${this.fJSONDsp.size}
this.fAudioInputs: ${this.fAudioInputs}
this.fAudioOutputs: ${this.fAudioOutputs}
this.fAudioMixing: ${this.fAudioMixing}
this.fAudioMixingHalf: ${this.fAudioMixingHalf}`;
  }
  allocVoice(voice, type) {
    this.fVoiceTable[voice].fDate++;
    this.fVoiceTable[voice].fCurNote = type;
    return voice;
  }
  getPlayingVoice(pitch) {
    let voicePlaying = FaustWebAudioDspVoice.kNoVoice;
    let oldestDatePlaying = Number.MAX_VALUE;
    for (let voice = 0; voice < this.fInstance.voices; voice++) {
      if (this.fVoiceTable[voice].fCurNote === pitch) {
        if (this.fVoiceTable[voice].fDate < oldestDatePlaying) {
          oldestDatePlaying = this.fVoiceTable[voice].fDate;
          voicePlaying = voice;
        }
      }
    }
    return voicePlaying;
  }
  getFreeVoice() {
    for (let voice = 0; voice < this.fInstance.voices; voice++) {
      if (this.fVoiceTable[voice].fCurNote === FaustWebAudioDspVoice.kFreeVoice) {
        return this.allocVoice(voice, FaustWebAudioDspVoice.kActiveVoice);
      }
    }
    let voiceRelease = FaustWebAudioDspVoice.kNoVoice;
    let voicePlaying = FaustWebAudioDspVoice.kNoVoice;
    let oldestDateRelease = Number.MAX_VALUE;
    let oldestDatePlaying = Number.MAX_VALUE;
    for (let voice = 0; voice < this.fInstance.voices; voice++) {
      if (this.fVoiceTable[voice].fCurNote === FaustWebAudioDspVoice.kReleaseVoice) {
        if (this.fVoiceTable[voice].fDate < oldestDateRelease) {
          oldestDateRelease = this.fVoiceTable[voice].fDate;
          voiceRelease = voice;
        }
      } else if (this.fVoiceTable[voice].fDate < oldestDatePlaying) {
        oldestDatePlaying = this.fVoiceTable[voice].fDate;
        voicePlaying = voice;
      }
    }
    if (oldestDateRelease !== Number.MAX_VALUE) {
      console.log(`Steal release voice : voice_date = ${this.fVoiceTable[voiceRelease].fDate} voice = ${voiceRelease}`);
      return this.allocVoice(voiceRelease, FaustWebAudioDspVoice.kLegatoVoice);
    }
    if (oldestDatePlaying !== Number.MAX_VALUE) {
      console.log(`Steal playing voice : voice_date = ${this.fVoiceTable[voicePlaying].fDate} voice = ${voicePlaying}`);
      return this.allocVoice(voicePlaying, FaustWebAudioDspVoice.kLegatoVoice);
    }
    return FaustWebAudioDspVoice.kNoVoice;
  }
  compute(input, output) {
    if (this.fDestroyed)
      return false;
    if (!this.fProcessing)
      return true;
    if (this.getNumInputs() > 0 && (!input || !input[0] || input[0].length === 0)) {
      return true;
    }
    if (this.getNumOutputs() > 0 && (!output || !output[0] || output[0].length === 0)) {
      return true;
    }
    if (input !== void 0) {
      for (let chan = 0; chan < Math.min(this.getNumInputs(), input.length); ++chan) {
        const dspInput = this.fInChannels[chan];
        dspInput.set(input[chan]);
      }
    }
    if (this.fComputeHandler)
      this.fComputeHandler(this.fBufferSize);
    this.fInstance.mixerAPI.clearOutput(this.fBufferSize, this.getNumOutputs(), this.fAudioOutputs);
    this.fVoiceTable.forEach((voice) => {
      if (voice.fCurNote === FaustWebAudioDspVoice.kLegatoVoice) {
        voice.computeLegato(this.fBufferSize, this.fAudioInputs, this.fAudioMixing, this.fAudioMixingHalf);
        this.fInstance.mixerAPI.fadeOut(this.fBufferSize / 2, this.getNumOutputs(), this.fAudioMixing);
        voice.fLevel = this.fInstance.mixerAPI.mixCheckVoice(this.fBufferSize, this.getNumOutputs(), this.fAudioMixing, this.fAudioOutputs);
      } else if (voice.fCurNote !== FaustWebAudioDspVoice.kFreeVoice) {
        voice.compute(this.fBufferSize, this.fAudioInputs, this.fAudioMixing);
        voice.fLevel = this.fInstance.mixerAPI.mixCheckVoice(this.fBufferSize, this.getNumOutputs(), this.fAudioMixing, this.fAudioOutputs);
        voice.fRelease -= this.fBufferSize;
        if (voice.fCurNote == FaustWebAudioDspVoice.kReleaseVoice && (voice.fLevel < FaustWebAudioDspVoice.VOICE_STOP_LEVEL && voice.fRelease < 0)) {
          voice.fCurNote = FaustWebAudioDspVoice.kFreeVoice;
        }
      }
    });
    if (this.fInstance.effectAPI)
      this.fInstance.effectAPI.compute(this.fEffect, this.fBufferSize, this.fAudioOutputs, this.fAudioOutputs);
    this.updateOutputs();
    if (output !== void 0) {
      for (let chan = 0; chan < Math.min(this.getNumOutputs(), output.length); chan++) {
        const dspOutput = this.fOutChannels[chan];
        output[chan].set(dspOutput);
      }
      if (this.fPlotHandler) {
        this.fPlotHandler(output, this.fBufferNum++, this.fCachedEvents.length ? this.fCachedEvents : void 0);
        this.fCachedEvents = [];
      }
    }
    return true;
  }
  getNumInputs() {
    return this.fInstance.voiceAPI.getNumInputs(0);
  }
  getNumOutputs() {
    return this.fInstance.voiceAPI.getNumOutputs(0);
  }
  static findPath(o, p) {
    if (typeof o !== "object") {
      return false;
    } else if (o.address) {
      return o.address === p;
    } else {
      for (const k in o) {
        if (FaustPolyWebAudioDsp.findPath(o[k], p))
          return true;
      }
      return false;
    }
  }
  setParamValue(path, value) {
    if (this.fPlotHandler)
      this.fCachedEvents.push({ type: "param", data: { path, value } });
    if (this.fJSONEffect && FaustPolyWebAudioDsp.findPath(this.fJSONEffect.ui, path) && this.fInstance.effectAPI) {
      this.fInstance.effectAPI.setParamValue(this.fEffect, this.fPathTable[path], value);
    } else {
      this.fVoiceTable.forEach((voice) => voice.setParamValue(this.fPathTable[path], value));
    }
  }
  getParamValue(path) {
    if (this.fJSONEffect && FaustPolyWebAudioDsp.findPath(this.fJSONEffect.ui, path) && this.fInstance.effectAPI) {
      return this.fInstance.effectAPI.getParamValue(this.fEffect, this.fPathTable[path]);
    } else {
      return this.fVoiceTable[0].getParamValue(this.fPathTable[path]);
    }
  }
  getMeta() {
    const o = this.fJSONDsp;
    const e = this.fJSONEffect;
    const r = { ...o };
    if (e) {
      r.ui = [{
        type: "tgroup",
        label: "Sequencer",
        items: [
          { type: "vgroup", label: "Instrument", items: o.ui },
          { type: "vgroup", label: "Effect", items: e.ui }
        ]
      }];
    } else {
      r.ui = [{
        type: "tgroup",
        label: "Polyphonic",
        items: [
          { type: "vgroup", label: "Voices", items: o.ui }
        ]
      }];
    }
    return r;
  }
  getJSON() {
    return JSON.stringify(this.getMeta());
  }
  getUI() {
    return this.getMeta().ui;
  }
  getDescriptors() {
    return this.fDescriptor;
  }
  midiMessage(data) {
    const cmd = data[0] >> 4;
    const channel = data[0] & 15;
    const data1 = data[1];
    const data2 = data[2];
    if (cmd === 8 || cmd === 9 && data2 === 0)
      return this.keyOff(channel, data1, data2);
    else if (cmd === 9)
      return this.keyOn(channel, data1, data2);
    else
      super.midiMessage(data);
  }
  ctrlChange(channel, ctrl, value) {
    if (ctrl === 123 || ctrl === 120) {
      this.allNotesOff(true);
    } else {
      super.ctrlChange(channel, ctrl, value);
    }
  }
  keyOn(channel, pitch, velocity) {
    const voice = this.getFreeVoice();
    this.fVoiceTable[voice].keyOn(pitch, velocity, this.fVoiceTable[voice].fCurNote == FaustWebAudioDspVoice.kLegatoVoice);
  }
  keyOff(channel, pitch, velocity) {
    const voice = this.getPlayingVoice(pitch);
    if (voice !== FaustWebAudioDspVoice.kNoVoice) {
      this.fVoiceTable[voice].keyOff();
    } else {
      console.log("Playing pitch = %d not found\n", pitch);
    }
  }
  allNotesOff(hard = true) {
    this.fCachedEvents.push({ type: "ctrlChange", data: [0, 123, 0] });
    this.fVoiceTable.forEach((voice) => voice.keyOff(hard));
  }
};

// src/FaustAudioWorkletNode.ts
var FaustAudioWorkletNode = class extends (globalThis.AudioWorkletNode || null) {
  constructor(context, name, factory, options) {
    const JSONObj = JSON.parse(factory.json);
    super(context, name, {
      numberOfInputs: JSONObj.inputs > 0 ? 1 : 0,
      numberOfOutputs: JSONObj.outputs > 0 ? 1 : 0,
      channelCount: Math.max(1, JSONObj.inputs),
      outputChannelCount: [JSONObj.outputs],
      channelCountMode: "explicit",
      channelInterpretation: "speakers",
      processorOptions: options
    });
    this.fJSONDsp = JSONObj;
    this.fJSON = factory.json;
    this.fOutputHandler = null;
    this.fComputeHandler = null;
    this.fPlotHandler = null;
    this.fDescriptor = [];
    this.fInputsItems = [];
    this.fUICallback = (item) => {
      if (item.type === "vslider" || item.type === "hslider" || item.type === "button" || item.type === "checkbox" || item.type === "nentry") {
        this.fInputsItems.push(item.address);
        this.fDescriptor.push(item);
      }
    };
    FaustBaseWebAudioDsp.parseUI(this.fJSONDsp.ui, this.fUICallback);
    this.port.onmessage = (e) => {
      if (e.data.type === "param" && this.fOutputHandler) {
        this.fOutputHandler(e.data.path, e.data.value);
      } else if (e.data.type === "plot" && this.fPlotHandler) {
        this.fPlotHandler(e.data.value, e.data.index, e.data.events);
      }
    };
  }
  setOutputParamHandler(handler) {
    this.fOutputHandler = handler;
  }
  getOutputParamHandler() {
    return this.fOutputHandler;
  }
  setComputeHandler(handler) {
    this.fComputeHandler = handler;
  }
  getComputeHandler() {
    return this.fComputeHandler;
  }
  setPlotHandler(handler) {
    this.fPlotHandler = handler;
    if (this.fPlotHandler) {
      this.port.postMessage({ type: "setPlotHandler", data: true });
    } else {
      this.port.postMessage({ type: "setPlotHandler", data: false });
    }
  }
  getPlotHandler() {
    return this.fPlotHandler;
  }
  getNumInputs() {
    return this.fJSONDsp.inputs;
  }
  getNumOutputs() {
    return this.fJSONDsp.outputs;
  }
  compute(inputs, outputs) {
    return false;
  }
  metadata(handler) {
    if (this.fJSONDsp.meta) {
      this.fJSONDsp.meta.forEach((meta) => handler(Object.keys(meta)[0], meta[Object.keys(meta)[0]]));
    }
  }
  midiMessage(data) {
    const cmd = data[0] >> 4;
    const channel = data[0] & 15;
    const data1 = data[1];
    const data2 = data[2];
    if (cmd === 11)
      this.ctrlChange(channel, data1, data2);
    else if (cmd === 14)
      this.pitchWheel(channel, data2 * 128 + data1);
    else
      this.port.postMessage({ type: "midi", data });
  }
  ctrlChange(channel, ctrl, value) {
    const e = { type: "ctrlChange", data: [channel, ctrl, value] };
    this.port.postMessage(e);
  }
  pitchWheel(channel, wheel) {
    const e = { type: "pitchWheel", data: [channel, wheel] };
    this.port.postMessage(e);
  }
  setParamValue(path, value) {
    const e = { type: "param", data: { path, value } };
    this.port.postMessage(e);
    const param = this.parameters.get(path);
    if (param)
      param.setValueAtTime(value, this.context.currentTime);
  }
  getParamValue(path) {
    const param = this.parameters.get(path);
    return param ? param.value : 0;
  }
  getParams() {
    return this.fInputsItems;
  }
  getMeta() {
    return this.fJSONDsp;
  }
  getJSON() {
    return JSON.stringify(this.getMeta());
  }
  getUI() {
    return this.fJSONDsp.ui;
  }
  getDescriptors() {
    return this.fDescriptor;
  }
  start() {
    this.port.postMessage({ type: "start" });
  }
  stop() {
    this.port.postMessage({ type: "stop" });
  }
  destroy() {
    this.port.postMessage({ type: "destroy" });
    this.port.close();
  }
};
var FaustMonoAudioWorkletNode = class extends FaustAudioWorkletNode {
  constructor(context, name, factory, sampleSize) {
    super(context, name, factory, { name, factory, sampleSize });
    this.onprocessorerror = (e) => {
      console.error("Error from " + this.fJSONDsp.name + " FaustMonoAudioWorkletNode");
      throw e;
    };
  }
};
var FaustPolyAudioWorkletNode = class extends FaustAudioWorkletNode {
  constructor(context, name, voiceFactory, mixerModule, voices, sampleSize, effectFactory) {
    super(context, name, voiceFactory, {
      name,
      voiceFactory,
      mixerModule,
      voices,
      sampleSize,
      effectFactory
    });
    this.onprocessorerror = (e) => {
      console.error("Error from " + this.fJSONDsp.name + " FaustPolyAudioWorkletNode");
      throw e;
    };
    this.fJSONEffect = effectFactory ? JSON.parse(effectFactory.json) : null;
    if (this.fJSONEffect) {
      FaustBaseWebAudioDsp.parseUI(this.fJSONEffect.ui, this.fUICallback);
    }
  }
  keyOn(channel, pitch, velocity) {
    const e = { type: "keyOn", data: [channel, pitch, velocity] };
    this.port.postMessage(e);
  }
  keyOff(channel, pitch, velocity) {
    const e = { type: "keyOff", data: [channel, pitch, velocity] };
    this.port.postMessage(e);
  }
  allNotesOff(hard) {
    const e = { type: "ctrlChange", data: [0, 123, 0] };
    this.port.postMessage(e);
  }
  getMeta() {
    const o = this.fJSONDsp;
    const e = this.fJSONEffect;
    const r = { ...o };
    if (e) {
      r.ui = [{
        type: "tgroup",
        label: "Sequencer",
        items: [
          { type: "vgroup", label: "Instrument", items: o.ui },
          { type: "vgroup", label: "Effect", items: e.ui }
        ]
      }];
    } else {
      r.ui = [{
        type: "tgroup",
        label: "Polyphonic",
        items: [
          { type: "vgroup", label: "Voices", items: o.ui }
        ]
      }];
    }
    return r;
  }
  getJSON() {
    return JSON.stringify(this.getMeta());
  }
  getUI() {
    return this.getMeta().ui;
  }
};

// src/FaustScriptProcessorNode.ts
var FaustScriptProcessorNode = class extends (globalThis.ScriptProcessorNode || null) {
  init(instance) {
    this.fDSPCode = instance;
    this.fInputs = new Array(this.fDSPCode.getNumInputs());
    this.fOutputs = new Array(this.fDSPCode.getNumOutputs());
    this.onaudioprocess = (e) => {
      for (let chan = 0; chan < this.fDSPCode.getNumInputs(); chan++) {
        this.fInputs[chan] = e.inputBuffer.getChannelData(chan);
      }
      for (let chan = 0; chan < this.fDSPCode.getNumOutputs(); chan++) {
        this.fOutputs[chan] = e.outputBuffer.getChannelData(chan);
      }
      return this.fDSPCode.compute(this.fInputs, this.fOutputs);
    };
    this.start();
  }
  compute(input, output) {
    return this.fDSPCode.compute(input, output);
  }
  setOutputParamHandler(handler) {
    this.fDSPCode.setOutputParamHandler(handler);
  }
  getOutputParamHandler() {
    return this.fDSPCode.getOutputParamHandler();
  }
  setComputeHandler(handler) {
    this.fDSPCode.setComputeHandler(handler);
  }
  getComputeHandler() {
    return this.fDSPCode.getComputeHandler();
  }
  setPlotHandler(handler) {
    this.fDSPCode.setPlotHandler(handler);
  }
  getPlotHandler() {
    return this.fDSPCode.getPlotHandler();
  }
  getNumInputs() {
    return this.fDSPCode.getNumInputs();
  }
  getNumOutputs() {
    return this.fDSPCode.getNumOutputs();
  }
  metadata(handler) {
  }
  midiMessage(data) {
    this.fDSPCode.midiMessage(data);
  }
  ctrlChange(chan, ctrl, value) {
    this.fDSPCode.ctrlChange(chan, ctrl, value);
  }
  pitchWheel(chan, value) {
    this.fDSPCode.pitchWheel(chan, value);
  }
  setParamValue(path, value) {
    this.fDSPCode.setParamValue(path, value);
  }
  getParamValue(path) {
    return this.fDSPCode.getParamValue(path);
  }
  getParams() {
    return this.fDSPCode.getParams();
  }
  getMeta() {
    return this.fDSPCode.getMeta();
  }
  getJSON() {
    return this.fDSPCode.getJSON();
  }
  getDescriptors() {
    return this.fDSPCode.getDescriptors();
  }
  getUI() {
    return this.fDSPCode.getUI();
  }
  start() {
    this.fDSPCode.start();
  }
  stop() {
    this.fDSPCode.stop();
  }
  destroy() {
    this.fDSPCode.destroy();
  }
};
var FaustMonoScriptProcessorNode = class extends FaustScriptProcessorNode {
};
var FaustPolyScriptProcessorNode = class extends FaustScriptProcessorNode {
  keyOn(channel, pitch, velocity) {
    this.fDSPCode.keyOn(channel, pitch, velocity);
  }
  keyOff(channel, pitch, velocity) {
    this.fDSPCode.keyOff(channel, pitch, velocity);
  }
  allNotesOff(hard) {
    this.fDSPCode.allNotesOff(hard);
  }
};

// src/FaustDspGenerator.ts
var _FaustMonoDspGenerator = class {
  constructor() {
    this.factory = null;
  }
  async compile(compiler, name, code, args) {
    this.factory = await compiler.createMonoDSPFactory(name, code, args);
    if (!this.factory)
      return null;
    this.name = name + this.factory.cfactory.toString();
    return this;
  }
  async createNode(context, name = this.name, factory = this.factory, sp = false, bufferSize = 1024) {
    if (!factory)
      throw new Error("Code is not compiled, please define the factory or call `await this.compile()` first.");
    const meta = JSON.parse(factory.json);
    const sampleSize = meta.compile_options.match("-double") ? 8 : 4;
    if (sp) {
      const instance = await FaustWasmInstantiator_default.createAsyncMonoDSPInstance(factory);
      const monoDsp = new FaustMonoWebAudioDsp(instance, context.sampleRate, sampleSize, bufferSize);
      const sp2 = context.createScriptProcessor(bufferSize, monoDsp.getNumInputs(), monoDsp.getNumOutputs());
      Object.setPrototypeOf(sp2, FaustMonoScriptProcessorNode.prototype);
      sp2.init(monoDsp);
      return sp2;
    } else {
      if (!_FaustMonoDspGenerator.gWorkletProcessors.has(name)) {
        try {
          const processorCode = `
// DSP name and JSON string for DSP are generated
const faustData = ${JSON.stringify({
            dspName: name,
            dspMeta: meta,
            poly: false
          })};
// Implementation needed classes of functions
const ${FaustDspInstance_default.name}_default = ${FaustDspInstance_default.toString()}
const ${FaustBaseWebAudioDsp.name} = ${FaustBaseWebAudioDsp.toString()}
const ${FaustMonoWebAudioDsp.name} = ${FaustMonoWebAudioDsp.toString()}
const ${FaustWasmInstantiator_default.name} = ${FaustWasmInstantiator_default.toString()}
// Put them in dependencies
const dependencies = {
    ${FaustBaseWebAudioDsp.name},
    ${FaustMonoWebAudioDsp.name},
    ${FaustWasmInstantiator_default.name}
};
// Generate the actual AudioWorkletProcessor code
(${FaustAudioWorkletProcessor_default.toString()})(dependencies, faustData);
`;
          const url = URL.createObjectURL(new Blob([processorCode], { type: "text/javascript" }));
          await context.audioWorklet.addModule(url);
          _FaustMonoDspGenerator.gWorkletProcessors.add(name);
        } catch (e) {
          console.error(`=> exception raised while running createMonoNode: ${e}`);
          console.error(`=> check that your page is served using https.${e}`);
          return null;
        }
      }
      const node = new FaustMonoAudioWorkletNode(context, name, factory, sampleSize);
      return node;
    }
  }
  async createOfflineProcessor(sampleRate, bufferSize, factory = this.factory) {
    if (!factory)
      throw new Error("Code is not compiled, please define the factory or call `await this.compile()` first.");
    const meta = JSON.parse(factory.json);
    const instance = await FaustWasmInstantiator_default.createAsyncMonoDSPInstance(factory);
    const sampleSize = meta.compile_options.match("-double") ? 8 : 4;
    const monoDsp = new FaustMonoWebAudioDsp(instance, sampleRate, sampleSize, bufferSize);
    return new FaustOfflineProcessor_default(monoDsp, bufferSize);
  }
};
var FaustMonoDspGenerator = _FaustMonoDspGenerator;
FaustMonoDspGenerator.gWorkletProcessors = new Set();
var _FaustPolyDspGenerator = class {
  constructor() {
    this.voiceFactory = null;
    this.effectFactory = null;
  }
  async compile(compiler, name, dspCode, args, effectCode = `
adapt(1,1) = _; adapt(2,2) = _,_; adapt(1,2) = _ <: _,_; adapt(2,1) = _,_ :> _;
adaptor(F,G) = adapt(outputs(F),inputs(G));
dsp_code = environment{${dspCode}};
process = adaptor(dsp_code.process, dsp_code.effect) : dsp_code.effect;`) {
    this.voiceFactory = await compiler.createPolyDSPFactory(name, dspCode, args);
    if (!this.voiceFactory)
      return null;
    this.effectFactory = await compiler.createPolyDSPFactory(name, effectCode, args);
    this.name = name + this.voiceFactory.cfactory.toString() + "_poly";
    const voiceMeta = JSON.parse(this.voiceFactory.json);
    const isDouble = voiceMeta.compile_options.match("-double");
    const { mixerBuffer, mixerModule } = await compiler.getAsyncInternalMixerModule(!!isDouble);
    this.mixerBuffer = mixerBuffer;
    this.mixerModule = mixerModule;
    return this;
  }
  async createNode(context, voices, name = this.name, voiceFactory = this.voiceFactory, mixerModule = this.mixerModule, effectFactory = this.effectFactory, sp = false, bufferSize = 1024) {
    if (!voiceFactory)
      throw new Error("Code is not compiled, please define the factory or call `await this.compile()` first.");
    const voiceMeta = JSON.parse(voiceFactory.json);
    const effectMeta = effectFactory ? JSON.parse(effectFactory.json) : void 0;
    const sampleSize = voiceMeta.compile_options.match("-double") ? 8 : 4;
    if (sp) {
      const instance = await FaustWasmInstantiator_default.createAsyncPolyDSPInstance(voiceFactory, mixerModule, voices, effectFactory || void 0);
      const polyDsp = new FaustPolyWebAudioDsp(instance, context.sampleRate, sampleSize, bufferSize);
      const sp2 = context.createScriptProcessor(bufferSize, polyDsp.getNumInputs(), polyDsp.getNumOutputs());
      Object.setPrototypeOf(sp2, FaustPolyScriptProcessorNode.prototype);
      sp2.init(polyDsp);
      return sp2;
    } else {
      if (!_FaustPolyDspGenerator.gWorkletProcessors.has(name)) {
        try {
          const processorCode = `
// DSP name and JSON string for DSP are generated
const faustData = ${JSON.stringify({
            dspName: name,
            dspMeta: voiceMeta,
            poly: true,
            effectMeta
          })};
// Implementation needed classes of functions
const ${FaustDspInstance_default.name}_default = ${FaustDspInstance_default.toString()}
const ${FaustBaseWebAudioDsp.name} = ${FaustBaseWebAudioDsp.toString()}
const ${FaustPolyWebAudioDsp.name} = ${FaustPolyWebAudioDsp.toString()}
const ${FaustWebAudioDspVoice.name} = ${FaustWebAudioDspVoice.toString()}
const ${FaustWasmInstantiator_default.name} = ${FaustWasmInstantiator_default.toString()}
// Put them in dependencies
const dependencies = {
    ${FaustBaseWebAudioDsp.name},
    ${FaustPolyWebAudioDsp.name},
    ${FaustWasmInstantiator_default.name}
};
// Generate the actual AudioWorkletProcessor code
(${FaustAudioWorkletProcessor_default.toString()})(dependencies, faustData);
`;
          const url = URL.createObjectURL(new Blob([processorCode], { type: "text/javascript" }));
          await context.audioWorklet.addModule(url);
          _FaustPolyDspGenerator.gWorkletProcessors.add(name);
        } catch (e) {
          console.error(`=> exception raised while running createMonoNode: ${e}`);
          console.error(`=> check that your page is served using https.${e}`);
          return null;
        }
      }
      const node = new FaustPolyAudioWorkletNode(context, name, voiceFactory, mixerModule, voices, sampleSize, effectFactory || void 0);
      return node;
    }
  }
};
var FaustPolyDspGenerator = _FaustPolyDspGenerator;
FaustPolyDspGenerator.gWorkletProcessors = new Set();

// src/index.ts
var src_default = {
  instantiateFaustModuleFromFile: instantiateFaustModuleFromFile_default,
  getFaustAudioWorkletProcessor: FaustAudioWorkletProcessor_default,
  FaustDspInstance: FaustDspInstance_default,
  FaustCompiler: FaustCompiler_default,
  FaustWasmInstantiator: FaustWasmInstantiator_default,
  FaustOfflineProcessor: FaustOfflineProcessor_default,
  FaustSvgDiagrams: FaustSvgDiagrams_default,
  LibFaust: LibFaust_default,
  WavEncoder: WavEncoder_default,
  WavDecoder: WavDecoder_default
};
export {
  FaustAudioWorkletNode,
  FaustBaseWebAudioDsp,
  FaustCompiler_default as FaustCompiler,
  FaustDspInstance_default as FaustDspInstance,
  FaustMonoAudioWorkletNode,
  FaustMonoDspGenerator,
  FaustMonoScriptProcessorNode,
  FaustMonoWebAudioDsp,
  FaustOfflineProcessor_default as FaustOfflineProcessor,
  FaustPolyAudioWorkletNode,
  FaustPolyDspGenerator,
  FaustPolyScriptProcessorNode,
  FaustPolyWebAudioDsp,
  FaustScriptProcessorNode,
  FaustSvgDiagrams_default as FaustSvgDiagrams,
  FaustWasmInstantiator_default as FaustWasmInstantiator,
  FaustWebAudioDspVoice,
  LibFaust_default as LibFaust,
  WavDecoder_default as WavDecoder,
  WavEncoder_default as WavEncoder,
  src_default as default,
  FaustAudioWorkletProcessor_default as getFaustAudioWorkletProcessor,
  instantiateFaustModuleFromFile_default as instantiateFaustModuleFromFile
};
//# sourceMappingURL=index.js.map
