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
var objects_exports = {};
__export(objects_exports, {
  CHANNELS: () => CHANNELS,
  GEO_MAP: () => GEO_MAP,
  MQTT_MAP: () => MQTT_MAP,
  RT_MAP: () => RT_MAP,
  STATES: () => STATES,
  ensureObjects: () => ensureObjects
});
module.exports = __toCommonJS(objects_exports);
const CHANNELS = [
  { id: "info", name: "Vehicle information" },
  { id: "location", name: "GPS location" },
  { id: "battery", name: "Battery & range" },
  { id: "charging", name: "Charging" },
  { id: "doors", name: "Doors & locks" },
  { id: "windows", name: "Windows & sunroof" },
  { id: "climate", name: "Climate" },
  { id: "status", name: "Vehicle status" },
  { id: "tyres", name: "Tyre pressures & temperatures" },
  { id: "commands", name: "Commands" }
];
const ro = (extra = {}) => ({ read: true, write: false, ...extra });
const STATES = [
  // — info —
  {
    id: "info.online",
    common: { name: "Vehicle online (MQTT)", type: "boolean", role: "indicator.reachable", ...ro() }
  },
  { id: "info.name", common: { name: "Name", type: "string", role: "info.name", ...ro() } },
  { id: "info.model", common: { name: "Model", type: "string", role: "info.name", ...ro() } },
  { id: "info.brand", common: { name: "Brand", type: "string", role: "info.name", ...ro() } },
  { id: "info.powerType", common: { name: "Power type (0 = BEV)", type: "number", role: "value", ...ro() } },
  { id: "info.lastUpdate", common: { name: "Last telemetry update", type: "number", role: "value.time", ...ro() } },
  { id: "info.sessionStatus", common: { name: "Session status", type: "string", role: "text", ...ro() } },
  // — location —
  {
    id: "location.latitude",
    common: { name: "Latitude", type: "number", role: "value.gps.latitude", unit: "\xB0", ...ro() }
  },
  {
    id: "location.longitude",
    common: { name: "Longitude", type: "number", role: "value.gps.longitude", unit: "\xB0", ...ro() }
  },
  { id: "location.speed", common: { name: "Speed", type: "number", role: "value.speed", unit: "km/h", ...ro() } },
  {
    id: "location.heading",
    common: { name: "Heading", type: "number", role: "value.direction", unit: "\xB0", ...ro() }
  },
  {
    id: "location.positionTime",
    common: { name: "Position timestamp", type: "number", role: "value.time", ...ro() }
  },
  // — battery / range —
  {
    id: "battery.soc",
    common: { name: "Battery charge", type: "number", role: "value.battery", unit: "%", ...ro() }
  },
  {
    id: "battery.rangeElectric",
    common: { name: "Electric range", type: "number", role: "value.distance", unit: "km", ...ro() }
  },
  {
    id: "battery.rangeTotal",
    common: { name: "Total range", type: "number", role: "value.distance", unit: "km", ...ro() }
  },
  // — charging —
  {
    id: "charging.plugConnected",
    common: { name: "Charge plug connected", type: "boolean", role: "indicator", ...ro() }
  },
  { id: "charging.state", common: { name: "Charge state", type: "string", role: "text", ...ro() } },
  {
    id: "charging.power",
    common: { name: "Charging power", type: "number", role: "value.power", unit: "kW", ...ro() }
  },
  {
    id: "charging.remainingTime",
    common: { name: "Charge remaining time", type: "number", role: "value", unit: "min", ...ro() }
  },
  // — doors & locks —
  { id: "doors.frontLeft", common: { name: "Door front left open", type: "boolean", role: "sensor.door", ...ro() } },
  {
    id: "doors.frontRight",
    common: { name: "Door front right open", type: "boolean", role: "sensor.door", ...ro() }
  },
  { id: "doors.rearLeft", common: { name: "Door rear left open", type: "boolean", role: "sensor.door", ...ro() } },
  { id: "doors.rearRight", common: { name: "Door rear right open", type: "boolean", role: "sensor.door", ...ro() } },
  { id: "doors.trunk", common: { name: "Trunk open", type: "boolean", role: "sensor.door", ...ro() } },
  { id: "doors.hood", common: { name: "Hood open", type: "boolean", role: "sensor.door", ...ro() } },
  { id: "doors.locked", common: { name: "Doors locked", type: "boolean", role: "indicator", ...ro() } },
  // — windows & sunroof —
  {
    id: "windows.frontLeft",
    common: { name: "Window front left open", type: "boolean", role: "sensor.window", ...ro() }
  },
  {
    id: "windows.frontRight",
    common: { name: "Window front right open", type: "boolean", role: "sensor.window", ...ro() }
  },
  {
    id: "windows.rearLeft",
    common: { name: "Window rear left open", type: "boolean", role: "sensor.window", ...ro() }
  },
  {
    id: "windows.rearRight",
    common: { name: "Window rear right open", type: "boolean", role: "sensor.window", ...ro() }
  },
  { id: "windows.sunroof", common: { name: "Sunroof open", type: "boolean", role: "sensor.window", ...ro() } },
  // — climate —
  { id: "climate.running", common: { name: "Climate running", type: "boolean", role: "indicator", ...ro() } },
  {
    id: "climate.minTemp",
    common: { name: "Climate min temperature", type: "number", role: "value.temperature", unit: "\xB0C", ...ro() }
  },
  {
    id: "climate.maxTemp",
    common: { name: "Climate max temperature", type: "number", role: "value.temperature", unit: "\xB0C", ...ro() }
  },
  // — status —
  { id: "status.engine", common: { name: "Engine on", type: "boolean", role: "indicator", ...ro() } },
  {
    id: "status.odometer",
    common: { name: "Odometer", type: "number", role: "value.distance", unit: "km", ...ro() }
  },
  // — tyres —
  {
    id: "tyres.frontLeftPressure",
    common: { name: "Tyre front left pressure", type: "number", role: "value.pressure", unit: "kPa", ...ro() }
  },
  {
    id: "tyres.frontRightPressure",
    common: { name: "Tyre front right pressure", type: "number", role: "value.pressure", unit: "kPa", ...ro() }
  },
  {
    id: "tyres.rearLeftPressure",
    common: { name: "Tyre rear left pressure", type: "number", role: "value.pressure", unit: "kPa", ...ro() }
  },
  {
    id: "tyres.rearRightPressure",
    common: { name: "Tyre rear right pressure", type: "number", role: "value.pressure", unit: "kPa", ...ro() }
  },
  {
    id: "tyres.frontLeftTemp",
    common: { name: "Tyre front left temperature", type: "number", role: "value.temperature", unit: "\xB0C", ...ro() }
  },
  {
    id: "tyres.frontRightTemp",
    common: {
      name: "Tyre front right temperature",
      type: "number",
      role: "value.temperature",
      unit: "\xB0C",
      ...ro()
    }
  },
  {
    id: "tyres.rearLeftTemp",
    common: { name: "Tyre rear left temperature", type: "number", role: "value.temperature", unit: "\xB0C", ...ro() }
  },
  {
    id: "tyres.rearRightTemp",
    common: { name: "Tyre rear right temperature", type: "number", role: "value.temperature", unit: "\xB0C", ...ro() }
  },
  // — commands (writable, MVP) —
  {
    id: "climate.targetTemperature",
    common: {
      name: "Climate target temperature",
      type: "number",
      role: "level.temperature",
      unit: "\xB0C",
      read: true,
      write: true,
      min: 15,
      max: 32,
      step: 0.5,
      def: 21
    }
  },
  {
    id: "commands.lock",
    common: {
      name: "Lock (true) / unlock (false)",
      type: "boolean",
      role: "switch.lock",
      read: true,
      write: true,
      def: false
    }
  },
  {
    id: "commands.climateOn",
    common: { name: "Climate on/off", type: "boolean", role: "switch", read: true, write: true, def: false }
  },
  {
    id: "commands.locate",
    common: { name: "Request GPS location", type: "boolean", role: "button", read: false, write: true }
  },
  {
    id: "commands.refreshStatus",
    common: { name: "Wake & refresh full status", type: "boolean", role: "button", read: false, write: true }
  },
  { id: "commands.result", common: { name: "Last command result", type: "string", role: "text", ...ro() } }
];
const boolNonZero = (v) => {
  const n = Number(v);
  return Number.isNaN(n) ? void 0 : n !== 0;
};
const num = (v) => {
  const n = Number(v);
  return Number.isNaN(n) ? void 0 : n;
};
const MQTT_MAP = {
  frontLeftDoor: { id: "doors.frontLeft", conv: boolNonZero },
  frontRightDoor: { id: "doors.frontRight", conv: boolNonZero },
  backLeftDoor: { id: "doors.rearLeft", conv: boolNonZero },
  backRightDoor: { id: "doors.rearRight", conv: boolNonZero },
  trunkDoor: { id: "doors.trunk", conv: boolNonZero },
  hood: { id: "doors.hood", conv: boolNonZero },
  // doorLock: 0 = Locked, 1 = Unlocked (HA "lock" kind) → locked = (val == 0)
  doorLock: { id: "doors.locked", conv: (v) => v == null ? void 0 : Number(v) === 0 },
  frontLeftWindowState: { id: "windows.frontLeft", conv: boolNonZero },
  frontRightWindowState: { id: "windows.frontRight", conv: boolNonZero },
  backLeftWindowState: { id: "windows.rearLeft", conv: boolNonZero },
  backRightWindowState: { id: "windows.rearRight", conv: boolNonZero },
  sunroofState: { id: "windows.sunroof", conv: boolNonZero },
  frontHVACState: { id: "climate.running", conv: boolNonZero },
  engineState: { id: "status.engine", conv: boolNonZero },
  chargeGunState: { id: "charging.plugConnected", conv: boolNonZero }
};
const CHARGE_STATE_MAP = { 0: "Not charging", 1: "Charging", 2: "Charging completed" };
const RT_MAP = {
  dumpEnergy: { id: "battery.soc", conv: (v) => num(v) > 0 ? num(v) : void 0 },
  pureElectricRange: { id: "battery.rangeElectric", conv: num },
  dynamicPureElectricRange: { id: "battery.rangeElectric", conv: num },
  odometer: { id: "status.odometer", conv: num },
  vehicleSpeed: { id: "location.speed", conv: num },
  chargeState: { id: "charging.state", conv: (v) => {
    var _a;
    return (_a = CHARGE_STATE_MAP[String(v)]) != null ? _a : String(v);
  } },
  chargingPower: { id: "charging.power", conv: num },
  remainChargeTime: { id: "charging.remainingTime", conv: num },
  lFrontTyreKpa: { id: "tyres.frontLeftPressure", conv: num },
  rFrontTyreKpa: { id: "tyres.frontRightPressure", conv: num },
  lRearTyreKpa: { id: "tyres.rearLeftPressure", conv: num },
  rRearTyreKpa: { id: "tyres.rearRightPressure", conv: num },
  lFrontTyreTemp: { id: "tyres.frontLeftTemp", conv: num },
  rFrontTyreTemp: { id: "tyres.frontRightTemp", conv: num },
  lRearTyreTemp: { id: "tyres.rearLeftTemp", conv: num },
  rRearTyreTemp: { id: "tyres.rearRightTemp", conv: num }
};
const GEO_MAP = {
  lat: { id: "location.latitude", conv: num },
  latitude: { id: "location.latitude", conv: num },
  lon: { id: "location.longitude", conv: num },
  longitude: { id: "location.longitude", conv: num },
  speed: { id: "location.speed", conv: num },
  vehicleSpeed: { id: "location.speed", conv: num },
  direction: { id: "location.heading", conv: num },
  heading: { id: "location.heading", conv: num }
};
async function ensureObjects(adapter, vehicle) {
  var _a;
  const vin = vehicle.id;
  await adapter.setObjectNotExistsAsync(vin, {
    type: "device",
    common: { name: vehicle.name || vehicle.model || `Omoda ${vin}` },
    native: { vin: vehicle.vin }
  });
  for (const ch of CHANNELS) {
    await adapter.setObjectNotExistsAsync(`${vin}.${ch.id}`, {
      type: "channel",
      common: { name: ch.name },
      native: {}
    });
  }
  for (const st of STATES) {
    const t = st.common.type;
    const def = (_a = st.common.def) != null ? _a : t === "boolean" ? false : t === "number" ? 0 : t === "string" ? "" : null;
    await adapter.setObjectNotExistsAsync(`${vin}.${st.id}`, {
      type: "state",
      common: { ...st.common, def },
      native: {}
    });
  }
  if (vehicle.climateMinTemp != null || vehicle.climateMaxTemp != null) {
    const patch = {};
    if (vehicle.climateMinTemp != null) {
      patch.min = vehicle.climateMinTemp;
    }
    if (vehicle.climateMaxTemp != null) {
      patch.max = vehicle.climateMaxTemp;
    }
    if (vehicle.climateTempStep != null) {
      patch.step = vehicle.climateTempStep;
    }
    await adapter.extendObjectAsync(`${vin}.climate.targetTemperature`, {
      common: patch
    });
    if (vehicle.climateMinTemp != null) {
      void adapter.setState(`${vin}.climate.minTemp`, { val: vehicle.climateMinTemp, ack: true });
    }
    if (vehicle.climateMaxTemp != null) {
      void adapter.setState(`${vin}.climate.maxTemp`, { val: vehicle.climateMaxTemp, ack: true });
    }
  }
  if (vehicle.name) {
    void adapter.setState(`${vin}.info.name`, { val: vehicle.name, ack: true });
  }
  if (vehicle.model) {
    void adapter.setState(`${vin}.info.model`, { val: vehicle.model, ack: true });
  }
  if (vehicle.brand) {
    void adapter.setState(`${vin}.info.brand`, { val: vehicle.brand, ack: true });
  }
  if (vehicle.powerType != null) {
    void adapter.setState(`${vin}.info.powerType`, { val: vehicle.powerType, ack: true });
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  CHANNELS,
  GEO_MAP,
  MQTT_MAP,
  RT_MAP,
  STATES,
  ensureObjects
});
//# sourceMappingURL=objects.js.map
