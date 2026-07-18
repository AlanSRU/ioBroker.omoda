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
var constants_exports = {};
__export(constants_exports, {
  APP_BASIC: () => APP_BASIC,
  APP_VERSION: () => APP_VERSION,
  APP_VERSION_CODE: () => APP_VERSION_CODE,
  CAR_SEED: () => CAR_SEED,
  CODE_MEANING: () => CODE_MEANING,
  EP: () => EP,
  FAILURE_CODES: () => FAILURE_CODES,
  MARKETING_NONCE: () => MARKETING_NONCE,
  MARKETING_SECRET: () => MARKETING_SECRET,
  REGION_EU: () => REGION_EU,
  RETRYABLE_CODES: () => RETRYABLE_CODES,
  SIGN_NONCE: () => SIGN_NONCE,
  SIGN_SECRET: () => SIGN_SECRET,
  SIGN_SECRET_TEST: () => SIGN_SECRET_TEST,
  SM4_KEY: () => SM4_KEY,
  SUCCESS_CODES: () => SUCCESS_CODES,
  TIMING: () => TIMING,
  TSP_APP_ID: () => TSP_APP_ID,
  TSP_APP_SECRET: () => TSP_APP_SECRET,
  codeMeaning: () => codeMeaning
});
module.exports = __toCommonJS(constants_exports);
const APP_BASIC = "Basic bGVnZW5kQXBwOmxlZ2VuZEFwcA==";
const APP_VERSION = "1.1.9";
const APP_VERSION_CODE = "26060602";
const SIGN_NONCE = "chery_legend_h5";
const SIGN_SECRET = "cX5fR8lJ6pK2xD4uH1eK4pY6wA4xO0sK";
const SIGN_SECRET_TEST = "eQ9fQ9zM9yI7bZ1uY9wR2dQ1pJ6xU0zT";
const SM4_KEY = Buffer.from("mHU80av2zFtf4OY6", "utf-8");
const MARKETING_SECRET = "5c7af05e6fbf562842ef483ee96e06a0";
const MARKETING_NONCE = "chery_legend_marketing";
const TSP_APP_ID = "eu-1";
const TSP_APP_SECRET = "EBUJPYr7oDd48C9Te9c755942Y7T48dV293Y4Z931J098X41aYf0";
const CAR_SEED = "fa89db3abe8045919d70c6ed3cc65bc5";
const REGION_EU = {
  bff: "https://legend-oj.omodaauto.nl/api",
  tspHost: "https://tspconsole-eu.cheryinternational.com",
  mqttHost: "tspemqx-app-eu.cheryinternational.com",
  mqttPort: 8083,
  tenant: "300006",
  channelId: "1",
  countryId: "1",
  // DEPT-ID = the account country's international dialing prefix (NOT universal!):
  // IT=39 (this default), FR=33, DE=49, UK=44, NL=31. A wrong value makes the TSP login
  // fail with code=1 "Please contact customer service for assistance". User-configurable in admin.
  deptId: "39"
};
const EP = {
  // BFF
  token: "/auth/oauth2/token",
  sendMailCode: "/marketing/v2/app/code/sendMailCode",
  sendSmsCode: "/marketing/v2/app/code/sendSmsCode",
  captchaCreate: "/code/create",
  captchaCheck: "/code/check",
  tspLogin: "/tsp/v1/app/auth/login",
  getTuserId: "/tsp/v1/app/auth/getTuserId",
  vmcList: "/tsp/v1/app/vmc/queryList",
  setVecDefault: "/tsp/v1/app/vmc/setVecDefault",
  checkPassword: "/tsp/v1/app/cpm/checkPassword",
  // TSP (tspconsole host)
  smsAwaken: "/asc/vehicleControl/smsAwaken",
  realtime: "/asr/manager/realtime",
  vehicleLocation: "/asc/vehicleControl/queryVehicleLocation",
  vehicleControl: "/asc/vehicleControl/",
  // + endpoint
  theftQuery: "/act/theftAlarm/querySwitch"
};
const TIMING = {
  sessionEverySec: 900,
  awakeWindowSec: 300,
  pollNormalMin: 60,
  pollChargingMin: 30,
  pollWakeWaitSec: 25,
  hvOnPollEverySec: 60,
  hvOnPollMax: 90,
  chargingPollEverySec: 120,
  chargingPollMax: 300,
  driveWatchEverySec: 180,
  macroWakeWaitSec: 35,
  macroPresetSec: 15 * 60 + 60,
  commandSettleSec: 5,
  commandQueueWaitSec: 30,
  wakeCooldownSec: 300
};
const CODE_MEANING = {
  "000000": "ok \u2705",
  A00079: "command accepted \u2705",
  A00082: "car busy \u23F3 (another command is in progress) \u2014 retry in a few seconds",
  A00084: "command not allowed on this car \u{1F6AB} (permission denied for this function)",
  A00089: "invalid taskId \u274C (requires a taskId authenticated by checkPassword)",
  A00546: "invalid taskId \u274C (incorrect scene in checkPassword)",
  A00567: "incomplete checkPassword parameters \u274C",
  A00000: "token expired/invalid \u274C (please redo OTP login)",
  A07312: "wake rate-limit \u{1F6AB} (car is refusing further wake requests right now, try again later)",
  A07900: "car asleep / unreachable (or signature/car_token invalid) \u231B"
};
const SUCCESS_CODES = /* @__PURE__ */ new Set(["000000", "A00079"]);
const FAILURE_CODES = /* @__PURE__ */ new Set(["A00082", "A00084", "A00089", "A00546", "A00567", "A00000", "A07312", "A07900"]);
const RETRYABLE_CODES = /* @__PURE__ */ new Set(["A00082"]);
function codeMeaning(code, fallback) {
  var _a, _b;
  if (code == null) {
    return fallback != null ? fallback : "no code";
  }
  const key = String(code);
  return (_b = (_a = CODE_MEANING[key]) != null ? _a : fallback) != null ? _b : `code ${key}`;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  APP_BASIC,
  APP_VERSION,
  APP_VERSION_CODE,
  CAR_SEED,
  CODE_MEANING,
  EP,
  FAILURE_CODES,
  MARKETING_NONCE,
  MARKETING_SECRET,
  REGION_EU,
  RETRYABLE_CODES,
  SIGN_NONCE,
  SIGN_SECRET,
  SIGN_SECRET_TEST,
  SM4_KEY,
  SUCCESS_CODES,
  TIMING,
  TSP_APP_ID,
  TSP_APP_SECRET,
  codeMeaning
});
//# sourceMappingURL=constants.js.map
