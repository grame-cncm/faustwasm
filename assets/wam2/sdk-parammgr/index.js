var __defProp = Object.defineProperty;
var __defProps = Object.defineProperties;
var __getOwnPropDescs = Object.getOwnPropertyDescriptors;
var __getOwnPropSymbols = Object.getOwnPropertySymbols;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __propIsEnum = Object.prototype.propertyIsEnumerable;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __spreadValues = (a, b) => {
  for (var prop in b || (b = {}))
    if (__hasOwnProp.call(b, prop))
      __defNormalProp(a, prop, b[prop]);
  if (__getOwnPropSymbols)
    for (var prop of __getOwnPropSymbols(b)) {
      if (__propIsEnum.call(b, prop))
        __defNormalProp(a, prop, b[prop]);
    }
  return a;
};
var __spreadProps = (a, b) => __defProps(a, __getOwnPropDescs(b));
var __publicField = (obj, key, value) => {
  __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
  return value;
};

// src/CompositeAudioNode.js
var CompositeAudioNode = class extends GainNode {
  constructor() {
    super(...arguments);
    __publicField(this, "_output");
    __publicField(this, "_wamNode");
  }
  get processorId() {
    return this._wamNode.processorId;
  }
  get instanceId() {
    return this._wamNode.instanceId;
  }
  get module() {
    return this._wamNode.module;
  }
  getParameterInfo(...args) {
    return this._wamNode.getParameterInfo(...args);
  }
  getParameterValues(...args) {
    return this._wamNode.getParameterValues(...args);
  }
  setParameterValues(...args) {
    return this._wamNode.setParameterValues(...args);
  }
  getState() {
    return this._wamNode.getState();
  }
  setState(...args) {
    return this._wamNode.setState(...args);
  }
  getCompensationDelay() {
    return this._wamNode.getCompensationDelay();
  }
  scheduleEvents(...args) {
    return this._wamNode.scheduleEvents(...args);
  }
  clearEvents() {
    return this._wamNode.clearEvents();
  }
  connectEvents(...args) {
    return this._wamNode.connectEvents(...args);
  }
  disconnectEvents(...args) {
    return this._wamNode.disconnectEvents(...args);
  }
  destroy() {
    return this._wamNode.destroy();
  }
  set channelCount(count) {
    if (this._output)
      this._output.channelCount = count;
    else
      super.channelCount = count;
  }
  get channelCount() {
    if (this._output)
      return this._output.channelCount;
    return super.channelCount;
  }
  set channelCountMode(mode) {
    if (this._output)
      this._output.channelCountMode = mode;
    else
      super.channelCountMode = mode;
  }
  get channelCountMode() {
    if (this._output)
      return this._output.channelCountMode;
    return super.channelCountMode;
  }
  set channelInterpretation(interpretation) {
    if (this._output)
      this._output.channelInterpretation = interpretation;
    else
      super.channelInterpretation = interpretation;
  }
  get channelInterpretation() {
    if (this._output)
      return this._output.channelInterpretation;
    return super.channelInterpretation;
  }
  get numberOfInputs() {
    return super.numberOfInputs;
  }
  get numberOfOutputs() {
    if (this._output)
      return this._output.numberOfOutputs;
    return super.numberOfOutputs;
  }
  get gain() {
    return void 0;
  }
  connect(...args) {
    if (this._output && this._output !== this)
      return this._output.connect(...args);
    return super.connect(...args);
  }
  disconnect(...args) {
    if (this._output && this._output !== this)
      return this._output.disconnect(...args);
    return super.disconnect(...args);
  }
};

// src/sdk/src/addFunctionModule.js
var addFunctionModule = (audioWorklet, processorFunction, ...injection) => {
  const text = `(${processorFunction.toString()})(${injection.map((s) => JSON.stringify(s)).join(", ")});`;
  const url = URL.createObjectURL(new Blob([text], { type: "text/javascript" }));
  return audioWorklet.addModule(url);
};
var addFunctionModule_default = addFunctionModule;

// src/ParamMgrProcessor.js
var processor = (processorId, paramsConfig) => {
  const audioWorkletGlobalScope2 = globalThis;
  const { AudioWorkletProcessor, registerProcessor } = audioWorkletGlobalScope2;
  const supportSharedArrayBuffer = !!globalThis.SharedArrayBuffer;
  const SharedArrayBuffer = globalThis.SharedArrayBuffer || globalThis.ArrayBuffer;
  const normExp = (x, e) => e === 0 ? x : x ** 1.5 ** -e;
  const normalizeE = (x, min, max, e = 0) => min === 0 && max === 1 ? normExp(x, e) : normExp((x - min) / (max - min) || 0, e);
  const normalize = (x, min, max) => min === 0 && max === 1 ? x : (x - min) / (max - min) || 0;
  const denormalize = (x, min, max) => min === 0 && max === 1 ? x : x * (max - min) + min;
  const mapValue = (x, eMin, eMax, sMin, sMax, tMin, tMax) => denormalize(normalize(normalize(Math.min(sMax, Math.max(sMin, x)), eMin, eMax), normalize(sMin, eMin, eMax), normalize(sMax, eMin, eMax)), tMin, tMax);
  class ParamMgrProcessor extends AudioWorkletProcessor {
    static get parameterDescriptors() {
      return Object.entries(paramsConfig).map(([name, { defaultValue, minValue, maxValue }]) => ({
        name,
        defaultValue,
        minValue,
        maxValue
      }));
    }
    constructor(options) {
      super(options);
      this.destroyed = false;
      this.supportSharedArrayBuffer = supportSharedArrayBuffer;
      const {
        paramsMapping,
        internalParamsMinValues,
        internalParams,
        instanceId
      } = options.processorOptions;
      this.moduleId = processorId;
      this.instanceId = instanceId;
      this.internalParamsMinValues = internalParamsMinValues;
      this.paramsConfig = paramsConfig;
      this.paramsMapping = paramsMapping;
      this.paramsValues = {};
      Object.entries(paramsConfig).forEach(([name, { defaultValue }]) => {
        this.paramsValues[name] = defaultValue;
      });
      this.internalParams = internalParams;
      this.internalParamsCount = this.internalParams.length;
      this.buffer = new SharedArrayBuffer((this.internalParamsCount + 1) * Float32Array.BYTES_PER_ELEMENT);
      this.$lock = new Int32Array(this.buffer, 0, 1);
      this.$internalParamsBuffer = new Float32Array(this.buffer, 4, this.internalParamsCount);
      this.eventQueue = [];
      this.handleEvent = null;
      audioWorkletGlobalScope2.webAudioModules.create(this);
      this.messagePortRequestId = -1;
      const resolves = {};
      const rejects = {};
      this.call = (call, ...args) => new Promise((resolve, reject) => {
        const id = this.messagePortRequestId--;
        resolves[id] = resolve;
        rejects[id] = reject;
        this.port.postMessage({ id, call, args });
      });
      this.handleMessage = ({ data }) => {
        const { id, call, args, value, error } = data;
        if (call) {
          const r = { id };
          try {
            r.value = this[call](...args);
          } catch (e) {
            r.error = e;
          }
          this.port.postMessage(r);
        } else {
          if (error) {
            if (rejects[id])
              rejects[id](error);
            delete rejects[id];
            return;
          }
          if (resolves[id]) {
            resolves[id](value);
            delete resolves[id];
          }
        }
      };
      this.port.start();
      this.port.addEventListener("message", this.handleMessage);
    }
    setParamsMapping(mapping) {
      this.paramsMapping = mapping;
    }
    getBuffer() {
      return { lock: this.$lock, paramsBuffer: this.$internalParamsBuffer };
    }
    getCompensationDelay() {
      return 128;
    }
    getParameterInfo(...parameterIdQuery) {
      if (parameterIdQuery.length === 0)
        parameterIdQuery = Object.keys(this.paramsConfig);
      const parameterInfo = {};
      parameterIdQuery.forEach((parameterId) => {
        parameterInfo[parameterId] = this.paramsConfig[parameterId];
      });
      return parameterInfo;
    }
    getParameterValues(normalized, ...parameterIdQuery) {
      if (parameterIdQuery.length === 0)
        parameterIdQuery = Object.keys(this.paramsConfig);
      const parameterValues = {};
      parameterIdQuery.forEach((parameterId) => {
        if (!(parameterId in this.paramsValues))
          return;
        const { minValue, maxValue, exponent } = this.paramsConfig[parameterId];
        const value = this.paramsValues[parameterId];
        parameterValues[parameterId] = {
          id: parameterId,
          value: normalized ? normalizeE(value, minValue, maxValue, exponent) : value,
          normalized
        };
      });
      return parameterValues;
    }
    scheduleEvents(...events) {
      this.eventQueue.push(...events);
      const { currentTime } = audioWorkletGlobalScope2;
      this.eventQueue.sort((a, b) => (a.time || currentTime) - (b.time || currentTime));
    }
    get downstream() {
      const wams = new Set();
      const { eventGraph } = audioWorkletGlobalScope2.webAudioModules;
      if (!eventGraph.has(this))
        return wams;
      const outputMap = eventGraph.get(this);
      outputMap.forEach((set) => {
        if (set)
          set.forEach((wam) => wams.add(wam));
      });
      return wams;
    }
    emitEvents(...events) {
      const { eventGraph } = audioWorkletGlobalScope2.webAudioModules;
      if (!eventGraph.has(this))
        return;
      const downstream = eventGraph.get(this);
      downstream.forEach((set) => {
        if (set)
          set.forEach((wam) => wam.scheduleEvents(...events));
      });
    }
    clearEvents() {
      this.eventQueue = [];
    }
    lock() {
      if (globalThis.Atomics)
        Atomics.store(this.$lock, 0, 1);
    }
    unlock() {
      if (globalThis.Atomics)
        Atomics.store(this.$lock, 0, 0);
    }
    process(inputs, outputs, parameters) {
      if (this.destroyed)
        return false;
      const outputOffset = 1;
      this.lock();
      Object.entries(this.paramsConfig).forEach(([name, { minValue, maxValue }]) => {
        const raw = parameters[name];
        if (name in this.paramsValues)
          this.paramsValues[name] = raw[raw.length - 1];
        if (!this.paramsMapping[name])
          return;
        Object.entries(this.paramsMapping[name]).forEach(([targetName, targetMapping]) => {
          const j = this.internalParams.indexOf(targetName);
          if (j === -1)
            return;
          const intrinsicValue = this.internalParamsMinValues[j];
          const { sourceRange, targetRange } = targetMapping;
          const [sMin, sMax] = sourceRange;
          const [tMin, tMax] = targetRange;
          let out;
          if (minValue !== tMin || maxValue !== tMax || minValue !== sMin || maxValue !== sMax) {
            out = raw.map((v) => {
              const mappedValue = mapValue(v, minValue, maxValue, sMin, sMax, tMin, tMax);
              return mappedValue - intrinsicValue;
            });
          } else if (intrinsicValue) {
            out = raw.map((v) => v - intrinsicValue);
          } else {
            out = raw;
          }
          if (out.length === 1)
            outputs[j + outputOffset][0].fill(out[0]);
          else
            outputs[j + outputOffset][0].set(out);
          this.$internalParamsBuffer[j] = out[0];
        });
      });
      this.unlock();
      if (!this.supportSharedArrayBuffer) {
        this.call("setBuffer", { lock: this.$lock, paramsBuffer: this.$internalParamsBuffer });
      }
      const { currentTime } = audioWorkletGlobalScope2;
      let $event;
      for ($event = 0; $event < this.eventQueue.length; $event++) {
        const event = this.eventQueue[$event];
        if (event.time && event.time > currentTime)
          break;
        if (typeof this.handleEvent === "function")
          this.handleEvent(event);
        this.call("dispatchWamEvent", event);
      }
      if ($event)
        this.eventQueue.splice(0, $event);
      return true;
    }
    connectEvents(wamInstanceId, output) {
      const wam = audioWorkletGlobalScope2.webAudioModules.processors[wamInstanceId];
      if (!wam)
        return;
      audioWorkletGlobalScope2.webAudioModules.connectEvents(this, wam, output);
    }
    disconnectEvents(wamInstanceId, output) {
      if (typeof wamInstanceId === "undefined") {
        audioWorkletGlobalScope2.webAudioModules.disconnectEvents(this);
        return;
      }
      const wam = audioWorkletGlobalScope2.webAudioModules.processors[wamInstanceId];
      if (!wam)
        return;
      audioWorkletGlobalScope2.webAudioModules.disconnectEvents(this, wam, output);
    }
    destroy() {
      audioWorkletGlobalScope2.webAudioModules.destroy(this);
      this.destroyed = true;
      this.port.close();
    }
  }
  try {
    registerProcessor(processorId, ParamMgrProcessor);
  } catch (error) {
    console.warn(error);
  }
};
var ParamMgrProcessor_default = processor;

// src/sdk/src/WamParameterInfo.js
var getWamParameterInfo = (uuid) => {
  const normExp = (x, e) => e === 0 ? x : x ** 1.5 ** -e;
  const denormExp = (x, e) => e === 0 ? x : x ** 1.5 ** e;
  const normalize = (x, min, max, e = 0) => min === 0 && max === 1 ? normExp(x, e) : normExp((x - min) / (max - min) || 0, e);
  const denormalize = (x, min, max, e = 0) => min === 0 && max === 1 ? denormExp(x, e) : denormExp(x, e) * (max - min) + min;
  const inRange = (x, min, max) => x >= min && x <= max;
  class WamParameterInfo2 {
    constructor(id, config = {}) {
      let {
        type,
        label,
        defaultValue,
        minValue,
        maxValue,
        discreteStep,
        exponent,
        choices,
        units
      } = config;
      if (type === void 0)
        type = "float";
      if (label === void 0)
        label = "";
      if (defaultValue === void 0)
        defaultValue = 0;
      if (choices === void 0)
        choices = [];
      if (type === "boolean" || type === "choice") {
        discreteStep = 1;
        minValue = 0;
        if (choices.length)
          maxValue = choices.length - 1;
        else
          maxValue = 1;
      } else {
        if (minValue === void 0)
          minValue = 0;
        if (maxValue === void 0)
          maxValue = 1;
        if (discreteStep === void 0)
          discreteStep = 0;
        if (exponent === void 0)
          exponent = 0;
        if (units === void 0)
          units = "";
      }
      const errBase = `Param config error | ${id}: `;
      if (minValue >= maxValue)
        throw Error(errBase.concat("minValue must be less than maxValue"));
      if (!inRange(defaultValue, minValue, maxValue))
        throw Error(errBase.concat("defaultValue out of range"));
      if (discreteStep % 1 || discreteStep < 0) {
        throw Error(errBase.concat("discreteStep must be a non-negative integer"));
      } else if (discreteStep > 0 && (minValue % 1 || maxValue % 1 || defaultValue % 1)) {
        throw Error(errBase.concat("non-zero discreteStep requires integer minValue, maxValue, and defaultValue"));
      }
      if (type === "choice" && !choices.length) {
        throw Error(errBase.concat("choice type parameter requires list of strings in choices"));
      }
      this.id = id;
      this.label = label;
      this.type = type;
      this.defaultValue = defaultValue;
      this.minValue = minValue;
      this.maxValue = maxValue;
      this.discreteStep = discreteStep;
      this.exponent = exponent;
      this.choices = choices;
      this.units = units;
    }
    normalize(value) {
      return normalize(value, this.minValue, this.maxValue, this.exponent);
    }
    denormalize(valueNorm) {
      return denormalize(valueNorm, this.minValue, this.maxValue, this.exponent);
    }
    valueString(value) {
      if (this.choices)
        return this.choices[value];
      if (this.units !== "")
        return `${value} ${this.units}`;
      return `${value}`;
    }
  }
  const audioWorkletGlobalScope2 = globalThis;
  if (audioWorkletGlobalScope2.AudioWorkletProcessor) {
    if (uuid) {
      if (!audioWorkletGlobalScope2[uuid])
        audioWorkletGlobalScope2[uuid] = WamParameterInfo2;
    } else {
      if (!audioWorkletGlobalScope2.WamParameterInfo)
        audioWorkletGlobalScope2.WamParameterInfo = WamParameterInfo2;
    }
  }
  return WamParameterInfo2;
};
var audioWorkletGlobalScope = globalThis;
if (audioWorkletGlobalScope.AudioWorkletProcessor) {
  if (!audioWorkletGlobalScope.WamParameterInfo)
    getWamParameterInfo();
}
var WamParameterInfo_default = getWamParameterInfo;

// src/ParamConfigurator.js
var WamParameterInfo = WamParameterInfo_default();
var ParamMappingConfigurator = class {
  constructor(options = {}) {
    __publicField(this, "_paramsConfig");
    __publicField(this, "_internalParamsConfig");
    __publicField(this, "_paramsMapping", {});
    const { paramsConfig, paramsMapping, internalParamsConfig } = options;
    this._paramsConfig = paramsConfig;
    this._paramsMapping = paramsMapping;
    this._internalParamsConfig = internalParamsConfig;
  }
  get paramsConfig() {
    const { internalParamsConfig } = this;
    return Object.entries(this._paramsConfig || internalParamsConfig).reduce((configs, [id, config]) => {
      var _a, _b, _c, _d;
      const internalParam = internalParamsConfig[id];
      configs[id] = new WamParameterInfo(id, __spreadProps(__spreadValues({}, config), {
        label: (_a = config.label) != null ? _a : id,
        defaultValue: (_b = config.defaultValue) != null ? _b : internalParam == null ? void 0 : internalParam.defaultValue,
        minValue: (_c = config.minValue) != null ? _c : internalParam == null ? void 0 : internalParam.minValue,
        maxValue: (_d = config.maxValue) != null ? _d : internalParam == null ? void 0 : internalParam.maxValue
      }));
      return configs;
    }, {});
  }
  get internalParamsConfig() {
    return Object.entries(this._internalParamsConfig || {}).reduce((configs, [name, config]) => {
      if (config instanceof AudioParam)
        configs[name] = config;
      else {
        const defaultConfig = {
          minValue: 0,
          maxValue: 1,
          defaultValue: 0,
          automationRate: 30
        };
        configs[name] = __spreadValues(__spreadValues({}, defaultConfig), config);
      }
      return configs;
    }, {});
  }
  get paramsMapping() {
    const declared = this._paramsMapping || {};
    const externalParams = this.paramsConfig;
    const internalParams = this.internalParamsConfig;
    return Object.entries(externalParams).reduce((mapping, [name, { minValue, maxValue }]) => {
      const sourceRange = [minValue, maxValue];
      const defaultMapping = { sourceRange, targetRange: [...sourceRange] };
      if (declared[name]) {
        const declaredTargets = Object.entries(declared[name]).reduce((targets, [targetName, targetMapping]) => {
          if (internalParams[targetName]) {
            targets[targetName] = __spreadValues(__spreadValues({}, defaultMapping), targetMapping);
          }
          return targets;
        }, {});
        mapping[name] = declaredTargets;
      } else if (internalParams[name]) {
        mapping[name] = { [name]: __spreadValues({}, defaultMapping) };
      }
      return mapping;
    }, {});
  }
};

// src/MgrAudioParam.js
var MgrAudioParam = class extends AudioParam {
  constructor() {
    super(...arguments);
    __publicField(this, "_info");
  }
  get exponent() {
    return this.info.exponent;
  }
  get info() {
    return this._info;
  }
  set info(info) {
    this._info = info;
  }
  set normalizedValue(valueIn) {
    this.value = this.info.denormalize(valueIn);
  }
  get normalizedValue() {
    return this.info.normalize(this.value);
  }
  setValueAtTime(value, startTime) {
    return super.setValueAtTime(value, startTime);
  }
  setNormalizedValueAtTime(valueIn, startTime) {
    const value = this.info.denormalize(valueIn);
    return this.setValueAtTime(value, startTime);
  }
  linearRampToValueAtTime(value, endTime) {
    return super.linearRampToValueAtTime(value, endTime);
  }
  linearRampToNormalizedValueAtTime(valueIn, endTime) {
    const value = this.info.denormalize(valueIn);
    return this.linearRampToValueAtTime(value, endTime);
  }
  exponentialRampToValueAtTime(value, endTime) {
    return super.exponentialRampToValueAtTime(value, endTime);
  }
  exponentialRampToNormalizedValueAtTime(valueIn, endTime) {
    const value = this.info.denormalize(valueIn);
    return this.exponentialRampToValueAtTime(value, endTime);
  }
  setTargetAtTime(target, startTime, timeConstant) {
    return super.setTargetAtTime(target, startTime, timeConstant);
  }
  setNormalizedTargetAtTime(targetIn, startTime, timeConstant) {
    const target = this.info.denormalize(targetIn);
    return this.setTargetAtTime(target, startTime, timeConstant);
  }
  setValueCurveAtTime(values, startTime, duration) {
    return super.setValueCurveAtTime(values, startTime, duration);
  }
  setNormalizedValueCurveAtTime(valuesIn, startTime, duration) {
    const values = Array.from(valuesIn).map((v) => this.info.denormalize(v));
    return this.setValueCurveAtTime(values, startTime, duration);
  }
  cancelScheduledParamValues(cancelTime) {
    return super.cancelScheduledValues(cancelTime);
  }
  cancelAndHoldParamAtTime(cancelTime) {
    return super.cancelAndHoldAtTime(cancelTime);
  }
};

// src/ParamMgrNode.js
var AudioWorkletNode = globalThis.AudioWorkletNode;
var ParamMgrNode = class extends AudioWorkletNode {
  constructor(module, options) {
    super(module.audioContext, module.moduleId, {
      numberOfInputs: 0,
      numberOfOutputs: 1 + options.processorOptions.internalParams.length,
      parameterData: options.parameterData,
      processorOptions: options.processorOptions
    });
    __publicField(this, "requestDispatchIParamChange", (name) => {
      const config = this.internalParamsConfig[name];
      if (!("onChange" in config))
        return;
      const { automationRate, onChange } = config;
      if (typeof automationRate !== "number" || !automationRate)
        return;
      const interval = 1e3 / automationRate;
      const i = this.internalParams.indexOf(name);
      if (i === -1)
        return;
      if (i >= this.internalParams.length)
        return;
      if (typeof this.paramsUpdateCheckFnRef[i] === "number") {
        window.clearTimeout(this.paramsUpdateCheckFnRef[i]);
      }
      this.paramsUpdateCheckFn[i] = () => {
        const prev = this.$prevParamsBuffer[i];
        const cur = this.$paramsBuffer[i];
        if (cur !== prev) {
          onChange(cur, prev);
          this.$prevParamsBuffer[i] = cur;
        }
        this.paramsUpdateCheckFnRef[i] = window.setTimeout(this.paramsUpdateCheckFn[i], interval);
      };
      this.paramsUpdateCheckFn[i]();
    });
    const { processorOptions, internalParamsConfig } = options;
    this.initialized = false;
    this.module = module;
    this.paramsConfig = processorOptions.paramsConfig;
    this.internalParams = processorOptions.internalParams;
    this.internalParamsConfig = internalParamsConfig;
    this.$prevParamsBuffer = new Float32Array(this.internalParams.length);
    this.paramsUpdateCheckFn = [];
    this.paramsUpdateCheckFnRef = [];
    this.messageRequestId = 0;
    Object.entries(this.getParams()).forEach(([name, param]) => {
      Object.setPrototypeOf(param, MgrAudioParam.prototype);
      param._info = this.paramsConfig[name];
    });
    const resolves = {};
    const rejects = {};
    this.call = (call, ...args) => {
      const id = this.messageRequestId;
      this.messageRequestId += 1;
      return new Promise((resolve, reject) => {
        resolves[id] = resolve;
        rejects[id] = reject;
        this.port.postMessage({ id, call, args });
      });
    };
    this.handleMessage = ({ data }) => {
      const { id, call, args, value, error } = data;
      if (call) {
        const r = { id };
        try {
          r.value = this[call](...args);
        } catch (e) {
          r.error = e;
        }
        this.port.postMessage(r);
      } else {
        if (error) {
          if (rejects[id])
            rejects[id](error);
          delete rejects[id];
          return;
        }
        if (resolves[id]) {
          resolves[id](value);
          delete resolves[id];
        }
      }
    };
    this.port.start();
    this.port.addEventListener("message", this.handleMessage);
  }
  get parameters() {
    return super.parameters;
  }
  get processorId() {
    return this.module.moduleId;
  }
  get instanceId() {
    return this.module.instanceId;
  }
  async initialize() {
    const response = await this.call("getBuffer");
    const { lock, paramsBuffer } = response;
    this.$lock = lock;
    this.$paramsBuffer = paramsBuffer;
    const offset = 1;
    Object.entries(this.internalParamsConfig).forEach(([name, config], i) => {
      if (this.context.state === "suspended")
        this.$paramsBuffer[i] = config.defaultValue;
      if (config instanceof AudioParam) {
        try {
          config.automationRate = "a-rate";
        } catch (e) {
        } finally {
          config.value = Math.max(0, config.minValue);
          this.connect(config, offset + i);
        }
      } else if (config instanceof AudioNode) {
        this.connect(config, offset + i);
      } else {
        this.requestDispatchIParamChange(name);
      }
    });
    this.connect(this.module.audioContext.destination, 0, 0);
    this.initialized = true;
    return this;
  }
  setBuffer({ lock, paramsBuffer }) {
    this.$lock = lock;
    this.$paramsBuffer = paramsBuffer;
  }
  setParamsMapping(paramsMapping) {
    return this.call("setParamsMapping", paramsMapping);
  }
  getCompensationDelay() {
    return this.call("getCompensationDelay");
  }
  getParameterInfo(...parameterIdQuery) {
    return this.call("getParameterInfo", ...parameterIdQuery);
  }
  getParameterValues(normalized, ...parameterIdQuery) {
    return this.call("getParameterValues", normalized, ...parameterIdQuery);
  }
  scheduleAutomation(event) {
    const time = event.time || this.context.currentTime;
    const { id, normalized, value } = event.data;
    const audioParam = this.getParam(id);
    if (!audioParam)
      return;
    if (audioParam.info.type === "float") {
      if (normalized)
        audioParam.linearRampToNormalizedValueAtTime(value, time);
      else
        audioParam.linearRampToValueAtTime(value, time);
    } else {
      if (normalized)
        audioParam.setNormalizedValueAtTime(value, time);
      else
        audioParam.setValueAtTime(value, time);
    }
  }
  scheduleEvents(...events) {
    events.forEach((event) => {
      if (event.type === "wam-automation") {
        this.scheduleAutomation(event);
      }
    });
    this.call("scheduleEvents", ...events);
  }
  emitEvents(...events) {
    this.call("emitEvents", ...events);
  }
  clearEvents() {
    this.call("clearEvents");
  }
  dispatchWamEvent(event) {
    if (event.type === "wam-automation") {
      this.scheduleAutomation(event);
    } else {
      this.dispatchEvent(new CustomEvent(event.type, { detail: event }));
    }
  }
  async setParameterValues(parameterValues) {
    Object.keys(parameterValues).forEach((parameterId) => {
      const parameterUpdate = parameterValues[parameterId];
      const parameter = this.parameters.get(parameterId);
      if (!parameter)
        return;
      if (!parameterUpdate.normalized)
        parameter.value = parameterUpdate.value;
      else
        parameter.normalizedValue = parameterUpdate.value;
    });
  }
  async getState() {
    return this.getParamsValues();
  }
  async setState(state) {
    this.setParamsValues(state);
  }
  convertTimeToFrame(time) {
    return Math.round(time * this.context.sampleRate);
  }
  convertFrameToTime(frame) {
    return frame / this.context.sampleRate;
  }
  getIParamIndex(name) {
    const i = this.internalParams.indexOf(name);
    return i === -1 ? null : i;
  }
  connectIParam(name, dest, index) {
    const offset = 1;
    const i = this.getIParamIndex(name);
    if (i !== null) {
      if (dest instanceof AudioNode) {
        if (typeof index === "number")
          this.connect(dest, offset + i, index);
        else
          this.connect(dest, offset + i);
      } else {
        this.connect(dest, offset + i);
      }
    }
  }
  disconnectIParam(name, dest, index) {
    const offset = 1;
    const i = this.getIParamIndex(name);
    if (i !== null) {
      if (dest instanceof AudioNode) {
        if (typeof index === "number")
          this.disconnect(dest, offset + i, index);
        else
          this.disconnect(dest, offset + i);
      } else {
        this.disconnect(dest, offset + i);
      }
    }
  }
  getIParamValue(name) {
    const i = this.getIParamIndex(name);
    return i !== null ? this.$paramsBuffer[i] : null;
  }
  getIParamsValues() {
    const values = {};
    this.internalParams.forEach((name, i) => {
      values[name] = this.$paramsBuffer[i];
    });
    return values;
  }
  getParam(name) {
    return this.parameters.get(name) || null;
  }
  getParams() {
    return Object.fromEntries(this.parameters);
  }
  getParamValue(name) {
    const param = this.parameters.get(name);
    if (!param)
      return null;
    return param.value;
  }
  setParamValue(name, value) {
    const param = this.parameters.get(name);
    if (!param)
      return;
    param.value = value;
  }
  getParamsValues() {
    const values = {};
    this.parameters.forEach((v, k) => {
      values[k] = v.value;
    });
    return values;
  }
  setParamsValues(values) {
    if (!values)
      return;
    Object.entries(values).forEach(([k, v]) => {
      this.setParamValue(k, v);
    });
  }
  getNormalizedParamValue(name) {
    const param = this.parameters.get(name);
    if (!param)
      return null;
    return param.normalizedValue;
  }
  setNormalizedParamValue(name, value) {
    const param = this.parameters.get(name);
    if (!param)
      return;
    param.normalizedValue = value;
  }
  getNormalizedParamsValues() {
    const values = {};
    this.parameters.forEach((v, k) => {
      values[k] = this.getNormalizedParamValue(k);
    });
    return values;
  }
  setNormalizedParamsValues(values) {
    if (!values)
      return;
    Object.entries(values).forEach(([k, v]) => {
      this.setNormalizedParamValue(k, v);
    });
  }
  setParamValueAtTime(name, value, startTime) {
    const param = this.parameters.get(name);
    if (!param)
      return null;
    return param.setValueAtTime(value, startTime);
  }
  setNormalizedParamValueAtTime(name, value, startTime) {
    const param = this.parameters.get(name);
    if (!param)
      return null;
    return param.setNormalizedValueAtTime(value, startTime);
  }
  linearRampToParamValueAtTime(name, value, endTime) {
    const param = this.parameters.get(name);
    if (!param)
      return null;
    return param.linearRampToValueAtTime(value, endTime);
  }
  linearRampToNormalizedParamValueAtTime(name, value, endTime) {
    const param = this.parameters.get(name);
    if (!param)
      return null;
    return param.linearRampToNormalizedValueAtTime(value, endTime);
  }
  exponentialRampToParamValueAtTime(name, value, endTime) {
    const param = this.parameters.get(name);
    if (!param)
      return null;
    return param.exponentialRampToValueAtTime(value, endTime);
  }
  exponentialRampToNormalizedParamValueAtTime(name, value, endTime) {
    const param = this.parameters.get(name);
    if (!param)
      return null;
    return param.exponentialRampToNormalizedValueAtTime(value, endTime);
  }
  setParamTargetAtTime(name, target, startTime, timeConstant) {
    const param = this.parameters.get(name);
    if (!param)
      return null;
    return param.setTargetAtTime(target, startTime, timeConstant);
  }
  setNormalizedParamTargetAtTime(name, target, startTime, timeConstant) {
    const param = this.parameters.get(name);
    if (!param)
      return null;
    return param.setNormalizedTargetAtTime(target, startTime, timeConstant);
  }
  setParamValueCurveAtTime(name, values, startTime, duration) {
    const param = this.parameters.get(name);
    if (!param)
      return null;
    return param.setValueCurveAtTime(values, startTime, duration);
  }
  setNormalizedParamValueCurveAtTime(name, values, startTime, duration) {
    const param = this.parameters.get(name);
    if (!param)
      return null;
    return param.setNormalizedValueCurveAtTime(values, startTime, duration);
  }
  cancelScheduledParamValues(name, cancelTime) {
    const param = this.parameters.get(name);
    if (!param)
      return null;
    return param.cancelScheduledValues(cancelTime);
  }
  cancelAndHoldParamAtTime(name, cancelTime) {
    const param = this.parameters.get(name);
    if (!param)
      return null;
    return param.cancelAndHoldAtTime(cancelTime);
  }
  connectEvents(to, output) {
    var _a;
    if (!((_a = to.module) == null ? void 0 : _a.isWebAudioModule))
      return;
    this.call("connectEvents", to.instanceId, output);
  }
  disconnectEvents(to, output) {
    var _a;
    if (to && !((_a = to.module) == null ? void 0 : _a.isWebAudioModule))
      return;
    this.call("disconnectEvents", to == null ? void 0 : to.instanceId, output);
  }
  async destroy() {
    this.disconnect();
    this.paramsUpdateCheckFnRef.forEach((ref) => {
      if (typeof ref === "number")
        window.clearTimeout(ref);
    });
    await this.call("destroy");
    this.port.close();
  }
};

// src/ParamMgrFactory.js
var ParamMgrFactory = class {
  static async create(module, optionsIn = {}) {
    const { audioContext, moduleId: processorId, instanceId } = module;
    const { paramsConfig, paramsMapping, internalParamsConfig } = new ParamMappingConfigurator(optionsIn);
    const initialParamsValue = Object.entries(paramsConfig).reduce((currentParams, [name, { defaultValue }]) => {
      currentParams[name] = defaultValue;
      return currentParams;
    }, {});
    const serializableParamsConfig = Object.entries(paramsConfig).reduce((currentParams, [name, { id, label, type, defaultValue, minValue, maxValue, discreteStep, exponent, choices, units }]) => {
      currentParams[name] = { id, label, type, defaultValue, minValue, maxValue, discreteStep, exponent, choices, units };
      return currentParams;
    }, {});
    await addFunctionModule_default(audioContext.audioWorklet, ParamMgrProcessor_default, processorId, serializableParamsConfig);
    const options = {
      internalParamsConfig,
      parameterData: initialParamsValue,
      processorOptions: {
        paramsConfig,
        paramsMapping,
        internalParamsMinValues: Object.values(internalParamsConfig).map((config) => Math.max(0, (config == null ? void 0 : config.minValue) || 0)),
        internalParams: Object.keys(internalParamsConfig),
        instanceId,
        processorId
      }
    };
    const node = new ParamMgrNode(module, options);
    await node.initialize();
    return node;
  }
};
export {
  CompositeAudioNode,
  ParamMgrFactory
};
//# sourceMappingURL=index.js.map
