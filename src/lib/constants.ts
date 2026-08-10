/*
 * Reverse-engineered constants for the Omoda / Jaecoo ("legend", Chery) cloud backend.
 *
 * These are NOT guessable — they were recovered by decompiling the official app and are
 * copied verbatim from the Home Assistant integration `JackRonan/omoda-jaecoo-ha`
 * (core/omoda_auth.py, core/tsp_sign.py, core/captcha_solver.py, coordinator.py, const.py).
 * They are app-wide constants (client secrets baked into the APK), not per-user secrets.
 */

/** BFF app-client Basic auth (base64 of "legendApp:legendApp") — a fixed app constant. */
export const APP_BASIC = 'Basic bGVnZW5kQXBwOmxlZ2VuZEFwcA==';
export const APP_VERSION = '1.1.9';

/** BFF request signature (POST): sha256_hex(SIGN_SECRET + nonce + url_path + ts_ms). */
export const SIGN_NONCE = 'chery_legend_h5';
export const SIGN_SECRET = 'cX5fR8lJ6pK2xD4uH1eK4pY6wA4xO0sK'; // prod (CURRENT_CAR_CONTROL_ENV=0)

/** SM4 fixed key (SM4.createHexKey), 16 bytes. Used for login `code` + checkPassword PIN. */
export const SM4_KEY = Buffer.from('mHU80av2zFtf4OY6', 'utf-8');

/** Marketing gateway (captcha + sendMailCode/sendSmsCode) signature: MD5-based. */
export const MARKETING_SECRET = '5c7af05e6fbf562842ef483ee96e06a0';
export const MARKETING_NONCE = 'chery_legend_marketing';

/** TSP (tspconsole) request signing — EU environment, tagEncrypt="1" (SHA-256, not HMAC). */
export const TSP_APP_ID = 'eu-1';
export const TSP_APP_SECRET = 'EBUJPYr7oDd48C9Te9c755942Y7T48dV293Y4Z931J098X41aYf0';

/** Shared app constant (not a user secret): seed to derive the car MQTT password. */
export const CAR_SEED = 'fa89db3abe8045919d70c6ed3cc65bc5';

// Region defaults live in io-package.json `native` (bff/tspHost/mqttHost/mqttPort/tenant/
// channelId/countryId/deptId) and are user-editable under "Region & polling" in admin. There is
// deliberately no second copy here: a RegionConfig/REGION_EU pair used to duplicate those values
// with nothing keeping the two in sync.
//
// DEPT-ID is the one that catches people out — it must be the account country's international
// dialing prefix (UK=44 default, IT=39, FR=33, DE=49, NL=31), not a fixed region id. A wrong value
// makes the TSP login fail with code=1 "Please contact customer service for assistance".

// ── Endpoint paths (relative to BFF host + "/api", or absolute path on the TSP host) ──
export const EP = {
    // BFF
    token: '/auth/oauth2/token',
    sendMailCode: '/marketing/v2/app/code/sendMailCode',
    // Not wired yet: needed by the phone/SMS login flow deferred from upstream v1.8.0.
    sendSmsCode: '/marketing/v2/app/code/sendSmsCode',
    captchaCreate: '/code/create',
    captchaCheck: '/code/check',
    tspLogin: '/tsp/v1/app/auth/login',
    // Not wired yet: tUserId currently comes back from bffLogin, so this standalone lookup is
    // only needed if that ever stops returning it.
    getTuserId: '/tsp/v1/app/auth/getTuserId',
    vmcList: '/tsp/v1/app/vmc/queryList',
    setVecDefault: '/tsp/v1/app/vmc/setVecDefault',
    checkPassword: '/tsp/v1/app/cpm/checkPassword',
    // TSP (tspconsole host)
    smsAwaken: '/asc/vehicleControl/smsAwaken',
    realtime: '/asr/manager/realtime',
    vehicleLocation: '/asc/vehicleControl/queryVehicleLocation',
    vehicleControl: '/asc/vehicleControl/', // + endpoint
    // Not wired yet: theft-alarm state, a verified recipe kept for a later release.
    theftQuery: '/act/theftAlarm/querySwitch',
} as const;

// ── Polling / timing intervals (seconds unless noted) — from const.py ────────────────
export const TIMING = {
    awakeWindowSec: 300,
    pollWakeWaitSec: 25,
    hvOnPollEverySec: 60,
    hvOnPollMax: 90,
    chargingPollEverySec: 120,
    chargingPollMax: 300,
} as const;

// ── Backend response codes → readable text (core/codes.py) ───────────────────────────
export const CODE_MEANING: Record<string, string> = {
    '000000': 'ok ✅',
    A00079: 'command accepted ✅',
    A00082: 'car busy ⏳ (another command is in progress) — retry in a few seconds',
    A00084: 'command not allowed on this car 🚫 (permission denied for this function)',
    A00089: 'invalid taskId ❌ (requires a taskId authenticated by checkPassword)',
    A00546: 'invalid taskId ❌ (incorrect scene in checkPassword)',
    A00567: 'incomplete checkPassword parameters ❌',
    A00000: 'token expired/invalid ❌ (please redo OTP login)',
    A07312: 'wake rate-limit 🚫 (car is refusing further wake requests right now, try again later)',
    A07900: 'car asleep / unreachable (or signature/car_token invalid) ⌛',
};

export const FAILURE_CODES = new Set(['A00082', 'A00084', 'A00089', 'A00546', 'A00567', 'A00000', 'A07312', 'A07900']);

/**
 * Human-readable phrase for a backend code (falls back to the raw code).
 *
 * @param code
 * @param fallback
 */
export function codeMeaning(code: string | null | undefined, fallback?: string): string {
    if (code == null) {
        return fallback ?? 'no code';
    }
    const key = String(code);
    return CODE_MEANING[key] ?? fallback ?? `code ${key}`;
}
