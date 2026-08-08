import { describe, expect, test } from "bun:test";
import {
  DemandForecastService,
  ForecastUnavailableError,
} from "../../analytics/forecast/demand-forecast.service";

const svc = new DemandForecastService();

describe("forecast model routing", () => {
  test("exposes only scope/granularity pairs that have a trained model", () => {
    const models = svc.listAvailableModels();
    expect(models.length).toBeGreaterThan(0);
    for (const m of models) {
      expect(m.model.startsWith("model_")).toBe(true);
      expect(m.scope.length).toBeGreaterThan(0);
      expect(m.granularity.length).toBeGreaterThan(0);
    }
  });

  test("zone:hourly maps to the primary demand model", () => {
    const m = svc.listAvailableModels().find((x) => x.scope === "zone" && x.granularity === "hourly");
    expect(m?.model).toBe("model_demand_forecast");
  });

  test("an untrained combination fails as caller error, not a 500", async () => {
    // zone:monthly has no trained ARIMA_PLUS model.
    await expect(
      svc.forecastDetailed("zone", "monthly" as never),
    ).rejects.toBeInstanceOf(ForecastUnavailableError);
  });

  test("forecastSafe degrades instead of throwing", async () => {
    const result = await svc.forecastSafe("zone", "monthly" as never);
    expect(result.available).toBe(false);
    if (!result.available) {
      expect(result.reason).toContain("No trained model");
      expect(result.scope).toBe("zone");
    }
  });

  test("unknown scope is reported with the available options", async () => {
    const result = await svc.forecastSafe("galaxy" as never, "hourly");
    expect(result.available).toBe(false);
    if (!result.available) expect(result.reason).toContain("Available:");
  });
});

describe("forecast input bounds", () => {
  // Horizon drives BigQuery cost, so it must be clamped rather than trusted.
  const clamp = (g: "hourly" | "daily" | "weekly", h?: number) => {
    const defaults = { hourly: 24, daily: 7, weekly: 4 };
    const max = { hourly: 168, daily: 90, weekly: 52 };
    if (h === undefined || !Number.isFinite(h)) return defaults[g];
    return Math.max(1, Math.min(Math.floor(h), max[g]));
  };

  test("defaults apply when horizon is omitted", () => {
    expect(clamp("hourly")).toBe(24);
    expect(clamp("daily")).toBe(7);
    expect(clamp("weekly")).toBe(4);
  });

  test("NaN from a bad query string falls back to the default", () => {
    expect(clamp("hourly", Number("not-a-number"))).toBe(24);
  });

  test("Infinity cannot produce an unbounded query", () => {
    // Infinity is not finite, so it falls back to the default rather than the max —
    // the safer of the two outcomes, and the one that actually happens.
    expect(clamp("hourly", Number("1e999"))).toBe(24);
    expect(clamp("hourly", -Infinity)).toBe(24);
  });

  test("oversized and negative horizons are clamped into range", () => {
    expect(clamp("hourly", 1_000_000)).toBe(168);
    expect(clamp("daily", -5)).toBe(1);
    expect(clamp("weekly", 0)).toBe(1);
  });

  test("fractional horizons are floored to an integer", () => {
    expect(clamp("hourly", 12.9)).toBe(12);
  });

  const clampConf = (c?: number) =>
    c === undefined || !Number.isFinite(c) ? 0.9 : Math.max(0.5, Math.min(c, 0.99));

  test("confidence level stays inside the range BigQuery accepts", () => {
    expect(clampConf()).toBe(0.9);
    expect(clampConf(0.1)).toBe(0.5);
    expect(clampConf(2)).toBe(0.99);
    expect(clampConf(Number("x"))).toBe(0.9);
  });
});
