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
var controller_exports = {};
__export(controller_exports, {
  VehicleController: () => VehicleController
});
module.exports = __toCommonJS(controller_exports);
var import_constants = require("./constants");
var import_client = require("./client");
var import_telemetry = require("./telemetry");
var import_commands = require("./commands");
var import_objects = require("./objects");
var import_util = require("./util");
function toNum(v) {
  const n = Number(v);
  return Number.isNaN(n) ? void 0 : n;
}
function fieldOn(v) {
  const n = toNum(v);
  return n !== void 0 && n !== 0;
}
class VehicleController {
  constructor(adapter, client, cfg, vehicle, certs) {
    this.adapter = adapter;
    this.client = client;
    this.cfg = cfg;
    this.vehicle = vehicle;
    this.certs = certs;
    this.cmd = new import_commands.CommandRunner(
      client,
      { vin: vehicle.vin, pin: cfg.pin, channelId: cfg.channelId },
      adapter.log,
      (ms) => this.adapter.delay(ms)
    );
  }
  mqtt = null;
  cmd;
  keepaliveTimer;
  normalTimer;
  followTimer;
  followCount = 0;
  followActive = false;
  lastWakeMs = 0;
  stopped = false;
  /** Real VIN (backend/API + display). */
  get vin() {
    return this.vehicle.vin;
  }
  /** Sanitized id segment used in ioBroker object paths. */
  get id() {
    return this.vehicle.id;
  }
  /**
   * Start MQTT + initial probe + polling. `tuserId` comes from a successful bffLogin.
   *
   * @param tuserId
   */
  async start(tuserId) {
    if (this.mqtt || this.keepaliveTimer || this.normalTimer) {
      await this.stop();
    }
    this.stopped = false;
    this.mqtt = new import_telemetry.MqttTelemetry(
      {
        host: this.cfg.mqttHost,
        port: this.cfg.mqttPort,
        channelId: this.cfg.channelId,
        tuserId,
        certs: this.certs,
        awakeWindowSec: import_constants.TIMING.awakeWindowSec
      },
      this.adapter.log,
      {
        onFields: (f) => this.applyFields(f),
        onGeo: (d) => this.applyGeo(d),
        onConfirmation: (d) => this.applyConfirmation(d),
        onConnected: (c) => this.setOnline(c),
        onWake: () => void this.probe().catch(() => void 0)
      }
    );
    this.mqtt.connect();
    void this.probe().catch((e) => this.adapter.log.debug(`initial probe failed: ${e.message}`));
    this.keepaliveTimer = this.adapter.setInterval(() => {
      void this.client.refreshToken().catch(() => void 0);
    }, this.cfg.sessionEverySec * 1e3);
    const normalMs = this.cfg.pollNormalMin > 0 ? this.cfg.pollNormalMin * 60 * 1e3 : 0;
    if (normalMs > 0) {
      this.normalTimer = this.adapter.setInterval(() => {
        void this.wakeAndProbe().catch(() => void 0);
      }, normalMs);
    }
  }
  async stop() {
    var _a;
    this.stopped = true;
    for (const t of [this.keepaliveTimer, this.normalTimer, this.followTimer]) {
      if (t) {
        this.adapter.clearInterval(t);
      }
    }
    this.keepaliveTimer = this.normalTimer = this.followTimer = void 0;
    this.followActive = false;
    await ((_a = this.mqtt) == null ? void 0 : _a.close());
    this.mqtt = null;
  }
  // ── state writers ────────────────────────────────────────────────────────────
  set(id, val) {
    void this.adapter.setState(`${this.vehicle.id}.${id}`, { val, ack: true });
  }
  setOnline(connected) {
    this.set("info.online", connected);
  }
  applyFields(fields) {
    for (const [key, target] of Object.entries(import_objects.MQTT_MAP)) {
      if (key in fields) {
        const v = target.conv(fields[key]);
        if (v !== void 0) {
          this.set(target.id, v);
        }
      }
    }
    this.set("info.lastUpdate", Date.now());
    this.maybeStartFollow(fields);
  }
  applyGeo(data) {
    var _a;
    for (const [key, target] of Object.entries(import_objects.GEO_MAP)) {
      if (key in data) {
        const v = target.conv(data[key]);
        if (v !== void 0) {
          this.set(target.id, v);
        }
      }
    }
    const ptime = (_a = data.positionTime) != null ? _a : data.gpsTime;
    if (ptime !== void 0) {
      const n = toNum(ptime);
      if (n !== void 0) {
        this.set("location.positionTime", n);
      }
    }
  }
  applyRealtime(payload) {
    var _a, _b;
    for (const [key, target] of Object.entries(import_objects.RT_MAP)) {
      if (key in payload) {
        const v = target.conv(payload[key]);
        if (v !== void 0) {
          this.set(target.id, v);
        }
      }
    }
    const elec = (_a = toNum(payload.pureElectricRange)) != null ? _a : toNum(payload.dynamicPureElectricRange);
    if (elec !== void 0) {
      const fuel = (_b = toNum(payload.mileageSurplus)) != null ? _b : 0;
      this.set("battery.rangeTotal", elec + fuel);
    }
    this.set("info.lastUpdate", Date.now());
  }
  applyConfirmation(data) {
    const result = (0, import_util.str)(data.result).trim();
    const reason = Array.isArray(data.reason) && data.reason.length ? " \u2014 check failed" : "";
    this.set("commands.result", `car reported result=${result || "?"}${reason}`);
  }
  // ── REST probe / wake ────────────────────────────────────────────────────────
  /** Read realtime telemetry + GPS location (read-only, no wake). */
  async probe() {
    const { userToken } = await this.client.bffLogin();
    if (!userToken) {
      return null;
    }
    const vin = this.vehicle.vin;
    const rt = await this.client.signedTspPost(userToken, import_constants.EP.realtime, { vin });
    const rtPayload = import_client.OmodaClient.payload(rt);
    if (rtPayload) {
      this.applyRealtime(rtPayload);
    }
    const loc = await this.client.signedTspPost(userToken, import_constants.EP.vehicleLocation, { vin });
    const locPayload = import_client.OmodaClient.payload(loc);
    if (locPayload) {
      this.applyGeo(locPayload);
    }
    return rtPayload;
  }
  /** Wake the car (rate-limited smsAwaken), wait, then probe. Used by the normal poll + refresh. */
  async wakeAndProbe() {
    const now = Date.now();
    if (now - this.lastWakeMs >= this.cfg.wakeCooldownSec * 1e3) {
      const { userToken } = await this.client.bffLogin();
      if (userToken) {
        this.lastWakeMs = now;
        const r = await this.client.signedTspPost(userToken, import_constants.EP.smsAwaken, { vin: this.vehicle.vin });
        this.adapter.log.debug(`smsAwaken \u2192 ${r.code}`);
        await this.adapter.delay(import_constants.TIMING.pollWakeWaitSec * 1e3);
      }
    }
    await this.probe();
  }
  // ── driving/charging fast-follow (read-only realtime bursts) ───────────────────
  maybeStartFollow(fields) {
    var _a;
    const driving = toNum(fields.engineState) === 1 || ((_a = toNum(fields.vehicleSpeed)) != null ? _a : 0) > 0;
    const plugged = fieldOn(fields.chargeGunState);
    if ((driving || plugged) && !this.followActive) {
      this.startFollow(plugged);
    }
  }
  startFollow(charging) {
    this.followActive = true;
    this.followCount = 0;
    const everyMs = (charging ? import_constants.TIMING.chargingPollEverySec : import_constants.TIMING.hvOnPollEverySec) * 1e3;
    const cap = charging ? import_constants.TIMING.chargingPollMax : import_constants.TIMING.hvOnPollMax;
    this.adapter.log.debug(
      `starting ${charging ? "charging" : "HV"} follow (every ${everyMs / 1e3}s, cap ${cap})`
    );
    this.followTimer = this.adapter.setInterval(() => {
      void (async () => {
        this.followCount++;
        const payload = await this.probe().catch(() => null);
        const hvOn = payload ? toNum(payload.hVoltageState) === 1 : false;
        if (this.stopped || this.followCount >= cap || !hvOn) {
          this.stopFollow();
        }
      })();
    }, everyMs);
  }
  stopFollow() {
    if (this.followTimer) {
      this.adapter.clearInterval(this.followTimer);
      this.followTimer = void 0;
    }
    this.followActive = false;
  }
  // ── commands (MVP) ─────────────────────────────────────────────────────────────
  async lock(shouldLock) {
    return this.cmd.send(shouldLock ? "blocca" : "sblocca");
  }
  async climate(on, temperatureC) {
    const params = on && temperatureC != null ? { temperature: temperatureC.toFixed(1) } : void 0;
    return this.cmd.send(on ? "clima_on" : "clima_off", params);
  }
  async locate() {
    return this.cmd.send("locate_car");
  }
  /**
   * Surface a command outcome/failure to commands.result.
   *
   * @param text
   */
  reportCommandResult(text) {
    this.set("commands.result", text);
  }
  isCommandError(e) {
    return e instanceof import_commands.CommandError;
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  VehicleController
});
//# sourceMappingURL=controller.js.map
