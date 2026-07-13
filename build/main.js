"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
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
var utils = __toESM(require("@iobroker/adapter-core"));
var path = __toESM(require("node:path"));
var import_node_fs = require("node:fs");
var import_constants = require("./lib/constants");
var import_client = require("./lib/client");
var import_tokenStore = require("./lib/tokenStore");
var import_controller = require("./lib/controller");
var import_captcha = require("./lib/captcha");
var import_certs = require("./lib/certs");
var import_objects = require("./lib/objects");
var import_util = require("./lib/util");
class Omoda extends utils.Adapter {
  client;
  tokens;
  runtimeCfg;
  controllers = /* @__PURE__ */ new Map();
  starting = false;
  constructor(options = {}) {
    super({ ...options, name: "omoda" });
    this.on("ready", this.onReady.bind(this));
    this.on("stateChange", this.onStateChange.bind(this));
    this.on("message", this.onMessage.bind(this));
    this.on("unload", this.onUnload.bind(this));
  }
  buildConfig() {
    const c = this.config;
    return {
      bff: c.bff,
      tspHost: c.tspHost,
      mqttHost: c.mqttHost,
      mqttPort: Number(c.mqttPort) || 8083,
      tenant: c.tenant,
      channelId: c.channelId,
      countryId: c.countryId,
      deptId: c.deptId,
      language: c.language || "en-GB",
      email: (c.email || "").trim(),
      pin: c.pin || "",
      appVersion: import_constants.APP_VERSION,
      // Clamp in code (jsonConfig min/max is not sufficient). 0 = off for the polls;
      // caps keep every derived setTimeout/Interval well under 2^31 ms.
      pollNormalMin: c.pollNormalMin ? (0, import_util.clamp)(Number(c.pollNormalMin), 5, 10080, 60) : 0,
      sessionEverySec: (0, import_util.clamp)(Number(c.sessionEverySec), 60, 86400, 900),
      wakeCooldownSec: (0, import_util.clamp)(Number(c.wakeCooldownSec), 60, 86400, 300)
    };
  }
  /** Locate the bundled region cert store (data/certs-store.json) beside the compiled code. */
  async certStorePath() {
    const candidates = [
      path.join(__dirname, "..", "data", "certs-store.json"),
      path.join(__dirname, "..", "..", "data", "certs-store.json")
    ];
    for (const p of candidates) {
      try {
        await import_node_fs.promises.access(p);
        return p;
      } catch {
      }
    }
    return candidates[0];
  }
  async loadCerts() {
    try {
      const store = await (0, import_certs.loadStore)(await this.certStorePath());
      const certs = (0, import_certs.decryptRegion)(store, this.runtimeCfg.mqttHost);
      if (!certs) {
        this.log.error(
          `No MQTT certificates bundled for region "${this.runtimeCfg.mqttHost}". Available: ${(0, import_certs.availableRegions)(store).join(", ")}`
        );
      }
      return certs;
    } catch (e) {
      this.log.error(`Failed to load cert store: ${e.message}`);
      return null;
    }
  }
  async onReady() {
    void this.setState("info.connection", false, true);
    this.runtimeCfg = this.buildConfig();
    const dataDir = utils.getAbsoluteInstanceDataDir(this);
    this.tokens = new import_tokenStore.TokenStore(dataDir, this.log);
    this.client = new import_client.OmodaClient(this.runtimeCfg, this.tokens, this.log);
    this.subscribeStates("*.commands.*");
    this.subscribeStates("*.climate.targetTemperature");
    await this.tokens.load();
    if (!this.tokens.hasToken()) {
      this.log.warn("No session token yet \u2014 open the adapter settings and complete the OTP login.");
      return;
    }
    await this.startVehicles();
  }
  /** Discover vehicles and start a controller per VIN. Safe to call again after OTP login. */
  async startVehicles() {
    if (this.starting) {
      return;
    }
    this.starting = true;
    try {
      const { userToken, tUserId } = await this.client.bffLogin();
      if (!userToken || !tUserId) {
        this.log.warn("Session invalid \u2014 request a new OTP code in the adapter settings.");
        return;
      }
      const certs = await this.loadCerts();
      if (!certs) {
        return;
      }
      const vehicles = await this.client.discoverVehicles();
      if (!vehicles.length) {
        this.log.warn("No vehicles found on this account (queryList empty).");
        return;
      }
      for (const v of vehicles) {
        await (0, import_objects.ensureObjects)(this, v);
        let ctrl = this.controllers.get(v.id);
        if (!ctrl) {
          ctrl = new import_controller.VehicleController(this, this.client, this.runtimeCfg, v, certs);
          this.controllers.set(v.id, ctrl);
        }
        ctrl.start(tUserId);
        void this.setState(`${v.id}.info.sessionStatus`, { val: "Session active", ack: true });
      }
      void this.setState("info.connection", true, true);
      this.log.info(`Started ${vehicles.length} vehicle(s): ${vehicles.map((v) => v.vin).join(", ")}`);
    } catch (e) {
      this.log.error(`Startup failed: ${e.message}`);
    } finally {
      this.starting = false;
    }
  }
  /**
   * Split a full state id into { vin, rel } within this namespace.
   *
   * @param id
   */
  splitId(id) {
    const local = id.startsWith(`${this.namespace}.`) ? id.slice(this.namespace.length + 1) : id;
    const dot = local.indexOf(".");
    if (dot < 0) {
      return null;
    }
    return { vehicleId: local.slice(0, dot), rel: local.slice(dot + 1) };
  }
  onStateChange(id, state) {
    if (!state || state.ack) {
      return;
    }
    const parts = this.splitId(id);
    if (!parts) {
      return;
    }
    const ctrl = this.controllers.get(parts.vehicleId);
    if (!ctrl) {
      return;
    }
    void this.dispatchCommand(ctrl, id, parts.rel, state);
  }
  async dispatchCommand(ctrl, id, rel, state) {
    try {
      let result = null;
      switch (rel) {
        case "commands.lock":
          result = await ctrl.lock(Boolean(state.val));
          void this.setState(id, { val: Boolean(state.val), ack: true });
          break;
        case "commands.climateOn": {
          const t = await this.getStateAsync(`${ctrl.id}.climate.targetTemperature`);
          const temp = typeof (t == null ? void 0 : t.val) === "number" ? t.val : void 0;
          result = await ctrl.climate(Boolean(state.val), temp);
          void this.setState(id, { val: Boolean(state.val), ack: true });
          break;
        }
        case "commands.locate":
          if (state.val) {
            result = await ctrl.locate();
          }
          void this.setState(id, { val: false, ack: true });
          break;
        case "commands.refreshStatus":
          if (state.val) {
            await ctrl.wakeAndProbe();
            result = "Full status refreshed";
          }
          void this.setState(id, { val: false, ack: true });
          break;
        case "climate.targetTemperature":
          void this.setState(id, { val: state.val, ack: true });
          return;
        default:
          return;
      }
      if (result) {
        ctrl.reportCommandResult(result);
        this.log.info(result);
      }
    } catch (e) {
      const msg = e.message;
      ctrl.reportCommandResult(msg);
      if (ctrl.isCommandError(e) && e.reason === "reauth") {
        this.log.warn(`${msg} (request a new OTP in the adapter settings)`);
      } else {
        this.log.warn(`Command failed: ${msg}`);
      }
    }
  }
  onMessage(obj) {
    if (typeof obj !== "object" || !obj.command) {
      return;
    }
    void this.handleMessage(obj);
  }
  async handleMessage(obj) {
    var _a;
    const reply = (payload) => {
      if (obj.callback) {
        this.sendTo(obj.from, obj.command, payload, obj.callback);
      }
    };
    const msg = (_a = obj.message) != null ? _a : {};
    try {
      switch (obj.command) {
        case "requestOtp": {
          if (!this.client) {
            this.runtimeCfg = this.buildConfig();
            this.client = new import_client.OmodaClient(
              this.runtimeCfg,
              new import_tokenStore.TokenStore(utils.getAbsoluteInstanceDataDir(this), this.log),
              this.log
            );
          }
          const email = ((0, import_util.str)(msg.email) || this.runtimeCfg.email).trim();
          if (!email) {
            return reply({ error: "Enter your account email first." });
          }
          const cv = await (0, import_captcha.solveCaptcha)(this.client, this.log, (ms) => this.delay(ms));
          if (!cv) {
            return reply({ error: "Captcha could not be solved \u2014 try again." });
          }
          const r = await this.client.sendMailCode(email, cv);
          return reply(
            r.ok ? { result: `OTP code sent to ${email}. Enter it below and press "Confirm OTP".` } : {
              error: r.key === "email.not.exists" ? "Email not recognised as an account." : r.msg || "Failed to send OTP."
            }
          );
        }
        case "confirmOtp": {
          const email = ((0, import_util.str)(msg.email) || this.runtimeCfg.email).trim();
          const code = (0, import_util.str)(msg.code).trim();
          if (!email || !code) {
            return reply({ error: "Email and OTP code are required." });
          }
          const r = await this.client.mintToken(email, code);
          if (!r.ok) {
            return reply({ error: r.detail || "OTP code rejected." });
          }
          void this.startVehicles();
          return reply({ result: "Login successful \u2014 vehicles are being set up." });
        }
        case "checkSession": {
          const r = await this.client.checkSession();
          return reply(r.ok ? { result: r.detail } : { error: r.detail });
        }
        default:
          return reply({ error: `Unknown command: ${obj.command}` });
      }
    } catch (e) {
      reply({ error: e.message });
    }
  }
  onUnload(callback) {
    void (async () => {
      try {
        await Promise.all([...this.controllers.values()].map((c) => c.stop()));
        this.controllers.clear();
        void this.setState("info.connection", false, true);
      } catch (e) {
        this.log.debug(`unload error: ${e.message}`);
      } finally {
        callback();
      }
    })();
  }
}
if (require.main !== module) {
  module.exports = (options) => new Omoda(options);
} else {
  (() => new Omoda())();
}
//# sourceMappingURL=main.js.map
