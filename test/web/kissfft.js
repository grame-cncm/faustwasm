(() => {
  var __create = Object.create;
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __getProtoOf = Object.getPrototypeOf;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
    get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
  }) : x)(function(x) {
    if (typeof require !== "undefined")
      return require.apply(this, arguments);
    throw new Error('Dynamic require of "' + x + '" is not supported');
  });
  var __commonJS = (cb, mod) => function __require2() {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  };
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
    // If the importer is in node compatibility mode or this is not an ESM
    // file that has been converted to a CommonJS file using a Babel-
    // compatible transform (i.e. "__esModule" has not been set), then set
    // "default" to the CommonJS "module.exports" for node compatibility.
    isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
    mod
  ));
  var __toBinary = /* @__PURE__ */ (() => {
    var table = new Uint8Array(128);
    for (var i = 0; i < 64; i++)
      table[i < 26 ? i + 65 : i < 52 ? i + 71 : i < 62 ? i - 4 : i * 4 - 205] = i;
    return (base64) => {
      var n = base64.length, bytes = new Uint8Array((n - (base64[n - 1] == "=") - (base64[n - 2] == "=")) * 3 / 4 | 0);
      for (var i2 = 0, j = 0; i2 < n; ) {
        var c0 = table[base64.charCodeAt(i2++)], c1 = table[base64.charCodeAt(i2++)];
        var c2 = table[base64.charCodeAt(i2++)], c3 = table[base64.charCodeAt(i2++)];
        bytes[j++] = c0 << 2 | c1 >> 4;
        bytes[j++] = c1 << 4 | c2 >> 2;
        bytes[j++] = c2 << 6 | c3;
      }
      return bytes;
    };
  })();

  // libkissfft-wasm/libkissfft.cjs
  var require_libkissfft = __commonJS({
    "libkissfft-wasm/libkissfft.cjs"(exports, module) {
      var KissFFTModule = (() => {
        var _scriptDir = typeof document !== "undefined" && document.currentScript ? document.currentScript.src : void 0;
        if (typeof __filename !== "undefined")
          _scriptDir = _scriptDir || __filename;
        return function(KissFFTModule2) {
          KissFFTModule2 = KissFFTModule2 || {};
          var Module = typeof KissFFTModule2 != "undefined" ? KissFFTModule2 : {};
          var readyPromiseResolve, readyPromiseReject;
          Module["ready"] = new Promise(function(resolve, reject) {
            readyPromiseResolve = resolve;
            readyPromiseReject = reject;
          });
          var moduleOverrides = Object.assign({}, Module);
          var arguments_ = [];
          var thisProgram = "./this.program";
          var quit_ = (status, toThrow) => {
            throw toThrow;
          };
          var ENVIRONMENT_IS_WEB = typeof window == "object";
          var ENVIRONMENT_IS_WORKER = typeof importScripts == "function";
          var ENVIRONMENT_IS_NODE = typeof process == "object" && typeof process.versions == "object" && typeof process.versions.node == "string";
          var scriptDirectory = "";
          function locateFile(path) {
            if (Module["locateFile"]) {
              return Module["locateFile"](path, scriptDirectory);
            }
            return scriptDirectory + path;
          }
          var read_, readAsync, readBinary, setWindowTitle;
          function logExceptionOnExit(e) {
            if (e instanceof ExitStatus)
              return;
            let toLog = e;
            err("exiting due to exception: " + toLog);
          }
          if (ENVIRONMENT_IS_NODE) {
            var fs = __require("fs");
            var nodePath = __require("path");
            if (ENVIRONMENT_IS_WORKER) {
              scriptDirectory = nodePath.dirname(scriptDirectory) + "/";
            } else {
              scriptDirectory = __dirname + "/";
            }
            read_ = (filename, binary) => {
              filename = isFileURI(filename) ? new URL(filename) : nodePath.normalize(filename);
              return fs.readFileSync(filename, binary ? void 0 : "utf8");
            };
            readBinary = (filename) => {
              var ret = read_(filename, true);
              if (!ret.buffer) {
                ret = new Uint8Array(ret);
              }
              return ret;
            };
            readAsync = (filename, onload, onerror) => {
              filename = isFileURI(filename) ? new URL(filename) : nodePath.normalize(filename);
              fs.readFile(filename, function(err2, data) {
                if (err2)
                  onerror(err2);
                else
                  onload(data.buffer);
              });
            };
            if (process["argv"].length > 1) {
              thisProgram = process["argv"][1].replace(/\\/g, "/");
            }
            arguments_ = process["argv"].slice(2);
            process["on"]("uncaughtException", function(ex) {
              if (!(ex instanceof ExitStatus)) {
                throw ex;
              }
            });
            process["on"]("unhandledRejection", function(reason) {
              throw reason;
            });
            quit_ = (status, toThrow) => {
              if (keepRuntimeAlive()) {
                process["exitCode"] = status;
                throw toThrow;
              }
              logExceptionOnExit(toThrow);
              process["exit"](status);
            };
            Module["inspect"] = function() {
              return "[Emscripten Module object]";
            };
          } else if (ENVIRONMENT_IS_WEB || ENVIRONMENT_IS_WORKER) {
            if (ENVIRONMENT_IS_WORKER) {
              scriptDirectory = self.location.href;
            } else if (typeof document != "undefined" && document.currentScript) {
              scriptDirectory = document.currentScript.src;
            }
            if (_scriptDir) {
              scriptDirectory = _scriptDir;
            }
            if (scriptDirectory.indexOf("blob:") !== 0) {
              scriptDirectory = scriptDirectory.substr(0, scriptDirectory.replace(/[?#].*/, "").lastIndexOf("/") + 1);
            } else {
              scriptDirectory = "";
            }
            {
              read_ = (url) => {
                var xhr = new XMLHttpRequest();
                xhr.open("GET", url, false);
                xhr.send(null);
                return xhr.responseText;
              };
              if (ENVIRONMENT_IS_WORKER) {
                readBinary = (url) => {
                  var xhr = new XMLHttpRequest();
                  xhr.open("GET", url, false);
                  xhr.responseType = "arraybuffer";
                  xhr.send(null);
                  return new Uint8Array(xhr.response);
                };
              }
              readAsync = (url, onload, onerror) => {
                var xhr = new XMLHttpRequest();
                xhr.open("GET", url, true);
                xhr.responseType = "arraybuffer";
                xhr.onload = () => {
                  if (xhr.status == 200 || xhr.status == 0 && xhr.response) {
                    onload(xhr.response);
                    return;
                  }
                  onerror();
                };
                xhr.onerror = onerror;
                xhr.send(null);
              };
            }
            setWindowTitle = (title) => document.title = title;
          } else {
          }
          var out = Module["print"] || console.log.bind(console);
          var err = Module["printErr"] || console.warn.bind(console);
          Object.assign(Module, moduleOverrides);
          moduleOverrides = null;
          if (Module["arguments"])
            arguments_ = Module["arguments"];
          if (Module["thisProgram"])
            thisProgram = Module["thisProgram"];
          if (Module["quit"])
            quit_ = Module["quit"];
          var wasmBinary;
          if (Module["wasmBinary"])
            wasmBinary = Module["wasmBinary"];
          var noExitRuntime = Module["noExitRuntime"] || true;
          if (typeof WebAssembly != "object") {
            abort("no native wasm support detected");
          }
          var wasmMemory;
          var ABORT = false;
          var EXITSTATUS;
          var UTF8Decoder = typeof TextDecoder != "undefined" ? new TextDecoder("utf8") : void 0;
          function UTF8ArrayToString(heapOrArray, idx, maxBytesToRead) {
            var endIdx = idx + maxBytesToRead;
            var endPtr = idx;
            while (heapOrArray[endPtr] && !(endPtr >= endIdx))
              ++endPtr;
            if (endPtr - idx > 16 && heapOrArray.buffer && UTF8Decoder) {
              return UTF8Decoder.decode(heapOrArray.subarray(idx, endPtr));
            }
            var str = "";
            while (idx < endPtr) {
              var u0 = heapOrArray[idx++];
              if (!(u0 & 128)) {
                str += String.fromCharCode(u0);
                continue;
              }
              var u1 = heapOrArray[idx++] & 63;
              if ((u0 & 224) == 192) {
                str += String.fromCharCode((u0 & 31) << 6 | u1);
                continue;
              }
              var u2 = heapOrArray[idx++] & 63;
              if ((u0 & 240) == 224) {
                u0 = (u0 & 15) << 12 | u1 << 6 | u2;
              } else {
                u0 = (u0 & 7) << 18 | u1 << 12 | u2 << 6 | heapOrArray[idx++] & 63;
              }
              if (u0 < 65536) {
                str += String.fromCharCode(u0);
              } else {
                var ch = u0 - 65536;
                str += String.fromCharCode(55296 | ch >> 10, 56320 | ch & 1023);
              }
            }
            return str;
          }
          function UTF8ToString(ptr, maxBytesToRead) {
            return ptr ? UTF8ArrayToString(HEAPU8, ptr, maxBytesToRead) : "";
          }
          function stringToUTF8Array(str, heap, outIdx, maxBytesToWrite) {
            if (!(maxBytesToWrite > 0))
              return 0;
            var startIdx = outIdx;
            var endIdx = outIdx + maxBytesToWrite - 1;
            for (var i = 0; i < str.length; ++i) {
              var u = str.charCodeAt(i);
              if (u >= 55296 && u <= 57343) {
                var u1 = str.charCodeAt(++i);
                u = 65536 + ((u & 1023) << 10) | u1 & 1023;
              }
              if (u <= 127) {
                if (outIdx >= endIdx)
                  break;
                heap[outIdx++] = u;
              } else if (u <= 2047) {
                if (outIdx + 1 >= endIdx)
                  break;
                heap[outIdx++] = 192 | u >> 6;
                heap[outIdx++] = 128 | u & 63;
              } else if (u <= 65535) {
                if (outIdx + 2 >= endIdx)
                  break;
                heap[outIdx++] = 224 | u >> 12;
                heap[outIdx++] = 128 | u >> 6 & 63;
                heap[outIdx++] = 128 | u & 63;
              } else {
                if (outIdx + 3 >= endIdx)
                  break;
                heap[outIdx++] = 240 | u >> 18;
                heap[outIdx++] = 128 | u >> 12 & 63;
                heap[outIdx++] = 128 | u >> 6 & 63;
                heap[outIdx++] = 128 | u & 63;
              }
            }
            heap[outIdx] = 0;
            return outIdx - startIdx;
          }
          function stringToUTF8(str, outPtr, maxBytesToWrite) {
            return stringToUTF8Array(str, HEAPU8, outPtr, maxBytesToWrite);
          }
          var buffer, HEAP8, HEAPU8, HEAP16, HEAPU16, HEAP32, HEAPU32, HEAPF32, HEAPF64;
          function updateGlobalBufferAndViews(buf) {
            buffer = buf;
            Module["HEAP8"] = HEAP8 = new Int8Array(buf);
            Module["HEAP16"] = HEAP16 = new Int16Array(buf);
            Module["HEAP32"] = HEAP32 = new Int32Array(buf);
            Module["HEAPU8"] = HEAPU8 = new Uint8Array(buf);
            Module["HEAPU16"] = HEAPU16 = new Uint16Array(buf);
            Module["HEAPU32"] = HEAPU32 = new Uint32Array(buf);
            Module["HEAPF32"] = HEAPF32 = new Float32Array(buf);
            Module["HEAPF64"] = HEAPF64 = new Float64Array(buf);
          }
          var INITIAL_MEMORY = Module["INITIAL_MEMORY"] || 16777216;
          var wasmTable;
          var __ATPRERUN__ = [];
          var __ATINIT__ = [];
          var __ATPOSTRUN__ = [];
          var runtimeInitialized = false;
          function keepRuntimeAlive() {
            return noExitRuntime;
          }
          function preRun() {
            if (Module["preRun"]) {
              if (typeof Module["preRun"] == "function")
                Module["preRun"] = [Module["preRun"]];
              while (Module["preRun"].length) {
                addOnPreRun(Module["preRun"].shift());
              }
            }
            callRuntimeCallbacks(__ATPRERUN__);
          }
          function initRuntime() {
            runtimeInitialized = true;
            callRuntimeCallbacks(__ATINIT__);
          }
          function postRun() {
            if (Module["postRun"]) {
              if (typeof Module["postRun"] == "function")
                Module["postRun"] = [Module["postRun"]];
              while (Module["postRun"].length) {
                addOnPostRun(Module["postRun"].shift());
              }
            }
            callRuntimeCallbacks(__ATPOSTRUN__);
          }
          function addOnPreRun(cb) {
            __ATPRERUN__.unshift(cb);
          }
          function addOnInit(cb) {
            __ATINIT__.unshift(cb);
          }
          function addOnPostRun(cb) {
            __ATPOSTRUN__.unshift(cb);
          }
          var runDependencies = 0;
          var runDependencyWatcher = null;
          var dependenciesFulfilled = null;
          function addRunDependency(id) {
            runDependencies++;
            if (Module["monitorRunDependencies"]) {
              Module["monitorRunDependencies"](runDependencies);
            }
          }
          function removeRunDependency(id) {
            runDependencies--;
            if (Module["monitorRunDependencies"]) {
              Module["monitorRunDependencies"](runDependencies);
            }
            if (runDependencies == 0) {
              if (runDependencyWatcher !== null) {
                clearInterval(runDependencyWatcher);
                runDependencyWatcher = null;
              }
              if (dependenciesFulfilled) {
                var callback = dependenciesFulfilled;
                dependenciesFulfilled = null;
                callback();
              }
            }
          }
          function abort(what) {
            if (Module["onAbort"]) {
              Module["onAbort"](what);
            }
            what = "Aborted(" + what + ")";
            err(what);
            ABORT = true;
            EXITSTATUS = 1;
            what += ". Build with -sASSERTIONS for more info.";
            var e = new WebAssembly.RuntimeError(what);
            readyPromiseReject(e);
            throw e;
          }
          var dataURIPrefix = "data:application/octet-stream;base64,";
          function isDataURI(filename) {
            return filename.startsWith(dataURIPrefix);
          }
          function isFileURI(filename) {
            return filename.startsWith("file://");
          }
          var wasmBinaryFile;
          wasmBinaryFile = "libkissfft.wasm";
          if (!isDataURI(wasmBinaryFile)) {
            wasmBinaryFile = locateFile(wasmBinaryFile);
          }
          function getBinary(file) {
            try {
              if (file == wasmBinaryFile && wasmBinary) {
                return new Uint8Array(wasmBinary);
              }
              if (readBinary) {
                return readBinary(file);
              }
              throw "both async and sync fetching of the wasm failed";
            } catch (err2) {
              abort(err2);
            }
          }
          function getBinaryPromise() {
            if (!wasmBinary && (ENVIRONMENT_IS_WEB || ENVIRONMENT_IS_WORKER)) {
              if (typeof fetch == "function" && !isFileURI(wasmBinaryFile)) {
                return fetch(wasmBinaryFile, { credentials: "same-origin" }).then(function(response) {
                  if (!response["ok"]) {
                    throw "failed to load wasm binary file at '" + wasmBinaryFile + "'";
                  }
                  return response["arrayBuffer"]();
                }).catch(function() {
                  return getBinary(wasmBinaryFile);
                });
              } else {
                if (readAsync) {
                  return new Promise(function(resolve, reject) {
                    readAsync(wasmBinaryFile, function(response) {
                      resolve(new Uint8Array(response));
                    }, reject);
                  });
                }
              }
            }
            return Promise.resolve().then(function() {
              return getBinary(wasmBinaryFile);
            });
          }
          function createWasm() {
            var info = { "a": asmLibraryArg };
            function receiveInstance(instance, module2) {
              var exports3 = instance.exports;
              Module["asm"] = exports3;
              wasmMemory = Module["asm"]["f"];
              updateGlobalBufferAndViews(wasmMemory.buffer);
              wasmTable = Module["asm"]["p"];
              addOnInit(Module["asm"]["g"]);
              removeRunDependency("wasm-instantiate");
            }
            addRunDependency("wasm-instantiate");
            function receiveInstantiationResult(result) {
              receiveInstance(result["instance"]);
            }
            function instantiateArrayBuffer(receiver) {
              return getBinaryPromise().then(function(binary) {
                return WebAssembly.instantiate(binary, info);
              }).then(function(instance) {
                return instance;
              }).then(receiver, function(reason) {
                err("failed to asynchronously prepare wasm: " + reason);
                abort(reason);
              });
            }
            function instantiateAsync() {
              if (!wasmBinary && typeof WebAssembly.instantiateStreaming == "function" && !isDataURI(wasmBinaryFile) && !isFileURI(wasmBinaryFile) && !ENVIRONMENT_IS_NODE && typeof fetch == "function") {
                return fetch(wasmBinaryFile, { credentials: "same-origin" }).then(function(response) {
                  var result = WebAssembly.instantiateStreaming(response, info);
                  return result.then(receiveInstantiationResult, function(reason) {
                    err("wasm streaming compile failed: " + reason);
                    err("falling back to ArrayBuffer instantiation");
                    return instantiateArrayBuffer(receiveInstantiationResult);
                  });
                });
              } else {
                return instantiateArrayBuffer(receiveInstantiationResult);
              }
            }
            if (Module["instantiateWasm"]) {
              try {
                var exports2 = Module["instantiateWasm"](info, receiveInstance);
                return exports2;
              } catch (e) {
                err("Module.instantiateWasm callback failed with error: " + e);
                readyPromiseReject(e);
              }
            }
            instantiateAsync().catch(readyPromiseReject);
            return {};
          }
          function ExitStatus(status) {
            this.name = "ExitStatus";
            this.message = "Program terminated with exit(" + status + ")";
            this.status = status;
          }
          function callRuntimeCallbacks(callbacks) {
            while (callbacks.length > 0) {
              callbacks.shift()(Module);
            }
          }
          function _emscripten_memcpy_big(dest, src, num) {
            HEAPU8.copyWithin(dest, src, src + num);
          }
          function abortOnCannotGrowMemory(requestedSize) {
            abort("OOM");
          }
          function _emscripten_resize_heap(requestedSize) {
            var oldSize = HEAPU8.length;
            requestedSize = requestedSize >>> 0;
            abortOnCannotGrowMemory(requestedSize);
          }
          var SYSCALLS = { varargs: void 0, get: function() {
            SYSCALLS.varargs += 4;
            var ret = HEAP32[SYSCALLS.varargs - 4 >> 2];
            return ret;
          }, getStr: function(ptr) {
            var ret = UTF8ToString(ptr);
            return ret;
          } };
          function _fd_close(fd) {
            return 52;
          }
          function _fd_seek(fd, offset_low, offset_high, whence, newOffset) {
            return 70;
          }
          var printCharBuffers = [null, [], []];
          function printChar(stream, curr) {
            var buffer2 = printCharBuffers[stream];
            if (curr === 0 || curr === 10) {
              (stream === 1 ? out : err)(UTF8ArrayToString(buffer2, 0));
              buffer2.length = 0;
            } else {
              buffer2.push(curr);
            }
          }
          function _fd_write(fd, iov, iovcnt, pnum) {
            var num = 0;
            for (var i = 0; i < iovcnt; i++) {
              var ptr = HEAPU32[iov >> 2];
              var len = HEAPU32[iov + 4 >> 2];
              iov += 8;
              for (var j = 0; j < len; j++) {
                printChar(fd, HEAPU8[ptr + j]);
              }
              num += len;
            }
            HEAPU32[pnum >> 2] = num;
            return 0;
          }
          function getCFunc(ident) {
            var func = Module["_" + ident];
            return func;
          }
          function writeArrayToMemory(array, buffer2) {
            HEAP8.set(array, buffer2);
          }
          function ccall(ident, returnType, argTypes, args, opts) {
            var toC = { "string": (str) => {
              var ret2 = 0;
              if (str !== null && str !== void 0 && str !== 0) {
                var len = (str.length << 2) + 1;
                ret2 = stackAlloc(len);
                stringToUTF8(str, ret2, len);
              }
              return ret2;
            }, "array": (arr) => {
              var ret2 = stackAlloc(arr.length);
              writeArrayToMemory(arr, ret2);
              return ret2;
            } };
            function convertReturnValue(ret2) {
              if (returnType === "string") {
                return UTF8ToString(ret2);
              }
              if (returnType === "boolean")
                return Boolean(ret2);
              return ret2;
            }
            var func = getCFunc(ident);
            var cArgs = [];
            var stack = 0;
            if (args) {
              for (var i = 0; i < args.length; i++) {
                var converter = toC[argTypes[i]];
                if (converter) {
                  if (stack === 0)
                    stack = stackSave();
                  cArgs[i] = converter(args[i]);
                } else {
                  cArgs[i] = args[i];
                }
              }
            }
            var ret = func.apply(null, cArgs);
            function onDone(ret2) {
              if (stack !== 0)
                stackRestore(stack);
              return convertReturnValue(ret2);
            }
            ret = onDone(ret);
            return ret;
          }
          function cwrap(ident, returnType, argTypes, opts) {
            argTypes = argTypes || [];
            var numericArgs = argTypes.every((type) => type === "number" || type === "boolean");
            var numericRet = returnType !== "string";
            if (numericRet && numericArgs && !opts) {
              return getCFunc(ident);
            }
            return function() {
              return ccall(ident, returnType, argTypes, arguments, opts);
            };
          }
          var asmLibraryArg = { "e": _emscripten_memcpy_big, "c": _emscripten_resize_heap, "d": _fd_close, "b": _fd_seek, "a": _fd_write };
          var asm = createWasm();
          var ___wasm_call_ctors = Module["___wasm_call_ctors"] = function() {
            return (___wasm_call_ctors = Module["___wasm_call_ctors"] = Module["asm"]["g"]).apply(null, arguments);
          };
          var _kiss_fft_alloc = Module["_kiss_fft_alloc"] = function() {
            return (_kiss_fft_alloc = Module["_kiss_fft_alloc"] = Module["asm"]["h"]).apply(null, arguments);
          };
          var _malloc = Module["_malloc"] = function() {
            return (_malloc = Module["_malloc"] = Module["asm"]["i"]).apply(null, arguments);
          };
          var _free = Module["_free"] = function() {
            return (_free = Module["_free"] = Module["asm"]["j"]).apply(null, arguments);
          };
          var _kiss_fft = Module["_kiss_fft"] = function() {
            return (_kiss_fft = Module["_kiss_fft"] = Module["asm"]["k"]).apply(null, arguments);
          };
          var _kiss_fft_cleanup = Module["_kiss_fft_cleanup"] = function() {
            return (_kiss_fft_cleanup = Module["_kiss_fft_cleanup"] = Module["asm"]["l"]).apply(null, arguments);
          };
          var _kiss_fftr_alloc = Module["_kiss_fftr_alloc"] = function() {
            return (_kiss_fftr_alloc = Module["_kiss_fftr_alloc"] = Module["asm"]["m"]).apply(null, arguments);
          };
          var _kiss_fftr = Module["_kiss_fftr"] = function() {
            return (_kiss_fftr = Module["_kiss_fftr"] = Module["asm"]["n"]).apply(null, arguments);
          };
          var _kiss_fftri = Module["_kiss_fftri"] = function() {
            return (_kiss_fftri = Module["_kiss_fftri"] = Module["asm"]["o"]).apply(null, arguments);
          };
          var stackSave = Module["stackSave"] = function() {
            return (stackSave = Module["stackSave"] = Module["asm"]["q"]).apply(null, arguments);
          };
          var stackRestore = Module["stackRestore"] = function() {
            return (stackRestore = Module["stackRestore"] = Module["asm"]["r"]).apply(null, arguments);
          };
          var stackAlloc = Module["stackAlloc"] = function() {
            return (stackAlloc = Module["stackAlloc"] = Module["asm"]["s"]).apply(null, arguments);
          };
          Module["ccall"] = ccall;
          Module["cwrap"] = cwrap;
          var calledRun;
          dependenciesFulfilled = function runCaller() {
            if (!calledRun)
              run();
            if (!calledRun)
              dependenciesFulfilled = runCaller;
          };
          function run(args) {
            args = args || arguments_;
            if (runDependencies > 0) {
              return;
            }
            preRun();
            if (runDependencies > 0) {
              return;
            }
            function doRun() {
              if (calledRun)
                return;
              calledRun = true;
              Module["calledRun"] = true;
              if (ABORT)
                return;
              initRuntime();
              readyPromiseResolve(Module);
              if (Module["onRuntimeInitialized"])
                Module["onRuntimeInitialized"]();
              postRun();
            }
            if (Module["setStatus"]) {
              Module["setStatus"]("Running...");
              setTimeout(function() {
                setTimeout(function() {
                  Module["setStatus"]("");
                }, 1);
                doRun();
              }, 1);
            } else {
              doRun();
            }
          }
          if (Module["preInit"]) {
            if (typeof Module["preInit"] == "function")
              Module["preInit"] = [Module["preInit"]];
            while (Module["preInit"].length > 0) {
              Module["preInit"].pop()();
            }
          }
          run();
          return KissFFTModule2.ready;
        };
      })();
      if (typeof exports === "object" && typeof module === "object")
        module.exports = KissFFTModule;
      else if (typeof define === "function" && define["amd"])
        define([], function() {
          return KissFFTModule;
        });
      else if (typeof exports === "object")
        exports["KissFFTModule"] = KissFFTModule;
    }
  });

  // src/exports-bundle.ts
  var exports_bundle_exports = {};
  __export(exports_bundle_exports, {
    KissFFT: () => KissFFT_default,
    KissFFTModuleFactoryFn: () => KissFFTModuleFactoryFn,
    KissFFTModuleFactoryWasm: () => KissFFTModuleFactoryWasm,
    instantiateKissFFTModule: () => instantiateKissFFTModule_default,
    instantiateKissFFTModuleFromFile: () => instantiateKissFFTModuleFromFile_default
  });

  // src/instantiateKissFFTModule.ts
  var import_libkissfft = __toESM(require_libkissfft(), 1);

  // libkissfft-wasm/libkissfft.wasm
  var libkissfft_exports = {};
  __export(libkissfft_exports, {
    default: () => libkissfft_default
  });
  var libkissfft_default = __toBinary("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");

  // src/instantiateKissFFTModule.ts
  var KissFFTModuleFactoryFn = import_libkissfft.default;
  var KissFFTModuleFactoryWasm = libkissfft_default;
  var instantiateKissFFTModule = async (ModuleFactoryIn = import_libkissfft.default, wasmBinaryIn = libkissfft_default) => {
    const g = globalThis;
    if (g.AudioWorkletGlobalScope) {
      g.importScripts = () => {
      };
      g.self = { location: { href: "" } };
    }
    const module = await ModuleFactoryIn({
      wasmBinary: wasmBinaryIn
      /*,
      getPreloadedPackage: (remotePackageName: string, remotePackageSize: number) => {
          if (remotePackageName === "libfaust-wasm.data") return dataBinaryIn.buffer;
          return new ArrayBuffer(0);
      }*/
    });
    if (g.AudioWorkletGlobalScope) {
      delete g.importScripts;
      delete g.self;
    }
    return module;
  };
  var instantiateKissFFTModule_default = instantiateKissFFTModule;

  // src/instantiateKissFFTModuleFromFile.ts
  var instantiateKissFFTModuleFromFile = async (jsFile, wasmFile = jsFile.replace(/c?js$/, "wasm"), dataFile = jsFile.replace(/c?js$/, "data")) => {
    var _a, _b;
    let Module;
    let wasmBinary;
    const jsCodeHead = /var (.+) = \(\(\) => \{/;
    if (typeof globalThis.fetch === "function") {
      let jsCode = await (await fetch(jsFile)).text();
      jsCode = `${jsCode}
export default ${(_a = jsCode.match(jsCodeHead)) == null ? void 0 : _a[1]};
`;
      const jsFileMod = URL.createObjectURL(new Blob([jsCode], { type: "text/javascript" }));
      Module = (await import(
        /* webpackIgnore: true */
        jsFileMod
      )).default;
      wasmBinary = new Uint8Array(await (await fetch(wasmFile)).arrayBuffer());
    } else {
      const { promises: fs } = await import("fs");
      const { pathToFileURL } = await import("url");
      let jsCode = await fs.readFile(jsFile, { encoding: "utf-8" });
      jsCode = `
import process from "process";
import * as path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const __filename = fileURLToPath(import.meta.url);
const require = createRequire(import.meta.url);

${jsCode}

export default ${(_b = jsCode.match(jsCodeHead)) == null ? void 0 : _b[1]};
`;
      const jsFileMod = jsFile.replace(/c?js$/, "mjs");
      await fs.writeFile(jsFileMod, jsCode);
      Module = (await import(
        /* webpackIgnore: true */
        pathToFileURL(jsFileMod).href
      )).default;
      await fs.unlink(jsFileMod);
      wasmBinary = (await fs.readFile(wasmFile)).buffer;
    }
    const module = await Module({
      wasmBinary
      /*,
      getPreloadedPackage: (remotePackageName: string, remotePackageSize: number) => {
          if (remotePackageName === "libfaust-wasm.data") return dataBinary;
          return new ArrayBuffer(0);
      }*/
    });
    return module;
  };
  var instantiateKissFFTModuleFromFile_default = instantiateKissFFTModuleFromFile;

  // src/KissFFT.ts
  var KissFFT = class {
    constructor(kissFFTModule) {
      const {
        _kiss_fftr_alloc,
        _kiss_fftr,
        _kiss_fftri,
        _kiss_fft,
        _kiss_fft_alloc,
        _kiss_fft_cleanup,
        _free,
        _malloc
      } = kissFFTModule;
      class FFT {
        constructor(size) {
          this.size = size;
          this.fcfg = _kiss_fft_alloc(size, false);
          this.icfg = _kiss_fft_alloc(size, true);
          this.inptr = kissFFTModule._malloc(size * 8 + size * 8);
          this.outptr = this.inptr + size * 8;
          this.cin = new Float32Array(kissFFTModule.HEAPU8.buffer, this.inptr, size * 2);
          this.cout = new Float32Array(kissFFTModule.HEAPU8.buffer, this.outptr, size * 2);
        }
        forward(cin) {
          if (typeof cin === "function")
            cin(this.cin);
          else
            this.cin.set(cin);
          _kiss_fft(this.fcfg, this.inptr, this.outptr);
          return this.cout;
        }
        inverse(cpx) {
          if (typeof cpx === "function")
            cpx(this.cin);
          else
            this.cin.set(cpx);
          _kiss_fft(this.icfg, this.inptr, this.outptr);
          return this.cout;
        }
        dispose() {
          _free(this.inptr);
          _kiss_fft_cleanup();
        }
      }
      class FFTR {
        constructor(size) {
          this.size = size;
          this.fcfg = _kiss_fftr_alloc(size, false);
          this.icfg = _kiss_fftr_alloc(size, true);
          this.rptr = _malloc(size * 4 + (size + 2) * 4);
          this.cptr = this.rptr + size * 4;
          this.ri = new Float32Array(kissFFTModule.HEAPU8.buffer, this.rptr, size);
          this.ci = new Float32Array(kissFFTModule.HEAPU8.buffer, this.cptr, size + 2);
        }
        forward(real) {
          if (typeof real === "function")
            real(this.ri);
          else
            this.ri.set(real);
          _kiss_fftr(this.fcfg, this.rptr, this.cptr);
          return this.ci;
        }
        inverse(cpx) {
          if (typeof cpx === "function")
            cpx(this.ci);
          else
            this.ci.set(cpx);
          _kiss_fftri(this.icfg, this.cptr, this.rptr);
          return this.ri;
        }
        dispose() {
          _free(this.rptr);
          _kiss_fft_cleanup();
        }
      }
      this._FFT = FFT;
      this._FFTR = FFTR;
    }
    get FFT() {
      return this._FFT;
    }
    get FFTR() {
      return this._FFTR;
    }
  };
  var KissFFT_default = KissFFT;

  // src/index-bundle-iife.ts
  globalThis.kissfftwasm = exports_bundle_exports;
})();
//# sourceMappingURL=index.js.map
