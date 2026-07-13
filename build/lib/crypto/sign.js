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
var sign_exports = {};
__export(sign_exports, {
  TSP_HALF: () => TSP_HALF,
  bffSign: () => bffSign,
  marketingSign: () => marketingSign,
  marketingSignVals: () => marketingSignVals,
  tspAuthHeaders: () => tspAuthHeaders,
  tspBuildSign: () => tspBuildSign,
  tspSignBody: () => tspSignBody
});
module.exports = __toCommonJS(sign_exports);
var import_node_crypto = require("node:crypto");
var import_constants = require("../constants");
var import_util = require("../util");
function sha256Hex(input) {
  return (0, import_node_crypto.createHash)("sha256").update(input, "utf-8").digest("hex");
}
function sha256Buf(input) {
  return (0, import_node_crypto.createHash)("sha256").update(input, "utf-8").digest();
}
function md5Hex(input) {
  return (0, import_node_crypto.createHash)("md5").update(input, "utf-8").digest("hex");
}
function bffSign(urlPath, tsMs, secret = import_constants.SIGN_SECRET, nonce = import_constants.SIGN_NONCE) {
  return sha256Hex(`${secret}${nonce}${urlPath}${tsMs}`);
}
function marketingSign(path, tsMs) {
  return md5Hex(`${import_constants.MARKETING_SECRET}${import_constants.MARKETING_NONCE}${path}${tsMs}`);
}
function marketingSignVals(path, tsMs, valsCsv) {
  return md5Hex(`${import_constants.MARKETING_SECRET}${import_constants.MARKETING_NONCE}${path}${tsMs}[${valsCsv}]`);
}
const TSP_HALF = Array.from(import_constants.TSP_APP_SECRET).filter((_, i) => i % 2 === 0).join("");
function flattenValue(v) {
  if (Array.isArray(v)) {
    let sb = "";
    for (const el of v) {
      if (el && typeof el === "object" && !Array.isArray(el)) {
        const fl = flattenObj(el);
        for (const k of Object.keys(fl).sort()) {
          const val = fl[k];
          if (val === null || val === void 0 || val === "") {
            continue;
          }
          sb += `${k}=${(0, import_util.str)(val)}&`;
        }
      } else {
        sb += (0, import_util.str)(el);
      }
    }
    if (sb.endsWith("&")) {
      sb = sb.slice(0, -1);
    }
    return sb;
  }
  return v;
}
function flattenObj(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = Array.isArray(v) ? flattenValue(v) : v;
  }
  return out;
}
function tspBuildSign(params, tsMs, half = TSP_HALF) {
  const flat = flattenObj(params);
  let base = "";
  for (const k of Object.keys(flat).sort()) {
    const v = flat[k];
    if (v === null || v === void 0 || v === "") {
      continue;
    }
    base += `${k}=${(0, import_util.str)(v)}&`;
  }
  base += `secretKey=${half}&timestamp=${tsMs}`;
  return sha256Buf(base).toString("base64").toUpperCase();
}
function tspSignBody(bodyParams, tsMs) {
  const m = { ...bodyParams, appId: import_constants.TSP_APP_ID };
  m.sign = tspBuildSign(m, tsMs);
  return m;
}
function tspAuthHeaders(userToken, tsMs, tenantId = "") {
  return {
    Authorization: userToken,
    timestamp: String(tsMs),
    "x-TenantId": tenantId || ""
  };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  TSP_HALF,
  bffSign,
  marketingSign,
  marketingSignVals,
  tspAuthHeaders,
  tspBuildSign,
  tspSignBody
});
//# sourceMappingURL=sign.js.map
