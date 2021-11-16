var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __markAsModule = (target) => __defProp(target, "__esModule", { value: true });
var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
  get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
}) : x)(function(x) {
  if (typeof require !== "undefined")
    return require.apply(this, arguments);
  throw new Error('Dynamic require of "' + x + '" is not supported');
});
var __commonJS = (cb, mod) => function __require2() {
  return mod || (0, cb[Object.keys(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __reExport = (target, module2, desc) => {
  if (module2 && typeof module2 === "object" || typeof module2 === "function") {
    for (let key of __getOwnPropNames(module2))
      if (!__hasOwnProp.call(target, key) && key !== "default")
        __defProp(target, key, { get: () => module2[key], enumerable: !(desc = __getOwnPropDesc(module2, key)) || desc.enumerable });
  }
  return target;
};
var __toModule = (module2) => {
  return __reExport(__markAsModule(__defProp(module2 != null ? __create(__getProtoOf(module2)) : {}, "default", module2 && module2.__esModule && "default" in module2 ? { get: () => module2.default, enumerable: true } : { value: module2, enumerable: true })), module2);
};

// node_modules/js-sha256/src/sha256.js
var require_sha256 = __commonJS({
  "node_modules/js-sha256/src/sha256.js"(exports, module) {
    (function() {
      "use strict";
      var ERROR = "input is invalid type";
      var WINDOW = typeof window === "object";
      var root = WINDOW ? window : {};
      if (root.JS_SHA256_NO_WINDOW) {
        WINDOW = false;
      }
      var WEB_WORKER = !WINDOW && typeof self === "object";
      var NODE_JS = !root.JS_SHA256_NO_NODE_JS && typeof process === "object" && process.versions && process.versions.node;
      if (NODE_JS) {
        root = global;
      } else if (WEB_WORKER) {
        root = self;
      }
      var COMMON_JS = !root.JS_SHA256_NO_COMMON_JS && typeof module === "object" && module.exports;
      var AMD = typeof define === "function" && define.amd;
      var ARRAY_BUFFER = !root.JS_SHA256_NO_ARRAY_BUFFER && typeof ArrayBuffer !== "undefined";
      var HEX_CHARS = "0123456789abcdef".split("");
      var EXTRA = [-2147483648, 8388608, 32768, 128];
      var SHIFT = [24, 16, 8, 0];
      var K = [
        1116352408,
        1899447441,
        3049323471,
        3921009573,
        961987163,
        1508970993,
        2453635748,
        2870763221,
        3624381080,
        310598401,
        607225278,
        1426881987,
        1925078388,
        2162078206,
        2614888103,
        3248222580,
        3835390401,
        4022224774,
        264347078,
        604807628,
        770255983,
        1249150122,
        1555081692,
        1996064986,
        2554220882,
        2821834349,
        2952996808,
        3210313671,
        3336571891,
        3584528711,
        113926993,
        338241895,
        666307205,
        773529912,
        1294757372,
        1396182291,
        1695183700,
        1986661051,
        2177026350,
        2456956037,
        2730485921,
        2820302411,
        3259730800,
        3345764771,
        3516065817,
        3600352804,
        4094571909,
        275423344,
        430227734,
        506948616,
        659060556,
        883997877,
        958139571,
        1322822218,
        1537002063,
        1747873779,
        1955562222,
        2024104815,
        2227730452,
        2361852424,
        2428436474,
        2756734187,
        3204031479,
        3329325298
      ];
      var OUTPUT_TYPES = ["hex", "array", "digest", "arrayBuffer"];
      var blocks = [];
      if (root.JS_SHA256_NO_NODE_JS || !Array.isArray) {
        Array.isArray = function(obj) {
          return Object.prototype.toString.call(obj) === "[object Array]";
        };
      }
      if (ARRAY_BUFFER && (root.JS_SHA256_NO_ARRAY_BUFFER_IS_VIEW || !ArrayBuffer.isView)) {
        ArrayBuffer.isView = function(obj) {
          return typeof obj === "object" && obj.buffer && obj.buffer.constructor === ArrayBuffer;
        };
      }
      var createOutputMethod = function(outputType, is2242) {
        return function(message) {
          return new Sha256(is2242, true).update(message)[outputType]();
        };
      };
      var createMethod = function(is2242) {
        var method2 = createOutputMethod("hex", is2242);
        if (NODE_JS) {
          method2 = nodeWrap(method2, is2242);
        }
        method2.create = function() {
          return new Sha256(is2242);
        };
        method2.update = function(message) {
          return method2.create().update(message);
        };
        for (var i = 0; i < OUTPUT_TYPES.length; ++i) {
          var type = OUTPUT_TYPES[i];
          method2[type] = createOutputMethod(type, is2242);
        }
        return method2;
      };
      var nodeWrap = function(method, is224) {
        var crypto = eval("require('crypto')");
        var Buffer = eval("require('buffer').Buffer");
        var algorithm = is224 ? "sha224" : "sha256";
        var nodeMethod = function(message) {
          if (typeof message === "string") {
            return crypto.createHash(algorithm).update(message, "utf8").digest("hex");
          } else {
            if (message === null || message === void 0) {
              throw new Error(ERROR);
            } else if (message.constructor === ArrayBuffer) {
              message = new Uint8Array(message);
            }
          }
          if (Array.isArray(message) || ArrayBuffer.isView(message) || message.constructor === Buffer) {
            return crypto.createHash(algorithm).update(new Buffer(message)).digest("hex");
          } else {
            return method(message);
          }
        };
        return nodeMethod;
      };
      var createHmacOutputMethod = function(outputType, is2242) {
        return function(key, message) {
          return new HmacSha256(key, is2242, true).update(message)[outputType]();
        };
      };
      var createHmacMethod = function(is2242) {
        var method2 = createHmacOutputMethod("hex", is2242);
        method2.create = function(key) {
          return new HmacSha256(key, is2242);
        };
        method2.update = function(key, message) {
          return method2.create(key).update(message);
        };
        for (var i = 0; i < OUTPUT_TYPES.length; ++i) {
          var type = OUTPUT_TYPES[i];
          method2[type] = createHmacOutputMethod(type, is2242);
        }
        return method2;
      };
      function Sha256(is2242, sharedMemory) {
        if (sharedMemory) {
          blocks[0] = blocks[16] = blocks[1] = blocks[2] = blocks[3] = blocks[4] = blocks[5] = blocks[6] = blocks[7] = blocks[8] = blocks[9] = blocks[10] = blocks[11] = blocks[12] = blocks[13] = blocks[14] = blocks[15] = 0;
          this.blocks = blocks;
        } else {
          this.blocks = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
        }
        if (is2242) {
          this.h0 = 3238371032;
          this.h1 = 914150663;
          this.h2 = 812702999;
          this.h3 = 4144912697;
          this.h4 = 4290775857;
          this.h5 = 1750603025;
          this.h6 = 1694076839;
          this.h7 = 3204075428;
        } else {
          this.h0 = 1779033703;
          this.h1 = 3144134277;
          this.h2 = 1013904242;
          this.h3 = 2773480762;
          this.h4 = 1359893119;
          this.h5 = 2600822924;
          this.h6 = 528734635;
          this.h7 = 1541459225;
        }
        this.block = this.start = this.bytes = this.hBytes = 0;
        this.finalized = this.hashed = false;
        this.first = true;
        this.is224 = is2242;
      }
      Sha256.prototype.update = function(message) {
        if (this.finalized) {
          return;
        }
        var notString, type = typeof message;
        if (type !== "string") {
          if (type === "object") {
            if (message === null) {
              throw new Error(ERROR);
            } else if (ARRAY_BUFFER && message.constructor === ArrayBuffer) {
              message = new Uint8Array(message);
            } else if (!Array.isArray(message)) {
              if (!ARRAY_BUFFER || !ArrayBuffer.isView(message)) {
                throw new Error(ERROR);
              }
            }
          } else {
            throw new Error(ERROR);
          }
          notString = true;
        }
        var code, index = 0, i, length = message.length, blocks2 = this.blocks;
        while (index < length) {
          if (this.hashed) {
            this.hashed = false;
            blocks2[0] = this.block;
            blocks2[16] = blocks2[1] = blocks2[2] = blocks2[3] = blocks2[4] = blocks2[5] = blocks2[6] = blocks2[7] = blocks2[8] = blocks2[9] = blocks2[10] = blocks2[11] = blocks2[12] = blocks2[13] = blocks2[14] = blocks2[15] = 0;
          }
          if (notString) {
            for (i = this.start; index < length && i < 64; ++index) {
              blocks2[i >> 2] |= message[index] << SHIFT[i++ & 3];
            }
          } else {
            for (i = this.start; index < length && i < 64; ++index) {
              code = message.charCodeAt(index);
              if (code < 128) {
                blocks2[i >> 2] |= code << SHIFT[i++ & 3];
              } else if (code < 2048) {
                blocks2[i >> 2] |= (192 | code >> 6) << SHIFT[i++ & 3];
                blocks2[i >> 2] |= (128 | code & 63) << SHIFT[i++ & 3];
              } else if (code < 55296 || code >= 57344) {
                blocks2[i >> 2] |= (224 | code >> 12) << SHIFT[i++ & 3];
                blocks2[i >> 2] |= (128 | code >> 6 & 63) << SHIFT[i++ & 3];
                blocks2[i >> 2] |= (128 | code & 63) << SHIFT[i++ & 3];
              } else {
                code = 65536 + ((code & 1023) << 10 | message.charCodeAt(++index) & 1023);
                blocks2[i >> 2] |= (240 | code >> 18) << SHIFT[i++ & 3];
                blocks2[i >> 2] |= (128 | code >> 12 & 63) << SHIFT[i++ & 3];
                blocks2[i >> 2] |= (128 | code >> 6 & 63) << SHIFT[i++ & 3];
                blocks2[i >> 2] |= (128 | code & 63) << SHIFT[i++ & 3];
              }
            }
          }
          this.lastByteIndex = i;
          this.bytes += i - this.start;
          if (i >= 64) {
            this.block = blocks2[16];
            this.start = i - 64;
            this.hash();
            this.hashed = true;
          } else {
            this.start = i;
          }
        }
        if (this.bytes > 4294967295) {
          this.hBytes += this.bytes / 4294967296 << 0;
          this.bytes = this.bytes % 4294967296;
        }
        return this;
      };
      Sha256.prototype.finalize = function() {
        if (this.finalized) {
          return;
        }
        this.finalized = true;
        var blocks2 = this.blocks, i = this.lastByteIndex;
        blocks2[16] = this.block;
        blocks2[i >> 2] |= EXTRA[i & 3];
        this.block = blocks2[16];
        if (i >= 56) {
          if (!this.hashed) {
            this.hash();
          }
          blocks2[0] = this.block;
          blocks2[16] = blocks2[1] = blocks2[2] = blocks2[3] = blocks2[4] = blocks2[5] = blocks2[6] = blocks2[7] = blocks2[8] = blocks2[9] = blocks2[10] = blocks2[11] = blocks2[12] = blocks2[13] = blocks2[14] = blocks2[15] = 0;
        }
        blocks2[14] = this.hBytes << 3 | this.bytes >>> 29;
        blocks2[15] = this.bytes << 3;
        this.hash();
      };
      Sha256.prototype.hash = function() {
        var a = this.h0, b = this.h1, c = this.h2, d = this.h3, e = this.h4, f = this.h5, g = this.h6, h = this.h7, blocks2 = this.blocks, j, s0, s1, maj, t1, t2, ch, ab, da, cd, bc;
        for (j = 16; j < 64; ++j) {
          t1 = blocks2[j - 15];
          s0 = (t1 >>> 7 | t1 << 25) ^ (t1 >>> 18 | t1 << 14) ^ t1 >>> 3;
          t1 = blocks2[j - 2];
          s1 = (t1 >>> 17 | t1 << 15) ^ (t1 >>> 19 | t1 << 13) ^ t1 >>> 10;
          blocks2[j] = blocks2[j - 16] + s0 + blocks2[j - 7] + s1 << 0;
        }
        bc = b & c;
        for (j = 0; j < 64; j += 4) {
          if (this.first) {
            if (this.is224) {
              ab = 300032;
              t1 = blocks2[0] - 1413257819;
              h = t1 - 150054599 << 0;
              d = t1 + 24177077 << 0;
            } else {
              ab = 704751109;
              t1 = blocks2[0] - 210244248;
              h = t1 - 1521486534 << 0;
              d = t1 + 143694565 << 0;
            }
            this.first = false;
          } else {
            s0 = (a >>> 2 | a << 30) ^ (a >>> 13 | a << 19) ^ (a >>> 22 | a << 10);
            s1 = (e >>> 6 | e << 26) ^ (e >>> 11 | e << 21) ^ (e >>> 25 | e << 7);
            ab = a & b;
            maj = ab ^ a & c ^ bc;
            ch = e & f ^ ~e & g;
            t1 = h + s1 + ch + K[j] + blocks2[j];
            t2 = s0 + maj;
            h = d + t1 << 0;
            d = t1 + t2 << 0;
          }
          s0 = (d >>> 2 | d << 30) ^ (d >>> 13 | d << 19) ^ (d >>> 22 | d << 10);
          s1 = (h >>> 6 | h << 26) ^ (h >>> 11 | h << 21) ^ (h >>> 25 | h << 7);
          da = d & a;
          maj = da ^ d & b ^ ab;
          ch = h & e ^ ~h & f;
          t1 = g + s1 + ch + K[j + 1] + blocks2[j + 1];
          t2 = s0 + maj;
          g = c + t1 << 0;
          c = t1 + t2 << 0;
          s0 = (c >>> 2 | c << 30) ^ (c >>> 13 | c << 19) ^ (c >>> 22 | c << 10);
          s1 = (g >>> 6 | g << 26) ^ (g >>> 11 | g << 21) ^ (g >>> 25 | g << 7);
          cd = c & d;
          maj = cd ^ c & a ^ da;
          ch = g & h ^ ~g & e;
          t1 = f + s1 + ch + K[j + 2] + blocks2[j + 2];
          t2 = s0 + maj;
          f = b + t1 << 0;
          b = t1 + t2 << 0;
          s0 = (b >>> 2 | b << 30) ^ (b >>> 13 | b << 19) ^ (b >>> 22 | b << 10);
          s1 = (f >>> 6 | f << 26) ^ (f >>> 11 | f << 21) ^ (f >>> 25 | f << 7);
          bc = b & c;
          maj = bc ^ b & d ^ cd;
          ch = f & g ^ ~f & h;
          t1 = e + s1 + ch + K[j + 3] + blocks2[j + 3];
          t2 = s0 + maj;
          e = a + t1 << 0;
          a = t1 + t2 << 0;
        }
        this.h0 = this.h0 + a << 0;
        this.h1 = this.h1 + b << 0;
        this.h2 = this.h2 + c << 0;
        this.h3 = this.h3 + d << 0;
        this.h4 = this.h4 + e << 0;
        this.h5 = this.h5 + f << 0;
        this.h6 = this.h6 + g << 0;
        this.h7 = this.h7 + h << 0;
      };
      Sha256.prototype.hex = function() {
        this.finalize();
        var h0 = this.h0, h1 = this.h1, h2 = this.h2, h3 = this.h3, h4 = this.h4, h5 = this.h5, h6 = this.h6, h7 = this.h7;
        var hex = HEX_CHARS[h0 >> 28 & 15] + HEX_CHARS[h0 >> 24 & 15] + HEX_CHARS[h0 >> 20 & 15] + HEX_CHARS[h0 >> 16 & 15] + HEX_CHARS[h0 >> 12 & 15] + HEX_CHARS[h0 >> 8 & 15] + HEX_CHARS[h0 >> 4 & 15] + HEX_CHARS[h0 & 15] + HEX_CHARS[h1 >> 28 & 15] + HEX_CHARS[h1 >> 24 & 15] + HEX_CHARS[h1 >> 20 & 15] + HEX_CHARS[h1 >> 16 & 15] + HEX_CHARS[h1 >> 12 & 15] + HEX_CHARS[h1 >> 8 & 15] + HEX_CHARS[h1 >> 4 & 15] + HEX_CHARS[h1 & 15] + HEX_CHARS[h2 >> 28 & 15] + HEX_CHARS[h2 >> 24 & 15] + HEX_CHARS[h2 >> 20 & 15] + HEX_CHARS[h2 >> 16 & 15] + HEX_CHARS[h2 >> 12 & 15] + HEX_CHARS[h2 >> 8 & 15] + HEX_CHARS[h2 >> 4 & 15] + HEX_CHARS[h2 & 15] + HEX_CHARS[h3 >> 28 & 15] + HEX_CHARS[h3 >> 24 & 15] + HEX_CHARS[h3 >> 20 & 15] + HEX_CHARS[h3 >> 16 & 15] + HEX_CHARS[h3 >> 12 & 15] + HEX_CHARS[h3 >> 8 & 15] + HEX_CHARS[h3 >> 4 & 15] + HEX_CHARS[h3 & 15] + HEX_CHARS[h4 >> 28 & 15] + HEX_CHARS[h4 >> 24 & 15] + HEX_CHARS[h4 >> 20 & 15] + HEX_CHARS[h4 >> 16 & 15] + HEX_CHARS[h4 >> 12 & 15] + HEX_CHARS[h4 >> 8 & 15] + HEX_CHARS[h4 >> 4 & 15] + HEX_CHARS[h4 & 15] + HEX_CHARS[h5 >> 28 & 15] + HEX_CHARS[h5 >> 24 & 15] + HEX_CHARS[h5 >> 20 & 15] + HEX_CHARS[h5 >> 16 & 15] + HEX_CHARS[h5 >> 12 & 15] + HEX_CHARS[h5 >> 8 & 15] + HEX_CHARS[h5 >> 4 & 15] + HEX_CHARS[h5 & 15] + HEX_CHARS[h6 >> 28 & 15] + HEX_CHARS[h6 >> 24 & 15] + HEX_CHARS[h6 >> 20 & 15] + HEX_CHARS[h6 >> 16 & 15] + HEX_CHARS[h6 >> 12 & 15] + HEX_CHARS[h6 >> 8 & 15] + HEX_CHARS[h6 >> 4 & 15] + HEX_CHARS[h6 & 15];
        if (!this.is224) {
          hex += HEX_CHARS[h7 >> 28 & 15] + HEX_CHARS[h7 >> 24 & 15] + HEX_CHARS[h7 >> 20 & 15] + HEX_CHARS[h7 >> 16 & 15] + HEX_CHARS[h7 >> 12 & 15] + HEX_CHARS[h7 >> 8 & 15] + HEX_CHARS[h7 >> 4 & 15] + HEX_CHARS[h7 & 15];
        }
        return hex;
      };
      Sha256.prototype.toString = Sha256.prototype.hex;
      Sha256.prototype.digest = function() {
        this.finalize();
        var h0 = this.h0, h1 = this.h1, h2 = this.h2, h3 = this.h3, h4 = this.h4, h5 = this.h5, h6 = this.h6, h7 = this.h7;
        var arr = [
          h0 >> 24 & 255,
          h0 >> 16 & 255,
          h0 >> 8 & 255,
          h0 & 255,
          h1 >> 24 & 255,
          h1 >> 16 & 255,
          h1 >> 8 & 255,
          h1 & 255,
          h2 >> 24 & 255,
          h2 >> 16 & 255,
          h2 >> 8 & 255,
          h2 & 255,
          h3 >> 24 & 255,
          h3 >> 16 & 255,
          h3 >> 8 & 255,
          h3 & 255,
          h4 >> 24 & 255,
          h4 >> 16 & 255,
          h4 >> 8 & 255,
          h4 & 255,
          h5 >> 24 & 255,
          h5 >> 16 & 255,
          h5 >> 8 & 255,
          h5 & 255,
          h6 >> 24 & 255,
          h6 >> 16 & 255,
          h6 >> 8 & 255,
          h6 & 255
        ];
        if (!this.is224) {
          arr.push(h7 >> 24 & 255, h7 >> 16 & 255, h7 >> 8 & 255, h7 & 255);
        }
        return arr;
      };
      Sha256.prototype.array = Sha256.prototype.digest;
      Sha256.prototype.arrayBuffer = function() {
        this.finalize();
        var buffer = new ArrayBuffer(this.is224 ? 28 : 32);
        var dataView = new DataView(buffer);
        dataView.setUint32(0, this.h0);
        dataView.setUint32(4, this.h1);
        dataView.setUint32(8, this.h2);
        dataView.setUint32(12, this.h3);
        dataView.setUint32(16, this.h4);
        dataView.setUint32(20, this.h5);
        dataView.setUint32(24, this.h6);
        if (!this.is224) {
          dataView.setUint32(28, this.h7);
        }
        return buffer;
      };
      function HmacSha256(key, is2242, sharedMemory) {
        var i, type = typeof key;
        if (type === "string") {
          var bytes = [], length = key.length, index = 0, code;
          for (i = 0; i < length; ++i) {
            code = key.charCodeAt(i);
            if (code < 128) {
              bytes[index++] = code;
            } else if (code < 2048) {
              bytes[index++] = 192 | code >> 6;
              bytes[index++] = 128 | code & 63;
            } else if (code < 55296 || code >= 57344) {
              bytes[index++] = 224 | code >> 12;
              bytes[index++] = 128 | code >> 6 & 63;
              bytes[index++] = 128 | code & 63;
            } else {
              code = 65536 + ((code & 1023) << 10 | key.charCodeAt(++i) & 1023);
              bytes[index++] = 240 | code >> 18;
              bytes[index++] = 128 | code >> 12 & 63;
              bytes[index++] = 128 | code >> 6 & 63;
              bytes[index++] = 128 | code & 63;
            }
          }
          key = bytes;
        } else {
          if (type === "object") {
            if (key === null) {
              throw new Error(ERROR);
            } else if (ARRAY_BUFFER && key.constructor === ArrayBuffer) {
              key = new Uint8Array(key);
            } else if (!Array.isArray(key)) {
              if (!ARRAY_BUFFER || !ArrayBuffer.isView(key)) {
                throw new Error(ERROR);
              }
            }
          } else {
            throw new Error(ERROR);
          }
        }
        if (key.length > 64) {
          key = new Sha256(is2242, true).update(key).array();
        }
        var oKeyPad = [], iKeyPad = [];
        for (i = 0; i < 64; ++i) {
          var b = key[i] || 0;
          oKeyPad[i] = 92 ^ b;
          iKeyPad[i] = 54 ^ b;
        }
        Sha256.call(this, is2242, sharedMemory);
        this.update(iKeyPad);
        this.oKeyPad = oKeyPad;
        this.inner = true;
        this.sharedMemory = sharedMemory;
      }
      HmacSha256.prototype = new Sha256();
      HmacSha256.prototype.finalize = function() {
        Sha256.prototype.finalize.call(this);
        if (this.inner) {
          this.inner = false;
          var innerHash = this.array();
          Sha256.call(this, this.is224, this.sharedMemory);
          this.update(this.oKeyPad);
          this.update(innerHash);
          Sha256.prototype.finalize.call(this);
        }
      };
      var exports = createMethod();
      exports.sha256 = exports;
      exports.sha224 = createMethod(true);
      exports.sha256.hmac = createHmacMethod();
      exports.sha224.hmac = createHmacMethod(true);
      if (COMMON_JS) {
        module.exports = exports;
      } else {
        root.sha256 = exports.sha256;
        root.sha224 = exports.sha224;
        if (AMD) {
          define(function() {
            return exports;
          });
        }
      }
    })();
  }
});

// src/FaustDsp.ts
var FaustDsp = class {
  constructor(mainCode, effectCode) {
    this.mainCode = mainCode;
    this.effectCode = effectCode;
  }
  async compile() {
    const time1 = Date.now();
    this.mainModule = await WebAssembly.compile(this.mainCode.wasmCModule);
    if (!this.mainModule) {
      throw new Error("Faust DSP factory cannot be compiled");
    }
    const time2 = Date.now();
    console.log("WASM compilation duration: " + (time2 - time1));
    try {
      const json = this.mainCode.helpers.match(/getJSON\w+?\(\)[\s\n]*{[\s\n]*return[\s\n]*'(\{.+?)';}/)[1].replace(/\\'/g, "'");
      const meta = JSON.parse(json);
      this.mainMeta = meta;
    } catch (e) {
      console.error("Error in JSON.parse: " + e.message);
      throw e;
    }
    if (!this.effectCode)
      return;
    const effectModule = new WebAssembly.Module(this.effectCode.wasmCModule);
    this.effectModule = effectModule;
    try {
      const json = this.effectCode.helpers.match(/getJSON\w+?\(\)[\s\n]*{[\s\n]*return[\s\n]*'(\{.+?)';}/)[1].replace(/\\'/g, "'");
      const meta = JSON.parse(json);
      this.effectMeta = meta;
    } catch (e) {
      console.error("Error in JSON.parse: " + e.message);
      throw e;
    }
  }
};
var FaustDsp_default = FaustDsp;

// src/Faust.ts
var import_js_sha256 = __toModule(require_sha256());
var Faust = class {
  constructor(libFaust) {
    this.libFaust = libFaust;
    this.importLibFaustFunctions();
    this.version = this.getLibFaustVersion();
  }
  importLibFaustFunctions() {
    if (!this.libFaust)
      return;
    this.createWasmCDSPFactoryFromString = this.libFaust.cwrap("createWasmCDSPFactoryFromString", "number", ["number", "number", "number", "number", "number", "number"]);
    this.deleteAllWasmCDSPFactories = this.libFaust.cwrap("deleteAllWasmCDSPFactories", null, []);
    this.expandCDSPFromString = this.libFaust.cwrap("expandCDSPFromString", "number", ["number", "number", "number", "number", "number", "number"]);
    this.getCLibFaustVersion = this.libFaust.cwrap("getCLibFaustVersion", "number", []);
    this.getWasmCModule = this.libFaust.cwrap("getWasmCModule", "number", ["number"]);
    this.getWasmCModuleSize = this.libFaust.cwrap("getWasmCModuleSize", "number", ["number"]);
    this.getWasmCHelpers = this.libFaust.cwrap("getWasmCHelpers", "number", ["number"]);
    this.freeWasmCModule = this.libFaust.cwrap("freeWasmCModule", null, ["number"]);
    this.freeCMemory = this.libFaust.cwrap("freeCMemory", null, ["number"]);
    this.cleanupAfterException = this.libFaust.cwrap("cleanupAfterException", null, []);
    this.getErrorAfterException = this.libFaust.cwrap("getErrorAfterException", "number", []);
    this.generateCAuxFilesFromString = this.libFaust.cwrap("generateCAuxFilesFromString", "number", ["number", "number", "number", "number", "number"]);
    this.getLibFaustVersion = () => this.libFaust.UTF8ToString(this.getCLibFaustVersion());
  }
  compileCode(code, argv = [], internalMemory = true) {
    const codeSize = this.libFaust.lengthBytesUTF8(code) + 1;
    const $code = this.libFaust._malloc(codeSize);
    const name = "FaustDSP";
    const nameSize = this.libFaust.lengthBytesUTF8(name) + 1;
    const $name = this.libFaust._malloc(nameSize);
    const $errorMsg = this.libFaust._malloc(4096);
    this.libFaust.stringToUTF8(name, $name, nameSize);
    this.libFaust.stringToUTF8(code, $code, codeSize);
    if (!argv.find((a) => a === "-cn")) {
      const sha1 = (0, import_js_sha256.sha256)(code + argv.join("") + (internalMemory ? "i" : "e"));
      argv.push("-cn", sha1);
    }
    const ptrSize = 4;
    const $argv = this.libFaust._malloc(argv.length * ptrSize);
    let argvBuffer$ = new Int32Array(this.libFaust.HEAP32.buffer, $argv, argv.length);
    for (let i = 0; i < argv.length; i++) {
      const size$arg = this.libFaust.lengthBytesUTF8(argv[i]) + 1;
      const $arg = this.libFaust._malloc(size$arg);
      this.libFaust.stringToUTF8(argv[i], $arg, size$arg);
      argvBuffer$[i] = $arg;
    }
    try {
      const time1 = Date.now();
      const $moduleCode = this.createWasmCDSPFactoryFromString($name, $code, argv.length, $argv, $errorMsg, internalMemory);
      const time2 = Date.now();
      console.log("Faust compilation duration: " + (time2 - time1));
      const errorMsg = this.libFaust.UTF8ToString($errorMsg);
      if (errorMsg)
        throw new Error(errorMsg);
      if ($moduleCode === 0)
        return null;
      const $wasmCModule = this.getWasmCModule($moduleCode);
      const wasmCModuleSize = this.getWasmCModuleSize($moduleCode);
      const wasmCModule = new Uint8Array(wasmCModuleSize);
      for (let i = 0; i < wasmCModuleSize; i++) {
        wasmCModule[i] = this.libFaust.HEAP8[$wasmCModule + i];
      }
      const $helpers = this.getWasmCHelpers($moduleCode);
      const helpers = this.libFaust.UTF8ToString($helpers);
      this.libFaust._free($code);
      this.libFaust._free($name);
      this.libFaust._free($errorMsg);
      this.freeWasmCModule($moduleCode);
      argvBuffer$ = new Int32Array(this.libFaust.HEAP32.buffer, $argv, argv.length);
      for (let i = 0; i < argv.length; i++) {
        this.libFaust._free(argvBuffer$[i]);
      }
      this.libFaust._free($argv);
      return { wasmCModule, code, helpers };
    } catch (e) {
      const errorMsg = this.libFaust.UTF8ToString(this.getErrorAfterException());
      this.cleanupAfterException();
      throw errorMsg ? new Error(errorMsg) : e;
    }
  }
  async compile(code, argv = [], internalMemory = true) {
    console.log(`libfaust.js version: ${this.version}`);
    const effectCode = `adapt(1,1) = _; adapt(2,2) = _,_; adapt(1,2) = _ <: _,_; adapt(2,1) = _,_ :> _;
adaptor(F,G) = adapt(outputs(F),inputs(G));
dsp_code = environment{${code}};
process = adaptor(dsp_code.process, dsp_code.effect) : dsp_code.effect;`;
    const mainCompiledCode = this.compileCode(code, argv, internalMemory);
    let effectCompiledCode;
    try {
      effectCompiledCode = this.compileCode(effectCode, argv, internalMemory);
    } catch (e) {
    }
    const dsp = new FaustDsp_default(mainCompiledCode, effectCompiledCode);
    await dsp.compile();
    return dsp;
  }
  expandCode(code, args = []) {
    console.log(`libfaust.js version: ${this.version}`);
    const codeSize = this.libFaust.lengthBytesUTF8(code) + 1;
    const $code = this.libFaust._malloc(codeSize);
    const name = "FaustDSP";
    const nameSize = this.libFaust.lengthBytesUTF8(name) + 1;
    const $name = this.libFaust._malloc(nameSize);
    const $shaKey = this.libFaust._malloc(64);
    const $errorMsg = this.libFaust._malloc(4096);
    this.libFaust.stringToUTF8(name, $name, nameSize);
    this.libFaust.stringToUTF8(code, $code, codeSize);
    const argv = [...args, "-lang", "wasm"];
    const ptrSize = 4;
    const $argv = this.libFaust._malloc(argv.length * ptrSize);
    let argvBuffer$ = new Int32Array(this.libFaust.HEAP32.buffer, $argv, argv.length);
    for (let i = 0; i < argv.length; i++) {
      const size$arg = this.libFaust.lengthBytesUTF8(argv[i]) + 1;
      const $arg = this.libFaust._malloc(size$arg);
      this.libFaust.stringToUTF8(argv[i], $arg, size$arg);
      argvBuffer$[i] = $arg;
    }
    try {
      const $expandedCode = this.expandCDSPFromString($name, $code, argv.length, $argv, $shaKey, $errorMsg);
      const expandedCode = this.libFaust.UTF8ToString($expandedCode);
      const errorMsg = this.libFaust.UTF8ToString($errorMsg);
      if (errorMsg)
        console.error(errorMsg);
      this.libFaust._free($code);
      this.libFaust._free($name);
      this.libFaust._free($shaKey);
      this.libFaust._free($errorMsg);
      this.freeCMemory($expandedCode);
      argvBuffer$ = new Int32Array(this.libFaust.HEAP32.buffer, $argv, argv.length);
      for (let i = 0; i < argv.length; i++) {
        this.libFaust._free(argvBuffer$[i]);
      }
      this.libFaust._free($argv);
      return expandedCode;
    } catch (e) {
      const errorMsg = this.libFaust.UTF8ToString(this.getErrorAfterException());
      this.cleanupAfterException();
      throw errorMsg ? new Error(errorMsg) : e;
    }
  }
  getDiagram(code, args = []) {
    try {
      const files2 = this.libFaust.FS.readdir("/FaustDSP-svg/");
      files2.filter((file) => file !== "." && file !== "..").forEach((file) => this.libFaust.FS.unlink(`/FaustDSP-svg/${file}`));
    } catch (error) {
    }
    const codeSize = this.libFaust.lengthBytesUTF8(code) + 1;
    const $code = this.libFaust._malloc(codeSize);
    const name = "FaustDSP";
    const nameSize = this.libFaust.lengthBytesUTF8(name) + 1;
    const $name = this.libFaust._malloc(nameSize);
    const $errorMsg = this.libFaust._malloc(4096);
    this.libFaust.stringToUTF8(name, $name, nameSize);
    this.libFaust.stringToUTF8(code, $code, codeSize);
    const argv = [...args, "-lang", "wast", "-o", "/dev/null", "-svg"];
    const ptrSize = 4;
    const $argv = this.libFaust._malloc(argv.length * ptrSize);
    let argvBuffer$ = new Int32Array(this.libFaust.HEAP32.buffer, $argv, argv.length);
    for (let i = 0; i < argv.length; i++) {
      const size$arg = this.libFaust.lengthBytesUTF8(argv[i]) + 1;
      const $arg = this.libFaust._malloc(size$arg);
      this.libFaust.stringToUTF8(argv[i], $arg, size$arg);
      argvBuffer$[i] = $arg;
    }
    try {
      this.generateCAuxFilesFromString($name, $code, argv.length, $argv, $errorMsg);
      this.libFaust._free($code);
      this.libFaust._free($name);
      this.libFaust._free($errorMsg);
      argvBuffer$ = new Int32Array(this.libFaust.HEAP32.buffer, $argv, argv.length);
      for (let i = 0; i < argv.length; i++) {
        this.libFaust._free(argvBuffer$[i]);
      }
      this.libFaust._free($argv);
    } catch (e) {
      const errorMsg = this.libFaust.UTF8ToString(this.getErrorAfterException());
      this.cleanupAfterException();
      throw errorMsg ? new Error(errorMsg) : e;
    }
    const svg = {};
    const files = this.libFaust.FS.readdir("/FaustDSP-svg/");
    files.filter((file) => file !== "." && file !== "..").forEach((file) => svg[file] = this.libFaust.FS.readFile(`/FaustDSP-svg/${file}`, { encoding: "utf8" }));
    return svg;
  }
};
var Faust_default = Faust;

// src/utils.ts
var midiToFreq = (note) => 440 * 2 ** ((note - 69) / 12);
var remap = (v, mn0, mx0, mn1, mx1) => (v - mn0) / (mx0 - mn0) * (mx1 - mn1) + mn1;
var findPath = (o, p) => {
  if (typeof o !== "object")
    return false;
  if (o.address) {
    return o.address === p;
  }
  for (const k in o) {
    if (findPath(o[k], p))
      return true;
  }
  return false;
};
var createWasmImport = (voices, memory) => ({
  env: {
    memory: voices ? memory : void 0,
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
});
var createWasmMemory = (voicesIn, dspMeta, effectMeta, bufferSize) => {
  const voices = Math.max(4, voicesIn);
  const ptrSize = 4;
  const sampleSize = 4;
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
};

// src/FaustProcessor.ts
var FaustProcessor = class {
  constructor(options) {
    const { dsp, mixerModule, bufferSize, sampleRate, voices } = options;
    if (!dsp)
      throw new Error("No Dsp input");
    if (this.factory)
      throw new Error("Processor already initiated.");
    this.dsp = dsp;
    const { mainMeta, mainModule, effectMeta, effectModule } = dsp;
    this.dspMeta = mainMeta;
    this.dspModule = mainModule;
    this.effectMeta = effectMeta;
    this.effectModule = effectModule;
    this.mixerModule = mixerModule;
    this.bufferSize = bufferSize || 1024;
    this.sampleRate = sampleRate || 48e3;
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
    this.ptrSize = 4;
    this.sampleSize = 4;
    await this.instantiateWasm(this.dsp, this.mixerModule);
    this.factory = this.dspInstance.exports;
    this.HEAP = this.voices ? this.memory.buffer : this.factory.memory.buffer;
    this.HEAP32 = new Int32Array(this.HEAP);
    this.HEAPF32 = new Float32Array(this.HEAP);
    this.output = new Array(this.numOut).fill(null).map(() => new Float32Array(this.bufferSize));
    this.inputsItems = [];
    this.$audioHeap = this.dspMeta.size;
    this.$$audioHeapInputs = this.$audioHeap;
    this.$$audioHeapOutputs = this.$$audioHeapInputs + this.numIn * this.ptrSize;
    this.$audioHeapInputs = this.$$audioHeapOutputs + this.numOut * this.ptrSize;
    this.$audioHeapOutputs = this.$audioHeapInputs + this.numIn * this.bufferSize * this.sampleSize;
    if (this.voices) {
      this.$$audioHeapMixing = this.$$audioHeapOutputs + this.numOut * this.ptrSize;
      this.$audioHeapInputs = this.$$audioHeapMixing + this.numOut * this.ptrSize;
      this.$audioHeapOutputs = this.$audioHeapInputs + this.numIn * this.bufferSize * this.sampleSize;
      this.$audioHeapMixing = this.$audioHeapOutputs + this.numOut * this.bufferSize * this.sampleSize;
      this.$dsp = this.$audioHeapMixing + this.numOut * this.bufferSize * this.sampleSize;
    } else {
      this.$audioHeapInputs = this.$$audioHeapOutputs + this.numOut * this.ptrSize;
      this.$audioHeapOutputs = this.$audioHeapInputs + this.numIn * this.bufferSize * this.sampleSize;
      this.$dsp = 0;
    }
    if (this.voices) {
      this.effectMeta = this.effectMeta;
      this.$mixing = null;
      this.fFreqLabel$ = [];
      this.fGateLabel$ = [];
      this.fGainLabel$ = [];
      this.fDate = 0;
      this.mixer = this.mixerInstance.exports;
      this.effect = this.effectInstance ? this.effectInstance.exports : null;
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
      this.$effect = this.dspVoices$[this.voices - 1] + this.dspMeta.size;
    }
    this.pathTable$ = {};
    this.$sample = 0;
    this.setup();
  }
  setup() {
    if (this.numIn > 0) {
      this.$ins = this.$$audioHeapInputs;
      for (let i = 0; i < this.numIn; i++) {
        this.HEAP32[(this.$ins >> 2) + i] = this.$audioHeapInputs + this.bufferSize * this.sampleSize * i;
      }
      const dspInChans = this.HEAP32.subarray(this.$ins >> 2, this.$ins + this.numIn * this.ptrSize >> 2);
      for (let i = 0; i < this.numIn; i++) {
        this.dspInChannnels[i] = this.HEAPF32.subarray(dspInChans[i] >> 2, dspInChans[i] + this.bufferSize * this.sampleSize >> 2);
      }
    }
    if (this.numOut > 0) {
      this.$outs = this.$$audioHeapOutputs;
      if (this.voices)
        this.$mixing = this.$$audioHeapMixing;
      for (let i = 0; i < this.numOut; i++) {
        this.HEAP32[(this.$outs >> 2) + i] = this.$audioHeapOutputs + this.bufferSize * this.sampleSize * i;
        if (this.voices)
          this.HEAP32[(this.$mixing >> 2) + i] = this.$audioHeapMixing + this.bufferSize * this.sampleSize * i;
      }
      const dspOutChans = this.HEAP32.subarray(this.$outs >> 2, this.$outs + this.numOut * this.ptrSize >> 2);
      for (let i = 0; i < this.numOut; i++) {
        this.dspOutChannnels[i] = this.HEAPF32.subarray(dspOutChans[i] >> 2, dspOutChans[i] + this.bufferSize * this.sampleSize >> 2);
      }
    }
    this.parseUI(this.dspMeta.ui);
    if (this.effect)
      this.parseUI(this.effectMeta.ui);
    if (this.voices) {
      this.inputsItems.forEach((item) => {
        if (item.endsWith("/gate"))
          this.fGateLabel$.push(this.pathTable$[item]);
        else if (item.endsWith("/freq"))
          this.fFreqLabel$.push(this.pathTable$[item]);
        else if (item.endsWith("/gain"))
          this.fGainLabel$.push(this.pathTable$[item]);
      });
      this.dspVoices$.forEach(($voice) => this.factory.init($voice, this.sampleRate));
      if (this.effect)
        this.effect.init(this.$effect, this.sampleRate);
    } else {
      this.factory.init(this.$dsp, this.sampleRate);
    }
  }
  async instantiateWasm(dsp, mixerModule) {
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
  parseUI(ui) {
    ui.forEach((group) => this.parseGroup(group));
  }
  parseGroup(group) {
    if (group.items)
      this.parseItems(group.items);
  }
  parseItems(items) {
    items.forEach((item) => this.parseItem(item));
  }
  parseItem(item) {
    if (item.type === "vgroup" || item.type === "hgroup" || item.type === "tgroup") {
      this.parseItems(item.items);
    } else if (item.type === "hbargraph" || item.type === "vbargraph") {
      this.outputsItems.push(item.address);
    } else if (item.type === "vslider" || item.type === "hslider" || item.type === "button" || item.type === "checkbox" || item.type === "nentry") {
      this.inputsItems.push(item.address);
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
  }
  setParamValue(path, val) {
    if (this.voices) {
      if (this.effect && findPath(this.effectMeta.ui, path))
        this.effect.setParamValue(this.$effect, this.pathTable$[path], val);
      else
        this.dspVoices$.forEach(($voice) => this.factory.setParamValue($voice, this.pathTable$[path], val));
    } else {
      this.factory.setParamValue(this.$dsp, this.pathTable$[path], val);
    }
  }
  getParamValue(path) {
    if (this.voices) {
      if (this.effect && findPath(this.effectMeta.ui, path))
        return this.effect.getParamValue(this.$effect, this.pathTable$[path]);
      return this.factory.getParamValue(this.dspVoices$[0], this.pathTable$[path]);
    }
    return this.factory.getParamValue(this.$dsp, this.pathTable$[path]);
  }
  getPlayingVoice(pitch) {
    if (!this.voices)
      return null;
    let voice = this.kNoVoice;
    let oldestDatePlaying = Number.MAX_VALUE;
    for (let i = 0; i < this.voices; i++) {
      if (this.dspVoicesState[i] === pitch) {
        if (this.dspVoicesDate[i] < oldestDatePlaying) {
          oldestDatePlaying = this.dspVoicesDate[i];
          voice = i;
        }
      }
    }
    return voice;
  }
  allocVoice(voice) {
    if (!this.voices)
      return null;
    this.factory.instanceClear(this.dspVoices$[voice]);
    this.dspVoicesDate[voice] = this.fDate++;
    this.dspVoicesState[voice] = this.kActiveVoice;
    return voice;
  }
  getFreeVoice() {
    if (!this.voices)
      return null;
    for (let i = 0; i < this.voices; i++) {
      if (this.dspVoicesState[i] === this.kFreeVoice)
        return this.allocVoice(i);
    }
    let voiceRelease = this.kNoVoice;
    let voicePlaying = this.kNoVoice;
    let oldestDateRelease = Number.MAX_VALUE;
    let oldestDatePlaying = Number.MAX_VALUE;
    for (let i = 0; i < this.voices; i++) {
      if (this.dspVoicesState[i] === this.kReleaseVoice) {
        if (this.dspVoicesDate[i] < oldestDateRelease) {
          oldestDateRelease = this.dspVoicesDate[i];
          voiceRelease = i;
        }
      } else if (this.dspVoicesDate[i] < oldestDatePlaying) {
        oldestDatePlaying = this.dspVoicesDate[i];
        voicePlaying = i;
      }
    }
    if (oldestDateRelease !== Number.MAX_VALUE) {
      return this.allocVoice(voiceRelease);
    }
    if (oldestDatePlaying !== Number.MAX_VALUE) {
      return this.allocVoice(voicePlaying);
    }
    return this.kNoVoice;
  }
  keyOn(channel, pitch, velocity) {
    if (!this.voices)
      return;
    const voice = this.getFreeVoice();
    this.fFreqLabel$.forEach(($) => this.factory.setParamValue(this.dspVoices$[voice], $, midiToFreq(pitch)));
    this.fGateLabel$.forEach(($) => this.factory.setParamValue(this.dspVoices$[voice], $, 1));
    this.fGainLabel$.forEach(($) => this.factory.setParamValue(this.dspVoices$[voice], $, velocity / 127));
    this.dspVoicesState[voice] = pitch;
  }
  keyOff(channel, pitch, velocity) {
    if (!this.voices)
      return;
    const voice = this.getPlayingVoice(pitch);
    if (voice === this.kNoVoice)
      return;
    this.fGateLabel$.forEach(($) => this.factory.setParamValue(this.dspVoices$[voice], $, 0));
    this.dspVoicesState[voice] = this.kReleaseVoice;
  }
  allNotesOff() {
    if (!this.voices)
      return;
    for (let i = 0; i < this.voices; i++) {
      this.fGateLabel$.forEach(($gate) => this.factory.setParamValue(this.dspVoices$[i], $gate, 0));
      this.dspVoicesState[i] = this.kReleaseVoice;
    }
  }
  midiMessage(data) {
    const cmd = data[0] >> 4;
    const channel = data[0] & 15;
    const data1 = data[1];
    const data2 = data[2];
    if (channel === 9)
      return;
    if (cmd === 8 || cmd === 9 && data2 === 0)
      this.keyOff(channel, data1, data2);
    else if (cmd === 9)
      this.keyOn(channel, data1, data2);
    else if (cmd === 11)
      this.ctrlChange(channel, data1, data2);
    else if (cmd === 14)
      this.pitchWheel(channel, data2 * 128 + data1);
  }
  ctrlChange(channel, ctrl, value) {
    if (ctrl === 123 || ctrl === 120) {
      this.allNotesOff();
    }
    if (!this.fCtrlLabel[ctrl].length)
      return;
    this.fCtrlLabel[ctrl].forEach((ctrl2) => {
      const { path } = ctrl2;
      this.setParamValue(path, remap(value, 0, 127, ctrl2.min, ctrl2.max));
    });
  }
  pitchWheel(channel, wheel) {
    this.fPitchwheelLabel.forEach((pw) => {
      this.setParamValue(pw.path, remap(wheel, 0, 16383, pw.min, pw.max));
    });
  }
  compute(inputs = []) {
    if (!this.factory)
      return this.output;
    for (let i = 0; i < this.numIn; i++) {
      this.dspInChannnels[i].fill(0);
      if (inputs[i])
        this.dspInChannnels[i].set(inputs[i]);
    }
    if (this.voices) {
      this.mixer.clearOutput(this.bufferSize, this.numOut, this.$outs);
      for (let i = 0; i < this.voices; i++) {
        this.factory.compute(this.dspVoices$[i], this.bufferSize, this.$ins, this.$mixing);
        this.mixer.mixVoice(this.bufferSize, this.numOut, this.$mixing, this.$outs);
      }
      if (this.effect)
        this.effect.compute(this.$effect, this.bufferSize, this.$outs, this.$outs);
    } else {
      this.factory.compute(this.$dsp, this.bufferSize, this.$ins, this.$outs);
    }
    if (this.output !== void 0) {
      for (let i = 0; i < this.numOut; i++) {
        this.output[i].set(this.dspOutChannnels[i]);
      }
    }
    this.$sample += this.bufferSize;
    return this.output;
  }
  generate(inputs = [], length = this.bufferSize, onUpdate) {
    let l = 0;
    const outputs = new Array(this.numOut).fill(null).map(() => new Float32Array(length));
    while (l < length) {
      const sliceLength = Math.min(length - l, this.bufferSize);
      const inputsCompute = [];
      for (let i = 0; i < this.numIn; i++) {
        let input;
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
};
var FaustProcessor_default = FaustProcessor;

// src/fetchModule.ts
var global2 = globalThis;
var cache = global2.fetchModuleCache || new Map();
var fetchModule = async (url) => {
  const absoluteUrl = new URL(url, location.href).href;
  if (cache.has(absoluteUrl))
    return cache.get(absoluteUrl);
  let exported;
  const toExport = {};
  global2.exports = toExport;
  global2.module = { exports: toExport };
  const esm = await import(
    /* webpackIgnore: true */
    absoluteUrl
  );
  const esmKeys = Object.keys(esm);
  if (esmKeys.length)
    exported = esm;
  else
    exported = global2.module.exports;
  delete global2.exports;
  delete global2.module;
  cache.set(absoluteUrl, exported);
  return exported;
};
if (!global2.fetchModuleCache)
  global2.fetchModuleCache = cache;
var fetchModule_default = fetchModule;

// src/instantiateLibFaust.ts
var instantiateLibFaust = async (jsFile, dataFile = jsFile.replace(/c?js$/, "data"), wasmFile = jsFile.replace(/c?js$/, "wasm")) => {
  let LibFaust;
  try {
    LibFaust = __require(jsFile);
  } catch (error) {
    LibFaust = await fetchModule_default(jsFile);
  }
  const locateFile = (url, scriptDirectory) => ({
    "libfaust-wasm.wasm": wasmFile,
    "libfaust-wasm.data": dataFile
  })[url] || scriptDirectory + url;
  const libFaust = await LibFaust({ locateFile });
  return libFaust;
};
var instantiateLibFaust_default = instantiateLibFaust;

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
      float,
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

// src/index.ts
var src_default = {
  Faust: Faust_default,
  instantiateLibFaust: instantiateLibFaust_default,
  FaustProcessor: FaustProcessor_default,
  WavEncoder: WavEncoder_default,
  WavDecoder: WavDecoder_default
};
export {
  Faust_default as Faust,
  FaustProcessor_default as FaustProcessor,
  WavDecoder_default as WavDecoder,
  WavEncoder_default as WavEncoder,
  src_default as default,
  instantiateLibFaust_default as instantiateLibFaust
};
/**
 * [js-sha256]{@link https://github.com/emn178/js-sha256}
 *
 * @version 0.9.0
 * @author Chen, Yi-Cyuan [emn178@gmail.com]
 * @copyright Chen, Yi-Cyuan 2014-2017
 * @license MIT
 */
//# sourceMappingURL=index.js.map
