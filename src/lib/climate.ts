/*
 * climate.ts — pure helpers that fit climate commands to what the car declares in queryList.
 * Port of const.capabilities_from_item (range/durations) and commands.durata_ammessa.
 */

/** Plausibility band for the queryList range: outside it the field is wrong data, not an exotic car. */
const CLIMATE_MIN_PLAUSIBLE = 14.0;
const CLIMATE_MAX_PLAUSIBLE = 33.0;
const CLIMATE_STEPS_ALLOWED = [0.5, 1.0];
/** A climate duration over an hour is wrong data, not an exotic car. */
const DURATION_MAX_PLAUSIBLE = 60;

/**
 * The queryList climate range, or undefined where it is implausible (upstream ac605fa). min/max are
 * accepted as a pair, step on its own. A rejected field is treated exactly like a missing one, so
 * the targetTemperature object keeps its static defaults.
 *
 * @param min minTemperature
 * @param max maxTemperature
 * @param step temperatureStepLength
 */
export function plausibleClimateRange(
    min: number | undefined,
    max: number | undefined,
    step: number | undefined,
): { min?: number; max?: number; step?: number } {
    const pairOk =
        min != null && max != null && CLIMATE_MIN_PLAUSIBLE <= min && min < max && max <= CLIMATE_MAX_PLAUSIBLE;
    return {
        min: pairOk ? min : undefined,
        max: pairOk ? max : undefined,
        step: step != null && CLIMATE_STEPS_ALLOWED.includes(step) ? step : undefined,
    };
}

/**
 * `maxAirDuration` is a SET of allowed minutes ("5,10,15"), not a maximum despite its name
 * (upstream 97b3edf). Returns the sorted plausible values, or undefined if absent/unparseable —
 * one bad element discards the whole field, as upstream does.
 *
 * @param raw maxAirDuration as received (string or number)
 */
export function parseAirDurations(raw: unknown): number[] | undefined {
    if (typeof raw !== 'string' && typeof raw !== 'number') {
        return undefined;
    }
    const set = new Set<number>();
    for (const p of String(raw).split(',')) {
        if (!p.trim()) {
            continue;
        }
        const n = Number(p);
        if (!Number.isFinite(n)) {
            return undefined;
        }
        set.add(Math.trunc(n));
    }
    const out = [...set].filter(d => d > 0 && d <= DURATION_MAX_PLAUSIBLE).sort((a, b) => a - b);
    return out.length ? out : undefined;
}

/**
 * The duration to actually send. Asking 15 of a car that only allows 5 and 10 is not asking for
 * "a lot", it is sending an invalid value: take the largest allowed value not above the wanted one,
 * or the smallest if all are above it — not sending is not an option, the user pressed a button.
 *
 * @param wanted minutes requested
 * @param allowed the car's allowed set (parseAirDurations); unknown → wanted unchanged
 */
export function chooseAirDuration(wanted: number, allowed: number[] | undefined): number {
    if (!allowed?.length || allowed.includes(wanted)) {
        return wanted;
    }
    const lower = allowed.filter(d => d <= wanted);
    return lower.length ? Math.max(...lower) : Math.min(...allowed);
}

/**
 * Clamp a target temperature into the car's declared range. Without a declared range nothing is
 * touched — the same rule as upstream's _limita_temperatura.
 *
 * @param t requested °C
 * @param min vehicle min (already plausibility-checked)
 * @param max vehicle max (already plausibility-checked)
 */
export function clampTemperature(t: number, min: number | undefined, max: number | undefined): number {
    if (min == null || max == null) {
        return t;
    }
    return Math.min(Math.max(t, min), max);
}
