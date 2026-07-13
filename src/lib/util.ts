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
