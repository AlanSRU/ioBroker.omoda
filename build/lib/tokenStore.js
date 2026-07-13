"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
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
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var tokenStore_exports = {};
__export(tokenStore_exports, {
  TokenStore: () => TokenStore
});
module.exports = __toCommonJS(tokenStore_exports);
var import_node_fs = require("node:fs");
var path = __toESM(require("node:path"));
function pick(doc, key) {
  var _a;
  if (!doc || typeof doc !== "object") {
    return void 0;
  }
  const d = doc.data && typeof doc.data === "object" ? doc.data : doc;
  const v = (_a = d[key]) != null ? _a : doc[key];
  return typeof v === "string" && v ? v : void 0;
}
class TokenStore {
  constructor(dataDir, log) {
    this.log = log;
    this.file = path.join(dataDir, "token.json");
  }
  file;
  doc = null;
  get filePath() {
    return this.file;
  }
  /** Load token.json from disk into memory. Safe to call repeatedly. */
  async load() {
    try {
      const raw = await import_node_fs.promises.readFile(this.file, "utf-8");
      this.doc = JSON.parse(raw);
    } catch {
      this.doc = null;
    }
    return this.doc;
  }
  /**
   * Atomic write (tmp + rename), owner-only perms — mirrors prova_token/refresh writes.
   *
   * @param doc
   */
  async save(doc) {
    this.doc = doc;
    const dir = path.dirname(this.file);
    await import_node_fs.promises.mkdir(dir, { recursive: true });
    const tmp = `${this.file}.tmp`;
    await import_node_fs.promises.writeFile(tmp, JSON.stringify(doc), { encoding: "utf-8", mode: 384 });
    await import_node_fs.promises.rename(tmp, this.file);
  }
  async clear() {
    this.doc = null;
    try {
      await import_node_fs.promises.unlink(this.file);
    } catch {
    }
  }
  hasToken() {
    return !!pick(this.doc, "access_token");
  }
  getAccessToken() {
    return pick(this.doc, "access_token");
  }
  getRefreshToken() {
    return pick(this.doc, "refresh_token");
  }
  /** Re-read the file and return the current access token (for the refresh double-check race). */
  async currentAccessTokenFromDisk() {
    await this.load();
    return this.getAccessToken();
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  TokenStore
});
//# sourceMappingURL=tokenStore.js.map
