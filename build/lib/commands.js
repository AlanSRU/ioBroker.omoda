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
var commands_exports = {};
__export(commands_exports, {
  COMMAND_CATALOG: () => COMMAND_CATALOG,
  CommandError: () => CommandError,
  CommandRunner: () => CommandRunner
});
module.exports = __toCommonJS(commands_exports);
var import_node_crypto = require("node:crypto");
var import_constants = require("./constants");
var import_sm4 = require("./crypto/sm4");
var import_util = require("./util");
class CommandError extends Error {
  code;
  reason;
  retryable;
  constructor(message, code = null, reason = null) {
    super(message);
    this.name = "CommandError";
    this.code = code;
    this.reason = reason;
    this.retryable = code != null && import_constants.RETRYABLE_CODES.has(code);
  }
}
const COMMAND_CATALOG = {
  // Doors / locks
  sblocca: { endpoint: "lockControl", body: { lockType: "1" }, name: "Unlock doors", group: "Access" },
  blocca: { endpoint: "lockControl", body: { lockType: "0" }, name: "Lock doors", group: "Access" },
  baule_apri: { endpoint: "powerLiftgateControl", body: { controlType: "1" }, name: "Open trunk", group: "Access" },
  baule_chiudi: {
    endpoint: "powerLiftgateControl",
    body: { controlType: "0" },
    name: "Close trunk",
    group: "Access"
  },
  // Climate
  clima_on: {
    endpoint: "airControl",
    body: { airControlType: "1", airType: "1", temperature: "21.0", times: "15" },
    name: "Climate ON",
    group: "Climate"
  },
  clima_off: {
    endpoint: "airControl",
    body: { airControlType: "0", airType: "1", temperature: "21.0", times: "15" },
    name: "Climate OFF",
    group: "Climate"
  },
  // Windows / roof
  finestrini_apri: { endpoint: "windowControl", body: { controlType: "1" }, name: "Open windows", group: "Windows" },
  finestrini_chiudi: {
    endpoint: "windowControl",
    body: { controlType: "0" },
    name: "Close windows",
    group: "Windows"
  },
  ventilate_windows: {
    endpoint: "windowControl",
    body: { controlType: "2" },
    name: "Ventilate windows",
    group: "Windows"
  },
  tetto_apri: {
    endpoint: "skylightControl",
    body: { controlType: "1", skylightType: "1" },
    name: "Open sunroof",
    group: "Windows"
  },
  tetto_chiudi: {
    endpoint: "skylightControl",
    body: { controlType: "0", skylightType: "1" },
    name: "Close sunroof",
    group: "Windows"
  },
  // EV charging
  ricarica_start: {
    endpoint: "chargeStartStopControl",
    body: { controlType: "1" },
    name: "Start charging",
    group: "Charging"
  },
  ricarica_stop: {
    endpoint: "chargeStartStopControl",
    body: { controlType: "0" },
    name: "Stop charging",
    group: "Charging"
  },
  // Other
  find_car: { endpoint: "findCar", body: {}, name: "Find car (flash)", group: "Other" },
  locate_car: { endpoint: "vehicleLocation", body: {}, name: "Locate car (GPS)", group: "Other" }
};
const NON_PIN_CODES = /* @__PURE__ */ new Set(["A00000"]);
const TASKID_TTL_MS = 600 * 1e3;
const PIN_FAIL_MAX = 2;
const PIN_FAIL_WINDOW_MS = 600 * 1e3;
const SETTLE_MS = 5 * 1e3;
class CommandRunner {
  constructor(client, cfg, log, delay) {
    this.client = client;
    this.cfg = cfg;
    this.log = log;
    this.delay = delay;
  }
  taskId = { tid: null, ts: 0 };
  pinFail = { n: 0, ts: 0 };
  queue = Promise.resolve();
  invalidateTaskId() {
    this.taskId = { tid: null, ts: 0 };
  }
  async mintTaskId(tuid) {
    var _a;
    if (!this.cfg.pin.trim()) {
      throw new CommandError("Command PIN not configured \u2014 set it in the adapter settings", null, "pin");
    }
    const now = Date.now();
    if (this.pinFail.n >= PIN_FAIL_MAX && now - this.pinFail.ts < PIN_FAIL_WINDOW_MS) {
      throw new CommandError(
        `Command PIN temporarily blocked (${this.pinFail.n} wrong attempts) \u2014 reconfigure the PIN, then retry`,
        null,
        "pin"
      );
    }
    await this.client.bffPostJson(import_constants.EP.vmcList, {});
    await this.client.bffPostJson(import_constants.EP.setVecDefault, { vin: this.cfg.vin });
    const md5pin = (0, import_node_crypto.createHash)("md5").update(this.cfg.pin, "utf-8").digest("hex");
    const password = (0, import_sm4.sm4Code)(md5pin, "padRight32");
    const j = await this.client.bffPostJson(import_constants.EP.checkPassword, {
      vin: this.cfg.vin,
      tUserId: tuid,
      channelId: this.cfg.channelId,
      password,
      needDecode: 0,
      scene: 0,
      type: 0
    });
    const data = j.data && typeof j.data === "object" ? j.data : {};
    const tid = (_a = data.taskId) != null ? _a : j.taskId;
    if (tid) {
      this.pinFail.n = 0;
      return (0, import_util.str)(tid);
    }
    const code = j.code != null ? (0, import_util.str)(j.code) : null;
    if (code && NON_PIN_CODES.has(code)) {
      throw new CommandError("Session expired \u2014 request a new OTP from the adapter settings", code, "reauth");
    }
    this.pinFail.n += 1;
    this.pinFail.ts = now;
    throw new CommandError("Wrong command PIN \u2014 reconfigure it in the adapter settings", code, "pin");
  }
  async getTaskId(tuid, allowCache) {
    if (allowCache && this.taskId.tid && Date.now() - this.taskId.ts < TASKID_TTL_MS) {
      return this.taskId.tid;
    }
    const tid = await this.mintTaskId(tuid);
    this.taskId = { tid, ts: Date.now() };
    return tid;
  }
  /**
   * Send a catalog command (serialized). `params` overrides the catalog body (e.g. temperature).
   *
   * @param cmdKey
   * @param params
   */
  async send(cmdKey, params) {
    const run = this.queue.then(
      () => this.sendInner(cmdKey, params),
      () => this.sendInner(cmdKey, params)
      // run even if a previous queued command failed
    );
    this.queue = run.then(
      () => this.delay(SETTLE_MS),
      () => this.delay(SETTLE_MS)
    );
    return run;
  }
  async sendInner(cmdKey, params) {
    var _a;
    const c = COMMAND_CATALOG[cmdKey];
    if (!c) {
      throw new CommandError(`Unknown command: ${cmdKey}`);
    }
    const { userToken, tUserId } = await this.client.bffLogin();
    if (!userToken || !tUserId) {
      throw new CommandError("Session expired \u2014 request a new OTP from the adapter settings", null, "reauth");
    }
    const path = (_a = c.path) != null ? _a : `${import_constants.EP.vehicleControl}${c.endpoint}`;
    for (const attempt of [1, 2]) {
      const taskId = await this.getTaskId(tUserId, attempt === 1);
      const ts = Date.now();
      const body = {
        ...c.body,
        ...params != null ? params : {},
        clientType: "1",
        seq: `${this.cfg.vin}-${ts}`,
        taskId,
        vin: this.cfg.vin
      };
      this.log.debug(`sending ${c.name} (attempt ${attempt})`);
      const res = await this.client.signedTspPost(userToken, path, body, "okhttp/4.9.2");
      const code = res.code;
      if ((code === "A00089" || code === "A00546") && attempt === 1) {
        this.invalidateTaskId();
        continue;
      }
      const out = `${c.name}: HTTP ${res.status} ${code != null ? code : ""} \u2014 ${(0, import_constants.codeMeaning)(code, "")}`;
      if (code && import_constants.FAILURE_CODES.has(code)) {
        const reason = code === "A00000" ? "reauth" : null;
        throw new CommandError(out, code, reason);
      }
      return out;
    }
    throw new CommandError(`${c.name}: taskId rejected twice`, "A00089", "pin");
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  COMMAND_CATALOG,
  CommandError,
  CommandRunner
});
//# sourceMappingURL=commands.js.map
