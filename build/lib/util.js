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
var util_exports = {};
__export(util_exports, {
  clamp: () => clamp,
  sanitizeId: () => sanitizeId,
  str: () => str
});
module.exports = __toCommonJS(util_exports);
function clamp(v, min, max, fallback) {
  if (Number.isNaN(v)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, v));
}
function sanitizeId(s) {
  return s.replace(/[^a-zA-Z0-9_-]/g, "_");
}
function str(v) {
  if (v === null || v === void 0) {
    return "";
  }
  if (typeof v === "string") {
    return v;
  }
  if (typeof v === "number" || typeof v === "boolean" || typeof v === "bigint") {
    return String(v);
  }
  return "";
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  clamp,
  sanitizeId,
  str
});
//# sourceMappingURL=util.js.map
