/* Shared types for the Omoda / Jaecoo adapter. */

/** Resolved runtime config (region endpoints + account) passed to the API client. */
export interface RuntimeConfig {
    bff: string;
    tspHost: string;
    mqttHost: string;
    mqttPort: number;
    tenant: string;
    channelId: string;
    countryId: string;
    deptId: string;
    language: string;
    email: string;
    pin: string;
    appVersion: string;
    pollNormalMin: number;
    sessionEverySec: number;
    wakeCooldownSec: number;
}

/** Minimal logger surface (satisfied by ioBroker's `adapter.log`). */
export interface Logger {
    debug(msg: string): void;
    info(msg: string): void;
    warn(msg: string): void;
    error(msg: string): void;
}

/** OAuth token document as returned by /auth/oauth2/token (flat or wrapped in {data}). */
export interface TokenDoc {
    access_token?: string;
    refresh_token?: string;
    data?: { access_token?: string; refresh_token?: string; [k: string]: unknown };
    [k: string]: unknown;
}

/** A vehicle discovered via queryList. */
export interface Vehicle {
    /** Real VIN, sent to the backend API. */
    vin: string;
    /** Sanitized VIN used as the ioBroker object-id segment (see sanitizeId). */
    id: string;
    name?: string;
    model?: string;
    brand?: string;
    authorizeType?: number; // 2 = owner, 0 = delegate
    powerType?: number; // 0 = pure electric (BEV)
    climateMinTemp?: number;
    climateMaxTemp?: number;
    climateTempStep?: number;
}

/** Result of a signed TSP call. */
export interface TspResult {
    status: number;
    code: string | null;
    json: Record<string, unknown> | null;
}
