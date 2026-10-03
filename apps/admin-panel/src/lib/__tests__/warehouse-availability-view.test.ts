/**
 * X-88 / X-90 — what the admin surfaces show when the warehouse is down.
 *
 * The routes now answer a stated `available: false` (no figures) instead of a 500. Read naively,
 * that would render as claims nobody measured: AI HQ's registry panel would say "Empty registry — no
 * models registered", the analytics page would show "Quality 0%" and an MLOps "—" indistinguishable
 * from a healthy registry without a status, and the ML page would print "0 observed day(s) over 0
 * calendar days" for a dataset that was never read.
 */
import { describe, expect, test } from "bun:test";
import { evaluationDatasetLine, mlRegistryView, pipelineView, registryTiles } from "../warehouse-availability-view";

describe("mlRegistryView (AI HQ)", () => {
  test("registry unavailable → unavailable, not 'empty registry'", () => {
    const v = mlRegistryView({ success: true, available: false, reasonCode: "ML_REGISTRY_SOURCE_UNAVAILABLE", cause: "CREDENTIALS", reason: "x", data: null }, false);
    expect(v.state).toBe("unavailable");
  });
  test("request failed → unavailable", () => {
    expect(mlRegistryView(undefined, true).state).toBe("unavailable");
  });
  test("loading → loading", () => {
    expect(mlRegistryView(undefined, false).state).toBe("loading");
  });
  test("a registry that answered with zero models is a measurement ('ready', total 0), not 'unavailable'", () => {
    const v = mlRegistryView({ success: true, available: true, data: { total: 0, trained: 0, partial: 0, blocked: 0, productionModels: 0, freshness: "t" } }, false);
    expect(v.state).toBe("ready");
    expect(v.health?.total).toBe(0);
  });
  test("a populated registry is 'ready' with its figures", () => {
    const v = mlRegistryView({ success: true, available: true, data: { total: 5, trained: 3, partial: 1, blocked: 1, productionModels: 2, freshness: "t" } }, false);
    expect(v.state).toBe("ready");
    expect(v.health?.total).toBe(5);
  });
});

describe("registryTiles (AI HQ) — X-91", () => {
  test("tiles are the registry's own fields under their own names — no invented 'Healthy'", () => {
    const tiles = registryTiles({ total: 5, trained: 3, partial: 1, blocked: 1, productionModels: 2, freshness: "t" });
    expect(tiles).toEqual([
      { label: "Models", value: "5" },
      { label: "Trained", value: "3" },
    ]);
  });
  test("an answering registry with zero models shows zeros (a measurement)", () => {
    const tiles = registryTiles({ total: 0, trained: 0, partial: 0, blocked: 0, productionModels: 0, freshness: "t" });
    expect(tiles.map((t) => t.value)).toEqual(["0", "0"]);
  });
});

describe("pipelineView (analytics page)", () => {
  test("warehouse down: quality not scored and MLOps unavailable — freshness still shown", () => {
    const v = pipelineView({
      freshness: 3, totalDatasets: 7, qualityScore: null, qualityUnavailable: true,
      mlops: { available: false, reasonCode: "ML_REGISTRY_SOURCE_UNAVAILABLE", cause: "CREDENTIALS", reason: "x", data: null },
    });
    expect(v.freshnessLabel).toBe("3 / 7");
    expect(v.qualityLabel).toBe("—");
    expect(v.mlopsLabel).toBe("Unavailable");
  });
  test("healthy: quality as before; MLOps shows the registry's own counts (X-91 — it read `status`, which the API never sends, so it was always '—')", () => {
    const v = pipelineView({ freshness: 7, totalDatasets: 7, qualityScore: 96.4, qualityUnavailable: false, mlops: { available: true, total: 4, trained: 3 } });
    expect(v.qualityLabel).toBe("96%");
    expect(v.mlopsLabel).toBe("3 / 4 trained");
  });

  test("a registry answer without counts is not rendered as a figure", () => {
    const v = pipelineView({ freshness: 7, totalDatasets: 7, qualityScore: 100, qualityUnavailable: false, mlops: { available: true } });
    expect(v.mlopsLabel).toBe("—");
  });
});

describe("evaluationDatasetLine (ML page)", () => {
  const base = {
    observedDays: 40, calendarDays: 42, imputedDays: 2, version: "abc123",
  };
  const split = { trainDays: 28, trainEnd: "2026-09-10", testStart: "2026-09-11", testEnd: "2026-09-24" };
  test("dataset never read (source unavailable) → no summary line of zeros", () => {
    expect(evaluationDatasetLine({ ...base, observedDays: 0, calendarDays: 0, imputedDays: 0, version: "unavailable" }, split)).toBeNull();
  });
  test("a read dataset keeps its summary", () => {
    expect(evaluationDatasetLine(base, split)).toContain("40 observed day(s) over 42 calendar days, 2 filled with zero");
  });
});
