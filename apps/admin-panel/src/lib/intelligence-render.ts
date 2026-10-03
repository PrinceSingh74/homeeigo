/**
 * Phase 9, Capability 12 — the rules for putting an intelligence value on screen.
 *
 * Extracted into one module because the same three mistakes are available on every screen that
 * renders a figure the platform might not know:
 *
 *   1. `?? 0` — a missing figure and a zero figure mean opposite things on a finance screen. One
 *      says "the platform does not know"; the other says "the platform measured nothing sold".
 *   2. `String(v)` on an object — produces `[object Object]`, which reads as a corrupted platform.
 *   3. Rendering a non-finite number — `NaN` and `Infinity` reach the DOM as words and look like data.
 *
 * Every function here refuses rather than guesses, and `MISSING` is the single spelling of "not
 * known" so a reader never has to work out whether a dash and a blank mean different things.
 */

/** The one way "the platform does not know this" is written. */
export const MISSING = "Not reported" as const;

/** A dash for dense table cells, where the full phrase would not fit. Paired with an sr-only label. */
export const MISSING_SHORT = "—" as const;

/** True only for a number that can be shown to a person without lying. */
export function isRenderableNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/**
 * A string safe to render.
 *
 * Refuses the empty string and `[object Object]`, both of which are the visible symptom of a value
 * that was never really there.
 */
export function isRenderableString(v: unknown): v is string {
  if (typeof v !== "string") return false;
  const s = v.trim();
  return s.length > 0 && s !== "[object Object]" && s !== "undefined" && s !== "null";
}

/** Formats a count or measure. Never invents a zero. */
export function renderNumber(v: unknown, opts?: { unit?: string; missing?: string }): string {
  if (!isRenderableNumber(v)) return opts?.missing ?? MISSING;
  const formatted = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(v);
  return opts?.unit ? `${formatted} ${opts.unit}` : formatted;
}

/** Formats a percentage. A missing margin is not 0%. */
export function renderPercent(v: unknown, opts?: { missing?: string }): string {
  return isRenderableNumber(v) ? `${v}%` : (opts?.missing ?? MISSING);
}

/** Formats a score out of 100. A missing score is not 0/100. */
export function renderScore(v: unknown, opts?: { missing?: string }): string {
  return isRenderableNumber(v) ? `${v}/100` : (opts?.missing ?? MISSING);
}

/**
 * Formats a brief item's value, whatever type it arrived as.
 *
 * Returns `missing` alongside the text so a caller can attach an accessible label rather than
 * leaving a screen reader to announce a bare dash.
 */
export function renderItemValue(
  value: unknown,
  unit?: string,
): { text: string; missing: boolean } {
  if (isRenderableNumber(value)) return { text: renderNumber(value, { unit }), missing: false };
  if (isRenderableString(value)) return { text: value.trim(), missing: false };
  return { text: MISSING_SHORT, missing: true };
}

/**
 * Whether a state carried from a producing service means "do not read this at face value".
 *
 * The list is the union of the state vocabularies capabilities 1-11 actually emit. It is a positive
 * test for known-degraded rather than a negative test for known-good, so a state this UI has never
 * seen is treated as degraded instead of quietly rendering as healthy.
 */
export function isDegradedState(state: string): boolean {
  return /STALE|UNAVAILABLE|DATA_QUALITY|NOT_IMPLEMENTED|INSUFFICIENT|UNSTABLE|THRESHOLD_UNSET|SCOPE_MISMATCH|FAILED|ERROR/.test(
    state,
  );
}

/**
 * The word shown for a schedule field that has no value.
 *
 * Deliberately not "08:00", "daily" or a timezone. Filling a blank schedule with a plausible default
 * would manufacture a business decision nobody has made.
 */
export function renderScheduleField(v: string | null): string {
  return v ?? "Not set";
}
