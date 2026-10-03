/**
 * PHASE 12 CLOSURE — the demand forecast has one staleness contract, and every consumer inherits it.
 *
 * ── The defect this locks shut ─────────────────────────────────────────────────
 *
 * `ML.FORECAST` projects forward from the end of *training* data, not from now. Two independent
 * inference paths called it:
 *
 *   analytics/forecast/demand-forecast.service.ts   → /api/analytics/*        (1 route)
 *   vertex-ai.service.forecastDemand()
 *     → geo-intelligence.service.demandForecast()   → 8 consumers
 *
 * A previous pass guarded the first and described the second as having "six consumers" — it has
 * eight, including surge pricing, the digital twin, the AI tool handler and the ML boundary. The
 * unguarded path returned a June window stamped `freshness: <now>` and `source: bigquery:arima_plus`.
 *
 * The repair puts the check at the source using the *existing* `isDemandForecastStale`, so there is
 * one definition of stale demand rather than ten. These tests assert that property structurally,
 * because it is the kind of thing a future consumer silently opts out of.
 */
import { describe, test, expect } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { isDemandForecastStale, DEMAND_STALE_AFTER_HOURS } from "../services/shift-planning.service";

const SRC = join(import.meta.dir, "..");
const read = (p: string) => readFileSync(join(SRC, p), "utf8");

/**
 * The one file that declares `isDemandForecastStale`. Fails loudly if there is not exactly one —
 * two definitions of "stale demand" is the defect this whole file exists to prevent.
 */
function findSoleDefinitionFile(): string {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        if (entry === "node_modules" || entry === "__tests__") continue;
        walk(full);
      } else if (entry.endsWith(".ts")) {
        files.push(full);
      }
    }
  };
  walk(SRC);
  const declaring = files.filter((f) => /export function isDemandForecastStale/.test(readFileSync(f, "utf8")));
  expect(declaring.length).toBe(1);
  return declaring[0]!;
}

describe("there is one definition of stale demand", () => {
  test("the canonical helper reads the forecast window, not the fetch time", () => {
    const now = Date.parse("2026-09-04T00:00:00Z");
    const expired = { points: [{ hour: "2026-06-21 05:00" }] };
    const current = { points: [{ hour: "2026-09-04 18:00" }] };

    // A forecast fetched right now whose window closed in June is stale.
    expect(isDemandForecastStale(new Date(now).toISOString(), expired, now)).toBe(true);
    // One whose window runs into tonight is not.
    expect(isDemandForecastStale(new Date(now).toISOString(), current, now)).toBe(false);
  });

  test("an unreadable or absent horizon reads as stale, never as fresh", () => {
    const now = Date.parse("2026-09-04T00:00:00Z");
    expect(isDemandForecastStale(new Date(now).toISOString(), { points: [{ hour: "not-a-time" }] }, now)).toBe(true);
    expect(isDemandForecastStale(null, { points: [] }, now)).toBe(true);
  });

  test("no consumer restates the staleness rule with its own constant", () => {
    /**
     * The failure this prevents is two consumers disagreeing about whether the same forecast was
     * stale. Only the module that defines the rule may name the threshold.
     */
    const consumers = [
      "services/geo-intelligence.service.ts",
      "services/digital-twin.service.ts",
      "services/dynamic-pricing.service.ts",
      "services/demand-supply-warning.service.ts",
      "services/executive-intelligence.service.ts",
      "services/forecast-explainer.service.ts",
    ];
    for (const c of consumers) {
      const src = read(c);
      // The constant may be imported, never redefined.
      expect(src).not.toMatch(/const\s+DEMAND_STALE_AFTER_HOURS\s*=/);
    }
    expect(DEMAND_STALE_AFTER_HOURS).toBe(24);
  });
});

describe("the guard lives at the source, so consumers inherit it", () => {
  test("geo-intelligence computes staleness with the canonical helper", () => {
    /**
     * The invariant is "imports the sole definition", not "imports from this path".
     *
     * This asserted `from "./shift-planning.service"`. The rule was later moved into
     * `lib/demand-forecast-freshness.ts` so geo-intelligence could use it WITHOUT an import cycle —
     * exactly the outcome this test wants — and shift-planning now re-exports it. The property held
     * and the test failed anyway, because it pinned a location. Worse, a consumer that stopped
     * importing the helper and wrote its own check would still have satisfied the old assertion as
     * long as the string appeared somewhere.
     *
     * The canonical module is therefore located by finding the single definition, and the consumer
     * is required to import from it.
     */
    const definitionFile = findSoleDefinitionFile();
    const moduleName = basename(definitionFile).replace(/\.ts$/, "");

    const src = read("services/geo-intelligence.service.ts");

    // The import line that brings the helper in, wherever the canonical module now lives.
    const importLine = src
      .split("\n")
      .find((l) => l.trimStart().startsWith("import") && l.includes("isDemandForecastStale"));

    expect(importLine).toBeDefined();
    expect(importLine).toContain(moduleName);
    // And it must not have grown a private copy of the threshold.
    expect(src).not.toMatch(/const\s+DEMAND_STALE_AFTER_HOURS\s*=/);
  });

  test("an expired forecast stops calling itself a clean model forecast", () => {
    const src = read("services/geo-intelligence.service.ts");
    expect(src).toContain("bigquery:arima_plus:expired_horizon");
    // Confidence is floored rather than scaled: a stale forecast is about the wrong days,
    // not merely an uncertain one, and must not be blended in as such.
    expect(src).toMatch(/confidence:\s*stale\s*\?\s*0\s*:/);
  });

  test("the result states the window it actually describes", () => {
    const src = read("services/geo-intelligence.service.ts");
    for (const field of ["stale", "forecastWindow", "expiredByHours", "staleAfterHours", "limitations"]) {
      expect(src).toContain(field);
    }
  });

  test("negative prediction bounds are reported as invalid, not as low demand", () => {
    const src = read("services/geo-intelligence.service.ts");
    expect(src).toContain("negative lower bound");
  });
});

describe("derived signals refuse to be derived from an expired window", () => {
  /**
   * Surge is the case that matters most: a slope across past hours reported as "rising" is a
   * fabricated direction on a money-adjacent surface.
   */
  test("surge forecasting reports an unknown trend rather than inventing one", () => {
    const src = read("services/dynamic-pricing.service.ts");
    expect(src).toContain("UNAVAILABLE_STALE_FORECAST");
    // X-85 added a source-outage condition in front; staleness must still be part of usability.
    expect(src).toMatch(/const forecastUsable = [^;]*!demandData\?\.stale/);
    // An outage is its own basis, never reported as a stale forecast (X-85).
    expect(src).toContain("sourceUnavailable ? DEMAND_FORECAST_UNAVAILABLE");
    // The slope is only computed when the forecast is usable.
    expect(src).toMatch(/const slope = forecastUsable/);
  });

  /**
   * A withheld figure and a figure of zero are different claims. Zero reads as "no demand
   * expected", which is a prediction nobody made.
   */
  test("the digital twin withholds stale demand figures instead of sending zero", () => {
    const src = read("services/digital-twin.service.ts");
    expect(src).toContain("DEMAND_FORECAST_STALE");
    expect(src).toMatch(/forecast1h: null, forecast6h: null, forecast24h: null/);
    expect(src).toContain("forecastUnavailableReason");
  });
});

describe("the other inference path keeps its own guard", () => {
  test("the analytics forecast service refuses an expired horizon and falls back", () => {
    const src = read("../analytics/forecast/demand-forecast.service.ts");
    expect(src).toContain("EXPIRED_HORIZON");
    expect(src).toContain("deterministic_fallback");
    // Every arm carries a source, so a fallback can never be read as a warehouse forecast.
    expect(src).toMatch(/source: "warehouse"/);
    expect(src).toMatch(/source: "none"/);
  });

  test("a caller error is not answered with a fallback forecast", () => {
    const src = read("../analytics/forecast/demand-forecast.service.ts");
    // UNKNOWN_MODEL returns unavailable rather than silently answering about something else.
    expect(src).toMatch(/err\.reason === "UNKNOWN_MODEL"/);
  });
});

describe("the ETA model path is safe by construction", () => {
  test("a missing model returns null so the caller falls back to the route provider", () => {
    const src = read("services/vertex-ai.service.ts");
    // predictEta swallows the error and returns null; the caller must then use Google.
    expect(src).toMatch(/return null; \/\/ model not trained yet/);
    const geo = read("services/geo-intelligence.service.ts");
    expect(geo).toContain("google:distance_matrix");
    // And the source is never reported as the model when the model did not answer.
    expect(geo).toMatch(/modelEta != null/);
  });
});
