"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
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
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var sm4_exports = {};
__export(sm4_exports, {
  sm4Code: () => sm4Code,
  sm4EcbEncryptPkcs7: () => sm4EcbEncryptPkcs7,
  sm4EncryptBlock: () => sm4EncryptBlock
});
module.exports = __toCommonJS(sm4_exports);
var import_constants = require("../constants");
const SBOX = Uint8Array.from([
  214,
  144,
  233,
  254,
  204,
  225,
  61,
  183,
  22,
  182,
  20,
  194,
  40,
  251,
  44,
  5,
  43,
  103,
  154,
  118,
  42,
  190,
  4,
  195,
  170,
  68,
  19,
  38,
  73,
  134,
  6,
  153,
  156,
  66,
  80,
  244,
  145,
  239,
  152,
  122,
  51,
  84,
  11,
  67,
  237,
  207,
  172,
  98,
  228,
  179,
  28,
  169,
  201,
  8,
  232,
  149,
  128,
  223,
  148,
  250,
  117,
  143,
  63,
  166,
  71,
  7,
  167,
  252,
  243,
  115,
  23,
  186,
  131,
  89,
  60,
  25,
  230,
  133,
  79,
  168,
  104,
  107,
  129,
  178,
  113,
  100,
  218,
  139,
  248,
  235,
  15,
  75,
  112,
  86,
  157,
  53,
  30,
  36,
  14,
  94,
  99,
  88,
  209,
  162,
  37,
  34,
  124,
  59,
  1,
  33,
  120,
  135,
  212,
  0,
  70,
  87,
  159,
  211,
  39,
  82,
  76,
  54,
  2,
  231,
  160,
  196,
  200,
  158,
  234,
  191,
  138,
  210,
  64,
  199,
  56,
  181,
  163,
  247,
  242,
  206,
  249,
  97,
  21,
  161,
  224,
  174,
  93,
  164,
  155,
  52,
  26,
  85,
  173,
  147,
  50,
  48,
  245,
  140,
  177,
  227,
  29,
  246,
  226,
  46,
  130,
  102,
  202,
  96,
  192,
  41,
  35,
  171,
  13,
  83,
  78,
  111,
  213,
  219,
  55,
  69,
  222,
  253,
  142,
  47,
  3,
  255,
  106,
  114,
  109,
  108,
  91,
  81,
  141,
  27,
  175,
  146,
  187,
  221,
  188,
  127,
  17,
  217,
  92,
  65,
  31,
  16,
  90,
  216,
  10,
  193,
  49,
  136,
  165,
  205,
  123,
  189,
  45,
  116,
  208,
  18,
  184,
  229,
  180,
  176,
  137,
  105,
  151,
  74,
  12,
  150,
  119,
  126,
  101,
  185,
  241,
  9,
  197,
  110,
  198,
  132,
  24,
  240,
  125,
  236,
  58,
  220,
  77,
  32,
  121,
  238,
  95,
  62,
  215,
  203,
  57,
  72
]);
const FK = [2746333894, 1453994832, 1736282519, 2993693404];
const CK = [
  462357,
  472066609,
  943670861,
  1415275113,
  1886879365,
  2358483617,
  2830087869,
  3301692121,
  3773296373,
  4228057617,
  404694573,
  876298825,
  1347903077,
  1819507329,
  2291111581,
  2762715833,
  3234320085,
  3705924337,
  4177462797,
  337322537,
  808926789,
  1280531041,
  1752135293,
  2223739545,
  2695343797,
  3166948049,
  3638552301,
  4110090761,
  269950501,
  741554753,
  1213159005,
  1684763257
];
function rotl(x, n) {
  return (x << n | x >>> 32 - n) >>> 0;
}
function tau(a) {
  return (SBOX[a >>> 24 & 255] << 24 | SBOX[a >>> 16 & 255] << 16 | SBOX[a >>> 8 & 255] << 8 | SBOX[a & 255]) >>> 0;
}
function transformL(b) {
  return (b ^ rotl(b, 2) ^ rotl(b, 10) ^ rotl(b, 18) ^ rotl(b, 24)) >>> 0;
}
function transformLp(b) {
  return (b ^ rotl(b, 13) ^ rotl(b, 23)) >>> 0;
}
function u32be(buf, off) {
  return buf.readUInt32BE(off);
}
function keySchedule(key16) {
  const K = [u32be(key16, 0) ^ FK[0], u32be(key16, 4) ^ FK[1], u32be(key16, 8) ^ FK[2], u32be(key16, 12) ^ FK[3]].map(
    (v) => v >>> 0
  );
  const rk = [];
  for (let i = 0; i < 32; i++) {
    const t = (K[1] ^ K[2] ^ K[3] ^ CK[i]) >>> 0;
    const b = transformLp(tau(t));
    const next = (K[0] ^ b) >>> 0;
    K[0] = K[1];
    K[1] = K[2];
    K[2] = K[3];
    K[3] = next;
    rk.push(next);
  }
  return rk;
}
function encryptBlock(rk, block) {
  const X = [u32be(block, 0), u32be(block, 4), u32be(block, 8), u32be(block, 12)];
  for (let i = 0; i < 32; i++) {
    const t = (X[1] ^ X[2] ^ X[3] ^ rk[i]) >>> 0;
    const next = (X[0] ^ transformL(tau(t))) >>> 0;
    X[0] = X[1];
    X[1] = X[2];
    X[2] = X[3];
    X[3] = next;
  }
  const out = Buffer.alloc(16);
  out.writeUInt32BE(X[3] >>> 0, 0);
  out.writeUInt32BE(X[2] >>> 0, 4);
  out.writeUInt32BE(X[1] >>> 0, 8);
  out.writeUInt32BE(X[0] >>> 0, 12);
  return out;
}
function sm4EncryptBlock(key16, block16) {
  return encryptBlock(keySchedule(key16), block16);
}
function sm4EcbEncryptPkcs7(data, key = import_constants.SM4_KEY) {
  const rk = keySchedule(key);
  const pad = 16 - data.length % 16;
  const padded = Buffer.concat([data, Buffer.alloc(pad, pad)]);
  const out = Buffer.alloc(padded.length);
  for (let i = 0; i < padded.length; i += 16) {
    encryptBlock(rk, padded.subarray(i, i + 16)).copy(out, i);
  }
  return out;
}
function sm4Code(code, transform = "plain") {
  let s = String(code);
  if (transform === "padRight32" && s.length < 32) {
    s = s.padEnd(32, " ");
  } else if (transform === "padLeft32" && s.length < 32) {
    s = s.padStart(32, " ");
  }
  return sm4EcbEncryptPkcs7(Buffer.from(s, "utf-8")).toString("base64");
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  sm4Code,
  sm4EcbEncryptPkcs7,
  sm4EncryptBlock
});
//# sourceMappingURL=sm4.js.map
