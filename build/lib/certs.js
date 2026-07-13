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
var certs_exports = {};
__export(certs_exports, {
  availableRegions: () => availableRegions,
  decryptRegion: () => decryptRegion,
  loadStore: () => loadStore
});
module.exports = __toCommonJS(certs_exports);
var import_node_fs = require("node:fs");
let cache = null;
async function loadStore(storePath) {
  if (!cache) {
    cache = JSON.parse(await import_node_fs.promises.readFile(storePath, "utf-8"));
  }
  return cache;
}
function availableRegions(store) {
  var _a;
  return Object.keys((_a = store.regions) != null ? _a : {}).sort();
}
function xor(ctB64, ks) {
  const ct = Buffer.from(ctB64, "base64");
  if (ct.length > ks.length) {
    return null;
  }
  const out = Buffer.alloc(ct.length);
  for (let i = 0; i < ct.length; i++) {
    out[i] = ct[i] ^ ks[i];
  }
  return out;
}
function decryptRegion(store, host) {
  var _a;
  const reg = (_a = store.regions) == null ? void 0 : _a[host];
  if (!reg) {
    return null;
  }
  const ks = Buffer.from(store.ks, "base64");
  const ca = reg["ca.pem"] ? xor(reg["ca.pem"], ks) : null;
  const cert = reg["client.pem"] ? xor(reg["client.pem"], ks) : null;
  const key = reg["client.key"] ? xor(reg["client.key"], ks) : null;
  if (!ca || !cert || !key) {
    return null;
  }
  return { ca, cert, key };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  availableRegions,
  decryptRegion,
  loadStore
});
//# sourceMappingURL=certs.js.map
