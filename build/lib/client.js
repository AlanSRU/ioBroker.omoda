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
var client_exports = {};
__export(client_exports, {
  OmodaClient: () => OmodaClient
});
module.exports = __toCommonJS(client_exports);
var import_axios = __toESM(require("axios"));
var import_constants = require("./constants");
var import_sign = require("./crypto/sign");
var import_sm4 = require("./crypto/sm4");
var import_util = require("./util");
function isPlainObject(v) {
  return !!v && typeof v === "object" && !Array.isArray(v);
}
function deriveBrand(name) {
  return /jaecoo/i.test(name) ? "Jaecoo" : "Omoda";
}
function titleCase(s) {
  return s.replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}
class OmodaClient {
  constructor(cfg, tokens, log) {
    this.cfg = cfg;
    this.tokens = tokens;
    this.log = log;
    this.http = import_axios.default.create({
      timeout: 25e3,
      // The gateway signals failure via body, not status → never throw on status.
      validateStatus: () => true,
      // Do not transform bodies; we serialize/parse ourselves for signature fidelity.
      maxRedirects: 0
    });
  }
  http;
  refreshInFlight = null;
  // ── Header builders ──────────────────────────────────────────────────────────────
  /**
   * Full BFF header set with SHA-256 app signature (omoda_auth.headers_post).
   *
   * @param urlPath
   * @param extra
   * @param secret
   */
  headersPost(urlPath, extra, secret = import_constants.SIGN_SECRET) {
    const ts = Date.now();
    const h = {
      Accept: "application/json, text/plain, */*",
      "Content-Type": "application/x-www-form-urlencoded",
      "Accept-Language": this.cfg.language,
      "Accept-Encoding": "gzip, deflate",
      agent: "android",
      version: import_constants.APP_VERSION,
      Authorization: import_constants.APP_BASIC,
      "DEPT-ID": this.cfg.deptId,
      "TENANT-ID": this.cfg.tenant,
      "TENANT-CODE": this.cfg.tenant,
      "CLIENT-TOC": "Y",
      tenantCode: this.cfg.tenant,
      tenantID: this.cfg.tenant,
      channelId: this.cfg.channelId,
      countryId: this.cfg.countryId,
      appversion: import_constants.APP_VERSION,
      "User-Agent": "okhttp/4.9.0",
      nonce: "chery_legend_h5",
      timestamp: String(ts),
      url: urlPath,
      signature: (0, import_sign.bffSign)(urlPath, ts, secret)
    };
    return { ...h, ...extra };
  }
  /**
   * Marketing gateway form headers with MD5 signature (login_omoda._hdr_form).
   *
   * @param path
   */
  marketingFormHeaders(path) {
    const ts = Date.now();
    return {
      Authorization: import_constants.APP_BASIC,
      "TENANT-CODE": this.cfg.tenant,
      "TENANT-ID": this.cfg.tenant,
      tenantCode: this.cfg.tenant,
      tenantID: this.cfg.tenant,
      tenant: this.cfg.tenant,
      channelId: this.cfg.channelId,
      countryId: this.cfg.countryId,
      appversion: import_constants.APP_VERSION,
      "User-Agent": "okhttp/4.9.0",
      "Accept-Language": this.cfg.language,
      nonce: "chery_legend_marketing",
      timestamp: String(ts),
      url: path,
      signature: (0, import_sign.marketingSign)(path, ts),
      "Content-Type": "application/x-www-form-urlencoded"
    };
  }
  // ── Session / token ────────────────────────────────────────────────────────────
  /**
   * BFF login with the stored access token → { userToken, tUserId }. Attempts ONE
   * automatic refresh (no OTP) on an expired session and retries once.
   *
   * @param allowRefresh
   */
  async bffLogin(allowRefresh = true) {
    var _a, _b, _c, _d, _e;
    await this.tokens.load();
    const access = this.tokens.getAccessToken();
    const headers = this.headersPost(import_constants.EP.tspLogin, {
      Authorization: `Bearer ${access != null ? access : ""}`,
      "Content-Type": "application/json; charset=UTF-8",
      Accept: "application/json, text/plain, */*"
    });
    const r = await this.http.post(this.cfg.bff + import_constants.EP.tspLogin, JSON.stringify({ channelId: this.cfg.channelId }), {
      headers
    });
    const j = r.data;
    const d = isPlainObject(j) && isPlainObject(j.data) ? j.data : null;
    if (!d) {
      const code = isPlainObject(j) ? (0, import_util.str)((_b = (_a = j.code) != null ? _a : j.error) != null ? _b : "") : "";
      const msg = isPlainObject(j) ? (0, import_util.str)((_e = (_d = (_c = j.msg) != null ? _c : j.message) != null ? _d : j.error_description) != null ? _e : "") : "";
      this.log.debug(
        `bffLogin: no data (HTTP ${r.status}, code=${code || "\u2014"}, msg=${msg || "\u2014"}, hadAccessToken=${access ? "yes" : "no"}, willRefresh=${allowRefresh})`
      );
      if (allowRefresh && await this.refreshToken(access)) {
        return this.bffLogin(false);
      }
      return {};
    }
    const userToken = typeof d.userToken === "string" ? d.userToken : void 0;
    const tUserId = d.tUserId != null ? (0, import_util.str)(d.tUserId) : void 0;
    if (!userToken || !tUserId) {
      this.log.debug(
        `bffLogin: data present but incomplete (userToken=${userToken ? "yes" : "no"}, tUserId=${tUserId ? "yes" : "no"}, dataKeys=${Object.keys(d).join(",")})`
      );
    }
    return { userToken, tUserId };
  }
  /**
   * Renew the access token with the refresh_token (no OTP). Serialized via an in-flight
   * mutex with a disk double-check: Chery rotates the refresh_token on every use, so a
   * concurrent double-refresh would invalidate the session (wake._refresh_token C1).
   *
   * @param seenAccessToken
   */
  async refreshToken(seenAccessToken) {
    if (this.refreshInFlight) {
      return this.refreshInFlight;
    }
    this.refreshInFlight = this.doRefresh(seenAccessToken).finally(() => {
      this.refreshInFlight = null;
    });
    return this.refreshInFlight;
  }
  async doRefresh(seenAccessToken) {
    var _a, _b, _c, _d, _e, _f;
    await this.tokens.load();
    const cur = this.tokens.getAccessToken();
    if (seenAccessToken && cur && cur !== seenAccessToken) {
      return true;
    }
    const rt = this.tokens.getRefreshToken();
    if (!rt) {
      return false;
    }
    const qs = new URLSearchParams({ grant_type: "refresh_token", refresh_token: rt, scope: "server" }).toString();
    const headers = this.headersPost(import_constants.EP.token);
    try {
      const r = await this.http.post(`${this.cfg.bff}${import_constants.EP.token}?${qs}`, "", { headers });
      const j = r.data;
      const at = isPlainObject(j) ? (_a = j.access_token) != null ? _a : isPlainObject(j.data) ? j.data.access_token : void 0 : void 0;
      if (!at) {
        const code = isPlainObject(j) ? (0, import_util.str)((_c = (_b = j.code) != null ? _b : j.error) != null ? _c : "") : "";
        const msg = isPlainObject(j) ? (0, import_util.str)((_f = (_e = (_d = j.msg) != null ? _d : j.error_description) != null ? _e : j.message) != null ? _f : "") : "";
        this.log.debug(
          `token refresh: no access_token (HTTP ${r.status}, code=${code || "\u2014"}, msg=${msg || "\u2014"})`
        );
        return false;
      }
      await this.tokens.save(j);
      return true;
    } catch (e) {
      this.log.debug(`token refresh failed: ${e.message}`);
      return false;
    }
  }
  /** Check session validity by attempting a BFF login. Mirrors session.check(). */
  async checkSession() {
    try {
      const { userToken } = await this.bffLogin();
      if (userToken) {
        return { ok: true, detail: "Session active" };
      }
      return { ok: false, detail: "Session expired \u2014 request a new OTP (close the official app first)" };
    } catch (e) {
      return { ok: false, detail: `network error: ${e.name}` };
    }
  }
  // ── BFF JSON call (Bearer access token) — queryList/setVecDefault/checkPassword ──
  async bffPostJson(path, body) {
    await this.tokens.load();
    const access = this.tokens.getAccessToken();
    const headers = this.headersPost(path, {
      Authorization: `Bearer ${access != null ? access : ""}`,
      "Content-Type": "application/json; charset=UTF-8",
      Accept: "application/json, text/plain, */*"
    });
    const r = await this.http.post(this.cfg.bff + path, JSON.stringify(body), { headers });
    return isPlainObject(r.data) ? r.data : {};
  }
  // ── Signed TSP call (Authorization = userToken or car_token) ─────────────────────
  async signedTspPost(token, path, params, userAgent = "okhttp/4.9.0") {
    const ts = Date.now();
    const body = (0, import_sign.tspSignBody)({ ...params }, ts);
    const headers = {
      ...(0, import_sign.tspAuthHeaders)(token, ts),
      "Content-Type": "application/json; charset=UTF-8",
      Accept: "application/json, text/plain, */*",
      "User-Agent": userAgent,
      version: import_constants.APP_VERSION,
      agent: "android"
    };
    const r = await this.http.post(this.cfg.tspHost + path, JSON.stringify(body), { headers });
    const j = isPlainObject(r.data) ? r.data : null;
    const code = j && j.code != null ? (0, import_util.str)(j.code) : null;
    return { status: r.status, code, json: j };
  }
  /**
   * Useful payload of a TSP response: under "data" on some endpoints, "body" on others.
   *
   * @param res
   */
  static payload(res) {
    const j = res.json;
    if (!j) {
      return null;
    }
    for (const k of ["data", "body"]) {
      const v = j[k];
      if (isPlainObject(v) && Object.keys(v).length) {
        return v;
      }
    }
    return null;
  }
  // ── OTP login ────────────────────────────────────────────────────────────────
  /**
   * Send the OTP email code. `captchaVerification` comes from the captcha solver.
   *
   * @param email
   * @param captchaVerification
   */
  async sendMailCode(email, captchaVerification) {
    const headers = this.marketingFormHeaders(import_constants.EP.sendMailCode);
    const form = new URLSearchParams({ email, module: "APP-LOGIN", captchaVerification }).toString();
    const r = await this.http.post(this.cfg.bff + import_constants.EP.sendMailCode, form, { headers });
    const j = r.data;
    const key = isPlainObject(j) && typeof j.key === "string" ? j.key : void 0;
    const msg = isPlainObject(j) && typeof j.msg === "string" ? j.msg : void 0;
    const ok = !!(isPlainObject(j) && (j.ok || key === "operation.successful"));
    return { ok, key, msg };
  }
  /**
   * Mint the session token from email + OTP code (prova_token.call, prod signature).
   *
   * @param email
   * @param code
   */
  async mintToken(email, code) {
    var _a, _b, _c, _d;
    const params = {
      email: `APP-LOGIN@${email}`,
      code: (0, import_sm4.sm4Code)(code, "plain"),
      needDecode: "0",
      grant_type: "email",
      scope: "server",
      loginType: "email",
      loginAction: "1"
    };
    const qs = new URLSearchParams(params).toString();
    const headers = this.headersPost(import_constants.EP.token);
    const r = await this.http.post(`${this.cfg.bff}${import_constants.EP.token}?${qs}`, "", { headers });
    const j = r.data;
    const tok = isPlainObject(j) ? (_a = j.access_token) != null ? _a : isPlainObject(j.data) ? j.data.access_token : void 0 : void 0;
    if (tok) {
      await this.tokens.save(j);
      const d = isPlainObject(j) && isPlainObject(j.data) ? j.data : j;
      this.log.debug(
        `mintToken: saved token (keys=${Object.keys(d).join(",")}, hasRefresh=${d.refresh_token ? "yes" : "no"})`
      );
      return { ok: true };
    }
    const detail = isPlainObject(j) ? (0, import_util.str)((_d = (_c = (_b = j.msg) != null ? _b : j.error_description) != null ? _c : j.error) != null ? _d : j.key) || `HTTP ${r.status}` : `HTTP ${r.status}`;
    return { ok: false, detail };
  }
  // ── Captcha gateway (AJ-Captcha blockPuzzle) ────────────────────────────────────
  /**
   * Marketing JSON headers (captcha_solver._signed_headers): MD5 sig, no value list.
   *
   * @param path
   */
  marketingCaptchaHeaders(path) {
    const ts = Date.now();
    return {
      Authorization: import_constants.APP_BASIC,
      tenant: this.cfg.tenant,
      channelId: this.cfg.channelId,
      countryId: this.cfg.countryId,
      appversion: import_constants.APP_VERSION,
      "User-Agent": "okhttp/4.9.0",
      nonce: "chery_legend_marketing",
      timestamp: String(ts),
      url: path,
      signature: (0, import_sign.marketingSign)(path, ts),
      "Content-Type": "application/json"
    };
  }
  /**
   * Marketing headers for a query-param request: adds `keys` + `[vals]` MD5 signature.
   *
   * @param path
   * @param keysCsv
   * @param valsCsv
   */
  marketingQueryHeaders(path, keysCsv, valsCsv) {
    const ts = Date.now();
    return {
      Authorization: import_constants.APP_BASIC,
      tenant: this.cfg.tenant,
      channelId: this.cfg.channelId,
      countryId: this.cfg.countryId,
      appversion: import_constants.APP_VERSION,
      "User-Agent": "okhttp/4.9.0",
      nonce: "chery_legend_marketing",
      timestamp: String(ts),
      url: path,
      keys: keysCsv,
      signature: (0, import_sign.marketingSignVals)(path, ts, valsCsv),
      "Content-Type": "application/json"
    };
  }
  /** POST /code/create → puzzle repData ({token, secretKey, originalImageBase64, jigsawImageBase64}). */
  async captchaCreate() {
    const headers = this.marketingCaptchaHeaders(import_constants.EP.captchaCreate);
    const r = await this.http.post(
      this.cfg.bff + import_constants.EP.captchaCreate,
      JSON.stringify({ captchaType: "blockPuzzle" }),
      { headers }
    );
    const data = isPlainObject(r.data) && isPlainObject(r.data.data) ? r.data.data : null;
    return data && isPlainObject(data.repData) ? data.repData : null;
  }
  /**
   * POST /code/check with the encrypted point → verification result JSON.
   *
   * @param token
   * @param encPointJson
   */
  async captchaCheck(token, encPointJson) {
    const params = { captchaType: "blockPuzzle", pointJson: encPointJson, token };
    const keys = "captchaType,pointJson,token";
    const vals = `blockPuzzle,${encPointJson},${token}`;
    const headers = this.marketingQueryHeaders(import_constants.EP.captchaCheck, keys, vals);
    const qs = new URLSearchParams(params).toString();
    const r = await this.http.post(`${this.cfg.bff}${import_constants.EP.captchaCheck}?${qs}`, "", { headers });
    return isPlainObject(r.data) ? r.data : {};
  }
  /**
   * Diagnostic: call queryList with just the Bearer access token (no TSP userToken) and
   * log the outcome. Distinguishes an empty account (token valid, 0 vehicles) from a
   * token/account rejection. Read-only; never touches the car.
   */
  async probeQueryList() {
    var _a, _b, _c, _d;
    try {
      const j = await this.bffPostJson(import_constants.EP.vmcList, {});
      const code = (0, import_util.str)((_b = (_a = j.code) != null ? _a : j.error) != null ? _b : "");
      const msg = (0, import_util.str)((_d = (_c = j.msg) != null ? _c : j.message) != null ? _d : "");
      const count = OmodaClient.iterVehicles(j).length;
      const dataShape = isPlainObject(j.data) ? `object{${Object.keys(j.data).join(",")}}` : Array.isArray(j.data) ? `array[${j.data.length}]` : String(j.data);
      const ok = code === "0" || code === "000000" || code === "" || /success/i.test(msg);
      this.log.info(
        `queryList probe: code=${code || "\u2014"}, msg=${msg || "\u2014"}, vehicles=${count}, data=${dataShape}. ${ok ? count === 0 ? "Token is VALID but NO vehicle is linked to this account \u2014 add/share a car to it first." : `Token is valid and ${count} vehicle(s) are visible.` : "BFF rejected the access token \u2014 this is an account/token issue, not an empty garage."}`
      );
    } catch (e) {
      this.log.debug(`queryList probe failed: ${e.message}`);
    }
  }
  // ── Vehicle discovery ────────────────────────────────────────────────────────
  static iterVehicles(qlist) {
    const out = [];
    const data = qlist.data;
    if (Array.isArray(data)) {
      return data.filter(isPlainObject);
    }
    if (isPlainObject(data)) {
      let any = false;
      for (const key of ["controlCarList", "authorizedControlCarList", "carList", "list", "vehicles"]) {
        const v = data[key];
        if (Array.isArray(v)) {
          out.push(...v.filter(isPlainObject));
          any = true;
        }
      }
      if (!any && (data.vin || data.VIN)) {
        out.push(data);
      }
    }
    return out;
  }
  static toVehicle(item) {
    var _a, _b;
    const vin = (0, import_util.str)((_b = (_a = item.vin) != null ? _a : item.VIN) != null ? _b : item.Vin).trim();
    if (!vin) {
      return null;
    }
    const nick = (0, import_util.str)(item.nickname).trim();
    const full = (0, import_util.str)(item.fullName).trim();
    const name = nick || (full ? titleCase(full) : "");
    const num = (k) => {
      const v = item[k];
      return typeof v === "number" && !Number.isNaN(v) ? v : void 0;
    };
    return {
      vin,
      id: (0, import_util.sanitizeId)(vin),
      name: name || void 0,
      model: full ? titleCase(full) : void 0,
      brand: full || nick ? deriveBrand(full || nick) : void 0,
      authorizeType: typeof item.authorizeType === "number" ? item.authorizeType : void 0,
      powerType: typeof item.powerType === "number" ? item.powerType : void 0,
      climateMinTemp: num("minTemperature"),
      climateMaxTemp: num("maxTemperature"),
      climateTempStep: num("temperatureStepLength")
    };
  }
  /** queryList → list of vehicles for this account (owner + delegated). */
  async discoverVehicles() {
    await this.bffLogin();
    const j = await this.bffPostJson(import_constants.EP.vmcList, {});
    const vehicles = OmodaClient.iterVehicles(j).map((it) => OmodaClient.toVehicle(it)).filter((v) => v !== null);
    this.log.debug(
      `queryList discovered ${vehicles.length} vehicle(s): ${vehicles.map((v) => (0, import_util.mask)(v.vin)).join(", ")}`
    );
    return vehicles;
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  OmodaClient
});
//# sourceMappingURL=client.js.map
