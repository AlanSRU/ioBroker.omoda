/* Small shared helpers. */

/**
 * Safe stringify for values of `unknown`/JSON-parsed origin: primitives become their string,
 * null/undefined/objects become ''. Avoids accidental "[object Object]" and satisfies
 * the no-base-to-string lint rule on untyped backend payload fields.
 */
/** Clamp a number into [min, max]; NaN → fallback. */
export function clamp(v: number, min: number, max: number, fallback: number): number {
    if (Number.isNaN(v)) {
        return fallback;
    }
    return Math.min(max, Math.max(min, v));
}

/** Strip characters not allowed in ioBroker object ids (stricter a-zA-Z0-9_- is safe). */
export function sanitizeId(s: string): string {
    return s.replace(/[^a-zA-Z0-9_-]/g, '_');
}

/**
 * Mask an identifier for logging — keeps only the last 4 chars, prefixed with `…`.
 * Used so VIN / tUserId / MQTT-username never appear in cleartext logs while still
 * giving enough of a suffix to correlate lines. Empty/short input → '…'.
 */
export function mask(s: string | null | undefined): string {
    const v = str(s);
    return v.length <= 4 ? '…' : `…${v.slice(-4)}`;
}

export function str(v: unknown): string {
    if (v === null || v === undefined) {
        return '';
    }
    if (typeof v === 'string') {
        return v;
    }
    if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') {
        return String(v);
    }
    return '';
}
