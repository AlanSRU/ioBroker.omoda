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
var aes_exports = {};
__export(aes_exports, {
  aesEcbEncryptB64: () => aesEcbEncryptB64
});
module.exports = __toCommonJS(aes_exports);
var import_node_crypto = require("node:crypto");
function aesEcbEncryptB64(plaintext, key) {
  const keyBuf = Buffer.from(key, "utf-8");
  const algo = keyBuf.length === 16 ? "aes-128-ecb" : keyBuf.length === 24 ? "aes-192-ecb" : "aes-256-ecb";
  const cipher = (0, import_node_crypto.createCipheriv)(algo, keyBuf, null);
  cipher.setAutoPadding(true);
  return Buffer.concat([cipher.update(Buffer.from(plaintext, "utf-8")), cipher.final()]).toString("base64");
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  aesEcbEncryptB64
});
//# sourceMappingURL=aes.js.map
