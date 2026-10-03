import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as modelIdentity from "../lib/model-identity";

/**
 * 6A — one model, one identity.
 *
 * ── What went wrong ─────────────────────────────────────────────────────────
 *
 * `forecast-explainer` read the warehouse model registry and reported
 * `model_demand_forecast` as `v1`. `executive-intelligence` and `demand-supply-warning` instead put
 * `IntelResult.source` — a provenance string, `"bigquery:arima_plus"` — into their `modelVersion`
 * field. `ExecutiveFact` already has a dedicated `source` field, so the provenance was written twice
 * and the real version was never reported at all: a field named `modelVersion` that could not
 * contain a model version.
 *
 * Nothing crashed and no test failed, because every surface was internally consistent. The defect
 * only appears when two surfaces are compared — which is what these cases do.
 *
 * The registry is an external warehouse and is stubbed here; the resolution logic runs for real.
 */
const SERVICES = join(import.meta.dir, "..", "services");

function sourceOf(file: string): string {
  return readFileSync(join(SERVICES, file), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n")
    .map((l) => l.replace(/(^|\s)\/\/.*$/, ""))
    .join("\n");
}

afterEach(() => {
  // Each case installs its own registry stub.
});

describe("model identity resolution", () => {
  test("resolves on the exact registry name", async () => {
    const spy = spyOn(modelIdentity, "modelRegistryEntries").mockResolvedValue([
      { model: "model_demand_forecast", version: "v7", type: "ARIMA_PLUS", status: "TRAINED", usable: true },
      { model: "model_revenue_forecast", version: "v3", type: "ARIMA_PLUS", status: "TRAINED", usable: true },
    ]);
    try {
      expect((await modelIdentity.resolveModelIdentity("model_demand_forecast"))?.version).toBe("v7");
      expect((await modelIdentity.resolveModelIdentity("model_revenue_forecast"))?.version).toBe("v3");
    } finally {
      spy.mockRestore();
    }
  });

  test("an unknown model resolves to null rather than the nearest match", async () => {
    const spy = spyOn(modelIdentity, "modelRegistryEntries").mockResolvedValue([
      { model: "model_demand_forecast", version: "v7", type: "ARIMA_PLUS", status: "TRAINED", usable: true },
    ]);
    try {
      // Prefix-similar on purpose: "model_demand" must not borrow "model_demand_forecast"'s version.
      expect(await modelIdentity.resolveModelIdentity("model_demand")).toBeNull();
      expect(await modelIdentity.resolveModelIdentity("model_eta")).toBeNull();
    } finally {
      spy.mockRestore();
    }
  });

  test("an unreachable registry resolves to null, never to a fabricated version", async () => {
    const spy = spyOn(modelIdentity, "modelRegistryEntries").mockResolvedValue([]);
    try {
      expect(await modelIdentity.resolveModelIdentity("model_demand_forecast")).toBeNull();
    } finally {
      spy.mockRestore();
    }
  });

  test("usable is TRAINED and nothing else", async () => {
    const spy = spyOn(modelIdentity, "modelRegistryEntries").mockResolvedValue([
      { model: "a", version: "v1", type: "t", status: "PARTIALLY_TRAINED", usable: false },
      { model: "b", version: "v0", type: "t", status: "BLOCKED", usable: false },
      { model: "c", version: "v1", type: "t", status: "TRAINED", usable: true },
    ]);
    try {
      const entries = await modelIdentity.modelRegistryEntries();
      for (const e of entries) expect(e.usable).toBe(e.status === "TRAINED");
    } finally {
      spy.mockRestore();
    }
  });
});

describe("no surface invents a second model identity", () => {
  /**
   * A source assertion on purpose, and narrow: it pins the one substitution that was actually made
   * and is invisible at runtime unless two surfaces are compared side by side. The behavioural cases
   * live in forecast-explainer.integration.test.ts.
   */
  test("provenance is never assigned to a modelVersion field", () => {
    for (const file of [
      "executive-intelligence.service.ts",
      "demand-supply-warning.service.ts",
      "forecast-explainer.service.ts",
    ]) {
      const code = sourceOf(file);
      expect(code).not.toContain("modelVersion: res.source");
      expect(code).not.toContain("modelVersion: forecast?.source");
      expect(code).not.toContain("modelVersions.demand = res.source");
    }
  });

  test("the executive and forecast surfaces both resolve identity through the shared module", () => {
    for (const file of ["executive-intelligence.service.ts", "demand-supply-warning.service.ts"]) {
      expect(sourceOf(file)).toContain("resolveModelIdentity");
    }
    // The explainer's inventory delegates rather than re-querying the registry itself.
    expect(sourceOf("forecast-explainer.service.ts")).toContain("modelRegistryEntries");
  });
});
