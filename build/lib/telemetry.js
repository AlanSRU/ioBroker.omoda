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
var telemetry_exports = {};
__export(telemetry_exports, {
  MqttTelemetry: () => MqttTelemetry
});
module.exports = __toCommonJS(telemetry_exports);
var import_node_crypto = require("node:crypto");
var import_mqtt = __toESM(require("mqtt"));
var import_constants = require("./constants");
var import_util = require("./util");
const CMD_CONFIRM_META = /* @__PURE__ */ new Set(["result", "resultTime", "seq", "reason", "hasAsy"]);
function isObj(v) {
  return !!v && typeof v === "object" && !Array.isArray(v);
}
class MqttTelemetry {
  constructor(opts, log, handlers) {
    this.opts = opts;
    this.log = log;
    this.handlers = handlers;
    this.awakeWindowMs = opts.awakeWindowSec * 1e3;
  }
  client = null;
  lastMsgTs = 0;
  awakeWindowMs;
  connect() {
    const { host, port, channelId, tuserId, certs } = this.opts;
    const password = (0, import_node_crypto.createHash)("md5").update(`${tuserId}${import_constants.CAR_SEED}`).digest("hex");
    const clientId = `app_${channelId}_${tuserId}`;
    const topic = `app/${channelId}/${tuserId}/account/msgCenter/msg`;
    const client = import_mqtt.default.connect(`mqtts://${host}:${port}`, {
      clientId,
      username: tuserId,
      password,
      protocolVersion: 4,
      // MQTT 3.1.1
      clean: false,
      keepalive: 60,
      reconnectPeriod: 1e4,
      connectTimeout: 3e4,
      ca: certs.ca,
      cert: certs.cert,
      key: certs.key,
      // Validate the chain against the pinned CA, but skip hostname verification —
      // the broker cert CN does not match the host (coordinator tls_insecure_set).
      // checkServerIdentity is a pass-through TLS option not in mqtt's typings.
      rejectUnauthorized: true,
      checkServerIdentity: () => void 0
    });
    client.on("connect", () => {
      this.log.info(`[${tuserId}] car MQTT connected \u2192 subscribing ${topic}`);
      this.handlers.onConnected(true);
      client.subscribe(topic, { qos: 1 }, (err) => {
        if (err) {
          this.log.warn(`car MQTT subscribe failed: ${err.message}`);
        }
      });
    });
    client.on("reconnect", () => this.log.debug("car MQTT reconnecting\u2026"));
    client.on("close", () => this.handlers.onConnected(false));
    client.on("error", (err) => this.log.warn(`car MQTT error: ${err.message}`));
    client.on("message", (_t, payload) => this.onMessage(payload));
    this.client = client;
  }
  onMessage(payload) {
    let obj;
    try {
      obj = JSON.parse(payload.toString("utf-8"));
    } catch (err) {
      this.log.debug(`undecodable MQTT payload: ${err.message}`);
      return;
    }
    const content = isObj(obj) && isObj(obj.content) ? obj.content : isObj(obj) ? obj : {};
    const data = isObj(content.data) ? content.data : {};
    const svc = content.serviceType != null ? (0, import_util.str)(content.serviceType) : "";
    const now = Date.now();
    const wasAwake = this.lastMsgTs > 0 && now - this.lastMsgTs < this.awakeWindowMs;
    this.lastMsgTs = now;
    if (svc === "1301" && "lat" in data && "lon" in data) {
      this.handlers.onGeo(data);
    }
    const isConfirmation = "result" in data || "seq" in data;
    const fields = {};
    for (const [k, v] of Object.entries(data)) {
      if (k !== "time" && !CMD_CONFIRM_META.has(k)) {
        fields[k] = (0, import_util.str)(v);
      }
    }
    if (Object.keys(fields).length) {
      this.handlers.onFields(fields);
    }
    if (isConfirmation) {
      this.handlers.onConfirmation(data);
    }
    if (!wasAwake) {
      this.handlers.onWake();
    }
  }
  /** Graceful shutdown (force=false lets in-flight publishes drain). */
  async close() {
    const c = this.client;
    this.client = null;
    if (!c) {
      return;
    }
    await new Promise((resolve) => {
      c.end(false, {}, () => resolve());
    });
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  MqttTelemetry
});
//# sourceMappingURL=telemetry.js.map
