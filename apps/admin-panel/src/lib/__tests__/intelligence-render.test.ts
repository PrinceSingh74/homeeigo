/**
 * PHASE 9 - Capability 12, the render guards.
 *
 * These are the mandatory negative tests: the specific strings and values that must never reach an
 * executive's screen. Every case below is one that a plain `?? 0` or `String(v)` would get wrong.
 */
import { describe, test, expect } from "bun:test";
import {
  MISSING, MISSING_SHORT,
  isRenderableNumber, isRenderableString,
  renderNumber, renderPercent, renderScore, renderItemValue,
  isDegradedState, renderScheduleField,
} from "../intelligence-render";

/** Everything the platform can legitimately fail to know. */
const ABSENT: unknown[] = [null, undefined, NaN, Infinity, -Infinity, {}, [], "", "   ", "[object Object]", "undefined", "null"];

describe("undefined, NaN and [object Object] are never rendered", () => {
  test("no absent value produces a number", () => {
    for (const v of ABSENT) {
      expect(renderNumber(v)).toBe(MISSING);
      expect(renderPercent(v)).toBe(MISSING);
      expect(renderScore(v)).toBe(MISSING);
    }
  });

  test("no absent value produces a renderable item value", () => {
    for (const v of ABSENT) {
      const r = renderItemValue(v);
      expect(r.missing).toBe(true);
      expect(r.text).toBe(MISSING_SHORT);
    }
  });

  test("the forbidden strings never appear in any output", () => {
    const outputs = ABSENT.flatMap((v) => [
      renderNumber(v), renderPercent(v), renderScore(v), renderItemValue(v).text,
    ]);
    for (const out of outputs) {
      expect(out.includes("undefined")).toBe(false);
      expect(out.includes("NaN")).toBe(false);
      expect(out.includes("Infinity")).toBe(false);
      expect(out.includes("[object Object]")).toBe(false);
      expect(out.includes("null")).toBe(false);
    }
  });
});

describe("a missing figure is never shown as zero", () => {
  /**
   * The failure this prevents: an unavailable finance source rendering as a bad quarter. `0` and
   * "we do not know" are opposite claims, and only one of them is ever true.
   */
  test("nothing absent renders as 0, 0% or 0/100", () => {
    for (const v of ABSENT) {
      expect(renderNumber(v)).not.toBe("0");
      expect(renderPercent(v)).not.toBe("0%");
      expect(renderScore(v)).not.toBe("0/100");
    }
  });

  test("a real zero still renders as zero", () => {
    // Zero is a measurement. Suppressing it would be the same defect in the other direction.
    expect(renderNumber(0)).toBe("0");
    expect(renderPercent(0)).toBe("0%");
    expect(renderScore(0)).toBe("0/100");
    expect(renderItemValue(0)).toEqual({ text: "0", missing: false });
  });

  test("negative figures survive — netRevenue is legitimately negative today", () => {
    expect(renderNumber(-10070.7)).toBe("-10,070.7");
    expect(renderPercent(-5465.77)).toBe("-5465.77%");
    expect(renderItemValue(-10070.7).missing).toBe(false);
  });
});

describe("degraded states are never shown as healthy", () => {
  /** Every state string capabilities 1-11 actually emit for a figure that must not be trusted. */
  const DEGRADED = [
    "STALE", "KPI_STALE", "UNAVAILABLE", "KPI_UNAVAILABLE", "MODEL_UNAVAILABLE",
    "FORECAST_STALE", "FORECAST_UNAVAILABLE", "DATA_QUALITY_ISSUE", "KPI_DATA_QUALITY",
    "NOT_IMPLEMENTED", "INSUFFICIENT_DATA", "UNSTABLE_BASELINE", "THRESHOLD_UNSET",
    "SCOPE_MISMATCH", "FAILED",
  ];

  test("every known degraded state is flagged", () => {
    for (const s of DEGRADED) expect(isDegradedState(s)).toBe(true);
  });

  test("a healthy state is not flagged", () => {
    for (const s of ["OK", "EVALUATED", "PRESENT", "CLEAN", "KPI_STABLE", "FORECAST_AVAILABLE"]) {
      expect(isDegradedState(s)).toBe(false);
    }
  });

  /**
   * A state this UI has never seen is treated as degraded, not as healthy.
   *
   * The alternative — a positive list of known-good states — would render any future state a
   * capability adds as if it were fine, which is exactly how a new warning becomes invisible.
   */
  test("stale is never mistaken for current", () => {
    expect(isDegradedState("FORECAST_STALE")).toBe(true);
    expect(isDegradedState("STALE")).toBe(true);
    // The word appears inside the state, so a substring match cannot be fooled by a prefix.
    expect(isDegradedState("DEMAND_FORECAST_STALE")).toBe(true);
  });
});

describe("a missing schedule is never displayed as scheduled", () => {
  test("each unset field reads as Not set", () => {
    expect(renderScheduleField(null)).toBe("Not set");
  });

  /** The four values a schedule must never be silently filled with. */
  test("no business default is invented", () => {
    const out = renderScheduleField(null);
    for (const forbidden of ["08:00", "09:00", "daily", "weekly", "Asia/Kolkata", "recipient-local"]) {
      expect(out.includes(forbidden)).toBe(false);
    }
  });

  test("a configured value passes through unchanged", () => {
    expect(renderScheduleField("07:30")).toBe("07:30");
    expect(renderScheduleField("weekly")).toBe("weekly");
  });
});

describe("the type guards are honest", () => {
  test("isRenderableNumber accepts only finite numbers", () => {
    expect(isRenderableNumber(0)).toBe(true);
    expect(isRenderableNumber(-1.5)).toBe(true);
    for (const v of [NaN, Infinity, -Infinity, "1", null, undefined, {}]) {
      expect(isRenderableNumber(v)).toBe(false);
    }
  });

  test("isRenderableString rejects the shapes that look like data but are not", () => {
    expect(isRenderableString("GENERATED")).toBe(true);
    for (const v of ["", "  ", "[object Object]", "undefined", "null", 1, null, {}]) {
      expect(isRenderableString(v)).toBe(false);
    }
  });
});

describe("no-vacuous-test guard", () => {
  /**
   * Most assertions above are of the form "this bad thing does not happen", which passes trivially
   * against a function that returns a constant. These prove the functions actually discriminate.
   */
  test("the renderers really do produce different output for good and bad input", () => {
    expect(renderNumber(1234.5)).toBe("1,234.5");
    expect(renderNumber(null)).toBe(MISSING);
    expect(renderNumber(1234.5)).not.toBe(renderNumber(null));

    expect(renderItemValue("STALE").text).toBe("STALE");
    expect(renderItemValue(null).text).toBe(MISSING_SHORT);

    expect(isDegradedState("STALE")).not.toBe(isDegradedState("OK"));
    expect(renderScheduleField("07:30")).not.toBe(renderScheduleField(null));
  });

  test("the absent-value list is real and covers every shape", () => {
    expect(ABSENT.length).toBeGreaterThanOrEqual(12);
    expect(ABSENT.some((v) => v === null)).toBe(true);
    expect(ABSENT.some((v) => typeof v === "number" && Number.isNaN(v))).toBe(true);
    expect(ABSENT.some((v) => typeof v === "object" && v !== null)).toBe(true);
    expect(ABSENT.some((v) => v === "[object Object]")).toBe(true);
  });
});
