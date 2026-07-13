/*
 * Request-signing helpers for the Omoda / Jaecoo backend, ported from:
 *   - core/omoda_auth.py  (BFF app signature: SHA-256)
 *   - core/login_omoda.py + core/captcha_solver.py (marketing gateway: MD5)
 *   - core/tsp_sign.py    (tspconsole Chery Vehicle SDK signature: base64(SHA-256).upper)
 *
 * MD5/SHA here are interop request-signature formats mandated by the gateway, NOT
 * password/security hashing.
 */
import { createHash } from 'node:crypto';
import { MARKETING_NONCE, MARKETING_SECRET, SIGN_NONCE, SIGN_SECRET, TSP_APP_ID, TSP_APP_SECRET } from '../constants';
import { str } from '../util';

function sha256Hex(input: string): string {
    return createHash('sha256').update(input, 'utf-8').digest('hex');
}
function sha256Buf(input: string): Buffer {
    return createHash('sha256').update(input, 'utf-8').digest();
}
function md5Hex(input: string): string {
    return createHash('md5').update(input, 'utf-8').digest('hex');
}

// ── BFF app signature (POST, empty value map) ────────────────────────────────────────
/**
 * sha256_hex(secret + nonce + url_path + ts_ms). Mirrors `omoda_auth.sign_post`.
 *
 * @param urlPath
 * @param tsMs
 * @param secret
 * @param nonce
 */
export function bffSign(
    urlPath: string,
    tsMs: number,
    secret: string = SIGN_SECRET,
    nonce: string = SIGN_NONCE,
): string {
    return sha256Hex(`${secret}${nonce}${urlPath}${tsMs}`);
}

// ── Marketing gateway signature (captcha create/check, sendMailCode) ─────────────────
/**
 * md5(secret + nonce + path + ts). For requests with no value list.
 *
 * @param path
 * @param tsMs
 */
export function marketingSign(path: string, tsMs: number): string {
    return md5Hex(`${MARKETING_SECRET}${MARKETING_NONCE}${path}${tsMs}`);
}
/**
 * md5(secret + nonce + path + ts + "[vals]") — for requests whose values are signed.
 *
 * @param path
 * @param tsMs
 * @param valsCsv
 */
export function marketingSignVals(path: string, tsMs: number, valsCsv: string): string {
    return md5Hex(`${MARKETING_SECRET}${MARKETING_NONCE}${path}${tsMs}[${valsCsv}]`);
}

// ── TSP (tspconsole) signature — EU tagEncrypt="1" ───────────────────────────────────
/** EVEN-index characters of APP_SECRET → "EUProd89ec59274d23491084af". */
export const TSP_HALF: string = Array.from(TSP_APP_SECRET)
    .filter((_, i) => i % 2 === 0)
    .join('');

export type SignParams = Record<string, unknown>;

/**
 * Flatten a nested ARRAY value the way the native SDK does (ldkb.smali a(JSONObject)),
 * BEFORE signing. Objects → 'key=value&' (keys sorted, empty skipped); scalars →
 * str(el) concatenated with no separator (e.g. [1,2,3] → '123'). Trailing '&' removed.
 * Only used by scheduled charging (deferred), but ported for completeness.
 *
 * @param v
 */
function flattenValue(v: unknown): unknown {
    if (Array.isArray(v)) {
        let sb = '';
        for (const el of v) {
            if (el && typeof el === 'object' && !Array.isArray(el)) {
                const fl = flattenObj(el as SignParams);
                for (const k of Object.keys(fl).sort()) {
                    const val = fl[k];
                    if (val === null || val === undefined || val === '') {
                        continue;
                    }
                    sb += `${k}=${str(val)}&`;
                }
            } else {
                sb += str(el);
            }
        }
        if (sb.endsWith('&')) {
            sb = sb.slice(0, -1);
        }
        return sb;
    }
    return v;
}

function flattenObj(obj: SignParams): SignParams {
    const out: SignParams = {};
    for (const [k, v] of Object.entries(obj)) {
        out[k] = Array.isArray(v) ? flattenValue(v) : v;
    }
    return out;
}

/**
 * base64(sha256(base)).toUpperCase(), where base =
 *   <params sorted "k=v&", null/"" skipped> + "secretKey=<HALF>&timestamp=<ts>".
 * Mirrors `tsp_sign.build_sign`.
 *
 * @param params
 * @param tsMs
 * @param half
 */
export function tspBuildSign(params: SignParams, tsMs: number, half: string = TSP_HALF): string {
    const flat = flattenObj(params);
    let base = '';
    for (const k of Object.keys(flat).sort()) {
        const v = flat[k];
        if (v === null || v === undefined || v === '') {
            continue;
        }
        base += `${k}=${str(v)}&`;
    }
    base += `secretKey=${half}&timestamp=${tsMs}`;
    return sha256Buf(base).toString('base64').toUpperCase();
}

/**
 * Returns the final signed body {…params, appId, sign}. Mirrors `tsp_sign.sign_body`.
 *
 * @param bodyParams
 * @param tsMs
 */
export function tspSignBody(bodyParams: SignParams, tsMs: number): SignParams {
    const m: SignParams = { ...bodyParams, appId: TSP_APP_ID };
    m.sign = tspBuildSign(m, tsMs);
    return m;
}

/**
 * Auth headers for a signed TSP call. Mirrors `tsp_sign.auth_headers`.
 *
 * @param userToken
 * @param tsMs
 * @param tenantId
 */
export function tspAuthHeaders(userToken: string, tsMs: number, tenantId = ''): Record<string, string> {
    return {
        Authorization: userToken,
        timestamp: String(tsMs),
        'x-TenantId': tenantId || '',
    };
}
