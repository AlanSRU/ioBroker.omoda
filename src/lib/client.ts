/*
 * OmodaClient — REST layer for the Omoda / Jaecoo "legend" backend.
 *
 * Ports the request flows from the HA integration:
 *   - core/omoda_auth.py  headers_post           → headersPost()
 *   - core/login_omoda.py _hdr_form / invia      → marketingFormHeaders() / sendMailCode()
 *   - core/prova_token.py call                    → mintToken()
 *   - core/wake.py        _bff_login/_refresh/_signed_post → bffLogin()/refreshToken()/signedTspPost()
 *   - core/provision.py   queryList extraction     → discoverVehicles()
 *
 * The BFF "always returns HTTP 200" for these calls; the real outcome is in the JSON `code`
 * or the presence of a `data` object. We therefore never let axios throw on status.
 */
import axios, { type AxiosInstance } from 'axios';
import { APP_BASIC, APP_VERSION, EP, SIGN_SECRET } from './constants';
import { bffSign, marketingSign, marketingSignVals, tspAuthHeaders, tspSignBody, type SignParams } from './crypto/sign';
import { sm4Code } from './crypto/sm4';
import type { Logger, RuntimeConfig, TspResult, Vehicle } from './types';
import type { TokenStore } from './tokenStore';
import { sanitizeId, str } from './util';

function isPlainObject(v: unknown): v is Record<string, unknown> {
    return !!v && typeof v === 'object' && !Array.isArray(v);
}

function deriveBrand(name: string): string {
    return /jaecoo/i.test(name) ? 'Jaecoo' : 'Omoda';
}

function titleCase(s: string): string {
    return s.replace(/\w\S*/g, w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}

export class OmodaClient {
    private readonly http: AxiosInstance;
    private refreshInFlight: Promise<boolean> | null = null;

    constructor(
        private readonly cfg: RuntimeConfig,
        private readonly tokens: TokenStore,
        private readonly log: Logger,
    ) {
        this.http = axios.create({
            timeout: 25000,
            // The gateway signals failure via body, not status → never throw on status.
            validateStatus: () => true,
            // Do not transform bodies; we serialize/parse ourselves for signature fidelity.
            maxRedirects: 0,
        });
    }

    // ── Header builders ──────────────────────────────────────────────────────────────
    /**
     * Full BFF header set with SHA-256 app signature (omoda_auth.headers_post).
     *
     * @param urlPath
     * @param extra
     * @param secret
     */
    private headersPost(
        urlPath: string,
        extra?: Record<string, string>,
        secret: string = SIGN_SECRET,
    ): Record<string, string> {
        const ts = Date.now();
        const h: Record<string, string> = {
            Accept: 'application/json, text/plain, */*',
            'Content-Type': 'application/x-www-form-urlencoded',
            'Accept-Language': this.cfg.language,
            'Accept-Encoding': 'gzip, deflate',
            agent: 'android',
            version: APP_VERSION,
            Authorization: APP_BASIC,
            'DEPT-ID': this.cfg.deptId,
            'TENANT-ID': this.cfg.tenant,
            'TENANT-CODE': this.cfg.tenant,
            'CLIENT-TOC': 'Y',
            tenantCode: this.cfg.tenant,
            tenantID: this.cfg.tenant,
            channelId: this.cfg.channelId,
            countryId: this.cfg.countryId,
            appversion: APP_VERSION,
            'User-Agent': 'okhttp/4.9.0',
            nonce: 'chery_legend_h5',
            timestamp: String(ts),
            url: urlPath,
            signature: bffSign(urlPath, ts, secret),
        };
        return { ...h, ...extra };
    }

    /**
     * Marketing gateway form headers with MD5 signature (login_omoda._hdr_form).
     *
     * @param path
     */
    private marketingFormHeaders(path: string): Record<string, string> {
        const ts = Date.now();
        return {
            Authorization: APP_BASIC,
            'TENANT-CODE': this.cfg.tenant,
            'TENANT-ID': this.cfg.tenant,
            tenantCode: this.cfg.tenant,
            tenantID: this.cfg.tenant,
            tenant: this.cfg.tenant,
            channelId: this.cfg.channelId,
            countryId: this.cfg.countryId,
            appversion: APP_VERSION,
            'User-Agent': 'okhttp/4.9.0',
            'Accept-Language': this.cfg.language,
            nonce: 'chery_legend_marketing',
            timestamp: String(ts),
            url: path,
            signature: marketingSign(path, ts),
            'Content-Type': 'application/x-www-form-urlencoded',
        };
    }

    // ── Session / token ────────────────────────────────────────────────────────────
    /**
     * BFF login with the stored access token → { userToken, tUserId }. Attempts ONE
     * automatic refresh (no OTP) on an expired session and retries once.
     *
     * @param allowRefresh
     */
    async bffLogin(allowRefresh = true): Promise<{
        userToken?: string;
        tUserId?: string;
    }> {
        await this.tokens.load();
        const access = this.tokens.getAccessToken();
        const headers = this.headersPost(EP.tspLogin, {
            Authorization: `Bearer ${access ?? ''}`,
            'Content-Type': 'application/json; charset=UTF-8',
            Accept: 'application/json, text/plain, */*',
        });
        const r = await this.http.post(this.cfg.bff + EP.tspLogin, JSON.stringify({ channelId: this.cfg.channelId }), {
            headers,
        });
        const j = r.data;
        const d = isPlainObject(j) && isPlainObject(j.data) ? j.data : null;
        if (!d) {
            const code = isPlainObject(j) ? str(j.code ?? j.error ?? '') : '';
            const msg = isPlainObject(j) ? str(j.msg ?? j.message ?? j.error_description ?? '') : '';
            this.log.debug(
                `bffLogin: no data (HTTP ${r.status}, code=${code || '—'}, msg=${msg || '—'}, ` +
                    `hadAccessToken=${access ? 'yes' : 'no'}, willRefresh=${allowRefresh})`,
            );
            if (allowRefresh && (await this.refreshToken(access))) {
                return this.bffLogin(false);
            }
            return {};
        }
        const userToken = typeof d.userToken === 'string' ? d.userToken : undefined;
        const tUserId = d.tUserId != null ? str(d.tUserId) : undefined;
        if (!userToken || !tUserId) {
            this.log.debug(
                `bffLogin: data present but incomplete (userToken=${userToken ? 'yes' : 'no'}, ` +
                    `tUserId=${tUserId ? 'yes' : 'no'}, dataKeys=${Object.keys(d).join(',')})`,
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
    async refreshToken(seenAccessToken?: string): Promise<boolean> {
        if (this.refreshInFlight) {
            return this.refreshInFlight;
        }
        this.refreshInFlight = this.doRefresh(seenAccessToken).finally(() => {
            this.refreshInFlight = null;
        });
        return this.refreshInFlight;
    }

    private async doRefresh(seenAccessToken?: string): Promise<boolean> {
        await this.tokens.load();
        const cur = this.tokens.getAccessToken();
        if (seenAccessToken && cur && cur !== seenAccessToken) {
            return true; // another path already refreshed
        }
        const rt = this.tokens.getRefreshToken();
        if (!rt) {
            return false;
        }
        const qs = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: rt, scope: 'server' }).toString();
        const headers = this.headersPost(EP.token);
        try {
            const r = await this.http.post(`${this.cfg.bff}${EP.token}?${qs}`, '', { headers });
            const j = r.data;
            const at = isPlainObject(j)
                ? (j.access_token ?? (isPlainObject(j.data) ? j.data.access_token : undefined))
                : undefined;
            if (!at) {
                const code = isPlainObject(j) ? str(j.code ?? j.error ?? '') : '';
                const msg = isPlainObject(j) ? str(j.msg ?? j.error_description ?? j.message ?? '') : '';
                this.log.debug(`token refresh: no access_token (HTTP ${r.status}, code=${code || '—'}, msg=${msg || '—'})`);
                return false;
            }
            await this.tokens.save(j as Record<string, unknown>);
            return true;
        } catch (e) {
            this.log.debug(`token refresh failed: ${(e as Error).message}`);
            return false;
        }
    }

    /** Check session validity by attempting a BFF login. Mirrors session.check(). */
    async checkSession(): Promise<{
        ok: boolean;
        detail: string;
    }> {
        try {
            const { userToken } = await this.bffLogin();
            if (userToken) {
                return { ok: true, detail: 'Session active' };
            }
            return { ok: false, detail: 'Session expired — request a new OTP (close the official app first)' };
        } catch (e) {
            return { ok: false, detail: `network error: ${(e as Error).name}` };
        }
    }

    // ── BFF JSON call (Bearer access token) — queryList/setVecDefault/checkPassword ──
    async bffPostJson(path: string, body: SignParams): Promise<Record<string, unknown>> {
        await this.tokens.load();
        const access = this.tokens.getAccessToken();
        const headers = this.headersPost(path, {
            Authorization: `Bearer ${access ?? ''}`,
            'Content-Type': 'application/json; charset=UTF-8',
            Accept: 'application/json, text/plain, */*',
        });
        const r = await this.http.post(this.cfg.bff + path, JSON.stringify(body), { headers });
        return isPlainObject(r.data) ? r.data : {};
    }

    // ── Signed TSP call (Authorization = userToken or car_token) ─────────────────────
    async signedTspPost(
        token: string,
        path: string,
        params: SignParams,
        userAgent = 'okhttp/4.9.0',
    ): Promise<TspResult> {
        const ts = Date.now();
        const body = tspSignBody({ ...params }, ts);
        const headers = {
            ...tspAuthHeaders(token, ts),
            'Content-Type': 'application/json; charset=UTF-8',
            Accept: 'application/json, text/plain, */*',
            'User-Agent': userAgent,
            version: APP_VERSION,
            agent: 'android',
        };
        const r = await this.http.post(this.cfg.tspHost + path, JSON.stringify(body), { headers });
        const j = isPlainObject(r.data) ? r.data : null;
        const code = j && j.code != null ? str(j.code) : null;
        return { status: r.status, code, json: j };
    }

    /**
     * Useful payload of a TSP response: under "data" on some endpoints, "body" on others.
     *
     * @param res
     */
    static payload(res: TspResult): Record<string, unknown> | null {
        const j = res.json;
        if (!j) {
            return null;
        }
        for (const k of ['data', 'body'] as const) {
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
    async sendMailCode(
        email: string,
        captchaVerification: string,
    ): Promise<{
        ok: boolean;
        key?: string;
        msg?: string;
    }> {
        const headers = this.marketingFormHeaders(EP.sendMailCode);
        const form = new URLSearchParams({ email, module: 'APP-LOGIN', captchaVerification }).toString();
        const r = await this.http.post(this.cfg.bff + EP.sendMailCode, form, { headers });
        const j = r.data;
        const key = isPlainObject(j) && typeof j.key === 'string' ? j.key : undefined;
        const msg = isPlainObject(j) && typeof j.msg === 'string' ? j.msg : undefined;
        const ok = !!(isPlainObject(j) && (j.ok || key === 'operation.successful'));
        return { ok, key, msg };
    }

    /**
     * Mint the session token from email + OTP code (prova_token.call, prod signature).
     *
     * @param email
     * @param code
     */
    async mintToken(
        email: string,
        code: string,
    ): Promise<{
        ok: boolean;
        detail?: string;
    }> {
        const params = {
            email: `APP-LOGIN@${email}`,
            code: sm4Code(code, 'plain'),
            needDecode: '0',
            grant_type: 'email',
            scope: 'server',
            loginType: 'email',
            loginAction: '1',
        };
        const qs = new URLSearchParams(params).toString();
        const headers = this.headersPost(EP.token);
        const r = await this.http.post(`${this.cfg.bff}${EP.token}?${qs}`, '', { headers });
        const j = r.data;
        const tok = isPlainObject(j)
            ? (j.access_token ?? (isPlainObject(j.data) ? j.data.access_token : undefined))
            : undefined;
        if (tok) {
            await this.tokens.save(j as Record<string, unknown>);
            const d = isPlainObject(j) && isPlainObject(j.data) ? j.data : (j as Record<string, unknown>);
            this.log.debug(
                `mintToken: saved token (keys=${Object.keys(d).join(',')}, hasRefresh=${d.refresh_token ? 'yes' : 'no'})`,
            );
            return { ok: true };
        }
        const detail = isPlainObject(j)
            ? str(j.msg ?? j.error_description ?? j.error ?? j.key) || `HTTP ${r.status}`
            : `HTTP ${r.status}`;
        return { ok: false, detail };
    }

    // ── Captcha gateway (AJ-Captcha blockPuzzle) ────────────────────────────────────
    /**
     * Marketing JSON headers (captcha_solver._signed_headers): MD5 sig, no value list.
     *
     * @param path
     */
    private marketingCaptchaHeaders(path: string): Record<string, string> {
        const ts = Date.now();
        return {
            Authorization: APP_BASIC,
            tenant: this.cfg.tenant,
            channelId: this.cfg.channelId,
            countryId: this.cfg.countryId,
            appversion: APP_VERSION,
            'User-Agent': 'okhttp/4.9.0',
            nonce: 'chery_legend_marketing',
            timestamp: String(ts),
            url: path,
            signature: marketingSign(path, ts),
            'Content-Type': 'application/json',
        };
    }

    /**
     * Marketing headers for a query-param request: adds `keys` + `[vals]` MD5 signature.
     *
     * @param path
     * @param keysCsv
     * @param valsCsv
     */
    private marketingQueryHeaders(path: string, keysCsv: string, valsCsv: string): Record<string, string> {
        const ts = Date.now();
        return {
            Authorization: APP_BASIC,
            tenant: this.cfg.tenant,
            channelId: this.cfg.channelId,
            countryId: this.cfg.countryId,
            appversion: APP_VERSION,
            'User-Agent': 'okhttp/4.9.0',
            nonce: 'chery_legend_marketing',
            timestamp: String(ts),
            url: path,
            keys: keysCsv,
            signature: marketingSignVals(path, ts, valsCsv),
            'Content-Type': 'application/json',
        };
    }

    /** POST /code/create → puzzle repData ({token, secretKey, originalImageBase64, jigsawImageBase64}). */
    async captchaCreate(): Promise<Record<string, unknown> | null> {
        const headers = this.marketingCaptchaHeaders(EP.captchaCreate);
        const r = await this.http.post(
            this.cfg.bff + EP.captchaCreate,
            JSON.stringify({ captchaType: 'blockPuzzle' }),
            { headers },
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
    async captchaCheck(token: string, encPointJson: string): Promise<Record<string, unknown>> {
        const params = { captchaType: 'blockPuzzle', pointJson: encPointJson, token };
        const keys = 'captchaType,pointJson,token';
        const vals = `blockPuzzle,${encPointJson},${token}`;
        const headers = this.marketingQueryHeaders(EP.captchaCheck, keys, vals);
        const qs = new URLSearchParams(params).toString();
        const r = await this.http.post(`${this.cfg.bff}${EP.captchaCheck}?${qs}`, '', { headers });
        return isPlainObject(r.data) ? r.data : {};
    }

    /**
     * Diagnostic: call queryList with just the Bearer access token (no TSP userToken) and
     * log the outcome. Distinguishes an empty account (token valid, 0 vehicles) from a
     * token/account rejection. Read-only; never touches the car.
     */
    async probeQueryList(): Promise<void> {
        try {
            const j = await this.bffPostJson(EP.vmcList, {});
            const code = str(j.code ?? j.error ?? '');
            const msg = str(j.msg ?? j.message ?? '');
            const count = OmodaClient.iterVehicles(j).length;
            const dataShape = isPlainObject(j.data)
                ? `object{${Object.keys(j.data).join(',')}}`
                : Array.isArray(j.data)
                  ? `array[${j.data.length}]`
                  : String(j.data);
            // BFF success is code "0" (or "000000") / "Operation successful" — NOT the TSP code space.
            const ok = code === '0' || code === '000000' || code === '' || /success/i.test(msg);
            this.log.info(
                `queryList probe: code=${code || '—'}, msg=${msg || '—'}, vehicles=${count}, data=${dataShape}. ` +
                    (ok
                        ? count === 0
                            ? 'Token is VALID but NO vehicle is linked to this account — add/share a car to it first.'
                            : `Token is valid and ${count} vehicle(s) are visible.`
                        : 'BFF rejected the access token — this is an account/token issue, not an empty garage.'),
            );
        } catch (e) {
            this.log.debug(`queryList probe failed: ${(e as Error).message}`);
        }
    }

    // ── Vehicle discovery ────────────────────────────────────────────────────────
    private static iterVehicles(qlist: Record<string, unknown>): Record<string, unknown>[] {
        const out: Record<string, unknown>[] = [];
        const data = qlist.data;
        if (Array.isArray(data)) {
            return data.filter(isPlainObject);
        }
        if (isPlainObject(data)) {
            let any = false;
            for (const key of ['controlCarList', 'authorizedControlCarList', 'carList', 'list', 'vehicles']) {
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

    private static toVehicle(item: Record<string, unknown>): Vehicle | null {
        const vin = str(item.vin ?? item.VIN ?? item.Vin).trim();
        if (!vin) {
            return null;
        }
        const nick = str(item.nickname).trim();
        const full = str(item.fullName).trim();
        const name = nick || (full ? titleCase(full) : '');
        const num = (k: string): number | undefined => {
            const v = item[k];
            return typeof v === 'number' && !Number.isNaN(v) ? v : undefined;
        };
        return {
            vin,
            id: sanitizeId(vin),
            name: name || undefined,
            model: full ? titleCase(full) : undefined,
            brand: full || nick ? deriveBrand(full || nick) : undefined,
            authorizeType: typeof item.authorizeType === 'number' ? item.authorizeType : undefined,
            powerType: typeof item.powerType === 'number' ? item.powerType : undefined,
            climateMinTemp: num('minTemperature'),
            climateMaxTemp: num('maxTemperature'),
            climateTempStep: num('temperatureStepLength'),
        };
    }

    /** queryList → list of vehicles for this account (owner + delegated). */
    async discoverVehicles(): Promise<Vehicle[]> {
        // Ensure the session is live first (also triggers refresh if needed).
        await this.bffLogin();
        const j = await this.bffPostJson(EP.vmcList, {});
        const vehicles = OmodaClient.iterVehicles(j)
            .map(it => OmodaClient.toVehicle(it))
            .filter((v): v is Vehicle => v !== null);
        this.log.debug(`queryList discovered ${vehicles.length} vehicle(s): ${vehicles.map(v => v.vin).join(', ')}`);
        return vehicles;
    }
}
