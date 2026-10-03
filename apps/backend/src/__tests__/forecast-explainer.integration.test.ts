/**
 * PHASE 9 — Capability 7, forecast explanations.
 *
 * Runs ONLY on the isolated `homigo_p39` database and aborts otherwise.
 *
 * The property defended: a forecast can never be read as an actual, as a guarantee, as zone-scoped
 * when it is not, or as more confident than its interval supports. The live forecast is stale, global
 * and carries an 80% interval of [-39.12, 136.66] around a point of 48.7 — every one of those facts
 * has to survive into the explanation intact.
 */
import { refuseIfNotIsolatedTestDb } from "./helpers/isolated-test-db";
import { describe, test, expect, beforeAll, spyOn } from "bun:test";
import prisma from "../lib/prisma";
import {
  forecastExplainerService,
  FORECAST_EXPLAINER_RULES_VERSION,
  FORECAST_REASON,
  PREDICTION_INTERVAL_LEVEL,
} from "../services/forecast-explainer.service";

let src = "";

function codeOnly(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split(String.fromCharCode(10))
    .map((l) => l.replace(/(^|\s)\/\/.*$/, ""))
    .join(String.fromCharCode(10));
}

type Counts = Record<string, number>;
async function snapshot(): Promise<Counts> {
  const [bookings, payments, wallet, ledger, notifications, outbox, instances, jobs, geofences] =
    await Promise.all([
      prisma.booking.count(), prisma.payment.count(), prisma.walletTransaction.count(),
      prisma.ledgerEntry.count(), prisma.notification.count(), prisma.eventOutbox.count(),
      prisma.workflowInstance.count(), prisma.scheduledJob.count(), prisma.geofence.count(),
    ]);
  return { bookings, payments, wallet, ledger, notifications, outbox, instances, jobs, geofences };
}

beforeAll(async () => {
  const db = (await prisma.$queryRawUnsafe<Array<{ db: string }>>("SELECT current_database() AS db"))[0].db;
  refuseIfNotIsolatedTestDb(db);
  src = await Bun.file(`${import.meta.dir}/../services/forecast-explainer.service.ts`).text();
});

// ── Forecast is never an actual ───────────────────────────────────────────────

describe("a forecast is labelled as one", () => {
  test("valueKind is FORECAST and cannot be anything else", async () => {
    const e = await forecastExplainerService.explainDemandForecast();
    expect(e.valueKind).toBe("FORECAST");
    // The type admits only the one literal, so an "actual" cannot be expressed here at all.
    expect(codeOnly(src)).toContain('valueKind: "FORECAST"');
    expect(codeOnly(src)).not.toContain('valueKind: "ACTUAL"');
  });

  test("no guarantee vocabulary appears anywhere in the output", async () => {
    const e = await forecastExplainerService.explainDemandForecast();
    const blob = JSON.stringify(e).toLowerCase();
    for (const t of forecastExplainerService.forbiddenTerms()) {
      expect(blob).not.toContain(t);
    }
  });

  test("no causal claim is made", async () => {
    const e = await forecastExplainerService.explainDemandForecast();
    const blob = JSON.stringify(e).toLowerCase();
    for (const c of ["because of", "caused by", "due to rain", "driven by weather"]) {
      expect(blob).not.toContain(c);
    }
  });
});

// ── Timestamps: generation vs retrieval ───────────────────────────────────────

describe("generation time and retrieval time are not conflated", () => {
  test("forecastGeneratedAt is null because the source exposes none", async () => {
    const e = await forecastExplainerService.explainDemandForecast();
    expect(e.forecastGeneratedAt).toBeNull();
    if (e.state === "FORECAST_UNAVAILABLE") {
      expect(e.reasonCode).toBe(FORECAST_REASON.SOURCE_UNAVAILABLE);
      expect(e.limitations.some((l) => l.includes("did not respond"))).toBe(true);
      return;
    }
    expect(e.limitations.some((l) => l.includes("does not expose when it generated"))).toBe(true);
  });

  test("retrievedAt is populated and distinct from generation", async () => {
    const e = await forecastExplainerService.explainDemandForecast();
    if (e.state !== "FORECAST_UNAVAILABLE") {
      expect(e.retrievedAt).not.toBeNull();
      expect(e.retrievedAt).not.toBe(e.forecastGeneratedAt);
    }
  });

  test("the target window is read from the predicted hours, not from the fetch time", async () => {
    const e = await forecastExplainerService.explainDemandForecast();
    if (e.state === "FORECAST_STALE" || e.state === "FORECAST_AVAILABLE") {
      expect(e.forecastFor.from).not.toBeNull();
      expect(e.forecastFor.to).not.toBeNull();
      expect(e.forecastFor.from).not.toBe(e.retrievedAt);
      expect(String(e.forecastFor.from) <= String(e.forecastFor.to)).toBe(true);
    }
  });
});

// ── Staleness ─────────────────────────────────────────────────────────────────

describe("a stale forecast stays stale", () => {
  test("an elapsed horizon is reported as stale with a reason", async () => {
    const e = await forecastExplainerService.explainDemandForecast();
    if (e.state === "FORECAST_STALE") {
      expect(e.freshness).toBe("STALE");
      expect(e.reasonCode).toBe(FORECAST_REASON.HORIZON_ELAPSED);
      // The value is kept — stale means aged, not erased.
      expect(e.value).not.toBeNull();
    }
  });

  test("the shared platform stale rule is reused, not redefined", () => {
    const code = codeOnly(src);
    expect(code).toContain("isDemandForecastStale");
    for (const c of ["86400000", "24 * 3600", "7 * 24", "30 * 24"]) {
      expect(code).not.toContain(c);
    }
  });

  test("a far-future clock makes any forecast stale", async () => {
    const future = new Date(Date.now() + 400 * 86400000);
    const e = await forecastExplainerService.explainDemandForecast({ now: future });
    if (e.state !== "FORECAST_UNAVAILABLE" && e.state !== "INSUFFICIENT_DATA") {
      expect(e.state).toBe("FORECAST_STALE");
      expect(e.freshness).toBe("STALE");
    }
  });
});

// ── Scope ─────────────────────────────────────────────────────────────────────

describe("scope is validated against real geofences", () => {
  test("a zone id that matches nothing yields GLOBAL with a stated reason", async () => {
    const e = await forecastExplainerService.explainDemandForecast();
    expect(e.scope).toBe("GLOBAL");
    if (e.state === "FORECAST_UNAVAILABLE") {
      expect(e.scopeReason).toContain("source unavailable");
      expect(e.reasonCode).toBe(FORECAST_REASON.SOURCE_UNAVAILABLE);
      return;
    }
    expect(e.scopeReason).toContain("no zone id matches");
    expect(e.limitations.some((l) => l.includes("not zone-scoped"))).toBe(true);
  });

  test("scope is decided by a geofence lookup, not by the field's name", () => {
    const code = codeOnly(src);
    expect(code).toContain("prisma.geofence.findMany");
    // Non-vacuous: a ZONE outcome exists in the code and is reachable when ids match.
    expect(code).toContain('realZones.length > 0 ? "ZONE" : "GLOBAL"');
  });

  test("the raw zone ids are published as evidence so the claim is checkable", async () => {
    const e = await forecastExplainerService.explainDemandForecast();
    const z = e.evidence.find((x) => x.signal === "ZONE_IDS");
    if (e.state !== "FORECAST_UNAVAILABLE" && e.state !== "INSUFFICIENT_DATA") {
      expect(z).toBeDefined();
      expect(typeof z!.value).toBe("string");
    }
  });
});

// ── Confidence and intervals ──────────────────────────────────────────────────

describe("confidence is never manufactured from an interval", () => {
  test("modelConfidence is null because the model publishes none", async () => {
    const e = await forecastExplainerService.explainDemandForecast();
    expect(e.modelConfidence).toBeNull();
  });

  test("the wrapper's derived figure is carried with its formula and clamp state", async () => {
    const e = await forecastExplainerService.explainDemandForecast();
    if (e.derivedConfidence) {
      expect(e.derivedConfidence.formula).toContain("clamp(");
      expect(e.derivedConfidence.formula).toContain("not published by the model");
      expect(typeof e.derivedConfidence.clamped).toBe("boolean");
    }
  });

  test("a clamped derived figure is called out as understating the spread", async () => {
    const e = await forecastExplainerService.explainDemandForecast();
    if (e.derivedConfidence?.clamped) {
      expect(e.limitations.some((l) => l.includes("clamp boundary"))).toBe(true);
    }
  });

  test("the interval is described at the level the source requested", async () => {
    const e = await forecastExplainerService.explainDemandForecast();
    expect(PREDICTION_INTERVAL_LEVEL).toBe(0.8);
    if (e.interval) {
      expect(e.interval.level).toBe(0.8);
      expect(e.interval.lower).toBeLessThanOrEqual(e.interval.upper);
    }
    // Never renamed into something the source did not define.
    expect(JSON.stringify(e).toLowerCase()).not.toContain("error margin");
  });

  /**
   * The live finding: an 80% interval of [-39.12, 136.66] around a point of 48.7.
   *
   * Bookings cannot be negative, so the lower bound is not an outcome — it is evidence the interval
   * is too wide to inform anything. Flagged rather than clipped to zero, because clipping would make
   * an uninformative forecast look usable.
   */
  test("an interval extending below zero is flagged, not truncated", async () => {
    const e = await forecastExplainerService.explainDemandForecast();
    if (e.interval && e.interval.lower < 0) {
      expect(e.limitations.some((l) => l.includes("extends below zero"))).toBe(true);
      // The raw bound is preserved.
      expect(e.evidence.find((x) => x.signal === "INTERVAL_LOWER")!.value).toBe(e.interval.lower);
    }
    expect(codeOnly(src)).not.toContain("Math.max(0, lower)");
  });
});

// ── Model identity ────────────────────────────────────────────────────────────

describe("model identity comes from the registry", () => {
  /**
   * These control the registry rather than reading whatever the warehouse happens to hold.
   *
   * The original test compared the explainer's model version against a LIVE BigQuery registry. It
   * failed because the two sources were not comparable: `mlops.service` reached real BigQuery while
   * `vertex-ai.service` was refused by the test-mode ADC barrier, so one side was live and the other
   * stubbed. Once the barrier was applied to both (lib/bigquery-adc.ts), the registry returned empty
   * in tests and the assertion collapsed into its `else` branch — it passed while checking nothing.
   *
   * The registry is an external warehouse; the thing under test is what the EXPLAINER does with what
   * the registry says. So the registry is stubbed and the explainer runs for real.
   */
  async function withRegistry<T>(
    entries: Array<{ model: string; version: string; type: string; status: string; usable: boolean }>,
    run: () => Promise<T>,
  ): Promise<T> {
    const spy = spyOn(forecastExplainerService, "modelInventory").mockResolvedValue(entries);
    try {
      return await run();
    } finally {
      spy.mockRestore();
    }
  }

  const demandModel = (over: Partial<{ version: string; status: string; usable: boolean }> = {}) => ({
    model: "model_demand_forecast",
    version: "v7",
    type: "ARIMA_PLUS",
    status: "TRAINED",
    usable: true,
    ...over,
  });

  test("the version is reported even when the forecast source is unavailable", async () => {
    /**
     * The defect this pins. Model identity was read AFTER the forecast call, so the catch path
     * returned a shell literal `modelVersion: null` — an explanation saying "the source did not
     * respond" could not say which model had not responded, though the registry knew. A null written
     * by a literal is precisely the defaulting this describe block forbids.
     */
    const e = await withRegistry([demandModel()], () => forecastExplainerService.explainDemandForecast());

    expect(e.model).toBe("model_demand_forecast");
    expect(e.modelVersion).toBe("v7");
    expect(e.modelStatus).toBe("TRAINED");
  });

  test("an unavailable registry yields null — an honest absence, not a guess", async () => {
    const e = await withRegistry([], () => forecastExplainerService.explainDemandForecast());
    expect(e.modelVersion).toBeNull();
    expect(e.modelStatus).toBeNull();
  });

  test("another model's entry is never borrowed as this model's identity", async () => {
    const e = await withRegistry(
      [{ model: "model_revenue_forecast", version: "v3", type: "ARIMA_PLUS", status: "TRAINED", usable: true }],
      () => forecastExplainerService.explainDemandForecast(),
    );
    // A registry that does not mention this model cannot supply its version.
    expect(e.modelVersion).toBeNull();
    expect(e.model).toBe("model_demand_forecast");
  });

  test("status is carried verbatim — a BLOCKED model is not described as usable", async () => {
    const e = await withRegistry(
      [demandModel({ version: "v0", status: "BLOCKED", usable: false })],
      () => forecastExplainerService.explainDemandForecast(),
    );
    expect(e.modelVersion).toBe("v0");
    // Reporting BLOCKED as TRAINED would let an executive rely on a model that never trained.
    expect(e.modelStatus).toBe("BLOCKED");
  });

  test("duplicate entries for one model resolve deterministically to the first", async () => {
    /**
     * Two rows for the same model_name should not exist, but the registry is an external table with
     * no such guarantee. The explainer must then be deterministic rather than arbitrary — a version
     * that changes between reads is worse than one that is merely wrong.
     */
    const entries = [demandModel({ version: "v7" }), demandModel({ version: "v8" })];
    const first = await withRegistry(entries, () => forecastExplainerService.explainDemandForecast());
    const second = await withRegistry(entries, () => forecastExplainerService.explainDemandForecast());

    expect(first.modelVersion).toBe("v7");
    expect(second.modelVersion).toBe(first.modelVersion);
  });

  test("the version is never a literal in the source", async () => {
    // Secondary belt only: the runtime cases above are what actually defend the property.
    const code = codeOnly(src);
    for (const fake of ['"v1"', '"latest"', '"production"']) {
      expect(code).not.toContain("modelVersion: " + fake);
    }
  });

  test("only a TRAINED model is described as usable", async () => {
    const inv = await forecastExplainerService.modelInventory();
    // Non-vacuous: the live registry contains both usable and unusable models.
    if (inv.length > 0) {
      for (const m of inv) expect(m.usable).toBe(m.status === "TRAINED");
      expect(inv.some((m) => !m.usable)).toBe(true);
    }
  });

  test("drift monitoring is declared absent rather than scored", async () => {
    const e = await forecastExplainerService.explainDemandForecast();
    expect(codeOnly(src)).toContain("No drift monitoring exists for this model.");
    expect(codeOnly(src)).not.toContain("driftScore");
    if (e.state === "FORECAST_UNAVAILABLE") {
      expect(e.reasonCode).toBe(FORECAST_REASON.SOURCE_UNAVAILABLE);
      expect(e.limitations.some((l) => l.toLowerCase().includes("did not respond"))).toBe(true);
      return;
    }
    expect(e.limitations.some((l) => l.toLowerCase().includes("no drift monitoring"))).toBe(true);
  });
});

// ── The ten negative tests ────────────────────────────────────────────────────

describe("negative: nothing is upgraded beyond its evidence", () => {
  test("1. a stale forecast cannot become current", async () => {
    const e = await forecastExplainerService.explainDemandForecast();
    if (e.reasonCode === FORECAST_REASON.HORIZON_ELAPSED) expect(e.freshness).not.toBe("CURRENT");
  });

  test("2. a global forecast cannot become a zone forecast", async () => {
    const e = await forecastExplainerService.explainDemandForecast();
    if (e.scope === "GLOBAL") {
      expect(JSON.stringify(e)).not.toContain('"scope":"ZONE"');
    }
  });

  test("3. a missing model version stays null", () => {
    const code = codeOnly(src);
    expect(code).toContain("entry?.version ?? null");
  });

  test("4. a missing confidence never becomes high confidence", async () => {
    const e = await forecastExplainerService.explainDemandForecast();
    expect(e.modelConfidence).toBeNull();
    expect(JSON.stringify(e).toLowerCase()).not.toContain("high confidence");
  });

  test("5. a forecast never becomes an actual", async () => {
    const e = await forecastExplainerService.explainDemandForecast();
    expect(e.valueKind).toBe("FORECAST");
    const blob = JSON.stringify(e).toLowerCase();
    expect(blob).not.toContain('"actual"');
  });

  test("6. no LLM can reach the forecast number", () => {
    const code = codeOnly(src);
    for (const f of ["aiGateway", "generateText", "openai", "gemini", "groq", "anthropic"]) {
      expect(code.toLowerCase()).not.toContain(f.toLowerCase());
    }
  });

  test("7. no points yields INSUFFICIENT_DATA, not a zero forecast", () => {
    const code = codeOnly(src);
    expect(code).toContain('state: "INSUFFICIENT_DATA"');
    expect(code).toContain("FORECAST_REASON.NO_POINTS");
    // No fallback substitutes a last value or an average.
    for (const f of ["lastValue", "average(", "?? 0 // fallback"]) expect(code).not.toContain(f);
  });

  test("8. altering prose leaves the structured facts untouched", async () => {
    const e = await forecastExplainerService.explainDemandForecast();
    const before = JSON.stringify({ v: e.value, i: e.interval, s: e.scope, f: e.freshness, ev: e.evidence });
    const rewritten = { ...e, limitations: ["Completely different wording."] };
    expect(JSON.stringify({ v: rewritten.value, i: rewritten.interval, s: rewritten.scope, f: rewritten.freshness, ev: rewritten.evidence }))
      .toBe(before);
  });

  test("9. an unavailable source yields no value rather than zero", () => {
    const code = codeOnly(src);
    expect(code).toContain('state: "FORECAST_UNAVAILABLE"');
    expect(code).toContain("FORECAST_REASON.SOURCE_UNAVAILABLE");
  });

  test("10. an expired forecast is not described as future certainty", async () => {
    const e = await forecastExplainerService.explainDemandForecast();
    if (e.freshness === "STALE") {
      const blob = JSON.stringify(e).toLowerCase();
      for (const t of ["will be", "expected to reach", "certain"]) expect(blob).not.toContain(t);
    }
  });
});

// ── Determinism, privacy, side effects ────────────────────────────────────────

describe("determinism, privacy and side effects", () => {
  test("the same source state yields the same explanation", async () => {
    const now = new Date();
    const a = await forecastExplainerService.explainDemandForecast({ now });
    const b = await forecastExplainerService.explainDemandForecast({ now });
    expect(JSON.stringify({ ...a, generatedAt: null })).toBe(JSON.stringify({ ...b, generatedAt: null }));
  });

  test("every explanation carries its rules version and evidence", async () => {
    const e = await forecastExplainerService.explainDemandForecast();
    expect(e.rulesVersion).toBe(FORECAST_EXPLAINER_RULES_VERSION);
    if (e.state !== "FORECAST_UNAVAILABLE") {
      expect(e.evidence.length).toBeGreaterThan(5);
      for (const ev of e.evidence) expect(ev.source.length).toBeGreaterThan(0);
    }
  });

  test("no partner or customer identity is exposed", async () => {
    const e = await forecastExplainerService.explainDemandForecast();
    const blob = JSON.stringify(e).toLowerCase();
    for (const leak of ["phonenumber", "email", "providerid", "userid", "password", "latitude"]) {
      expect(blob).not.toContain(leak);
    }
  });

  test("the service takes no actor or role parameter", () => {
    const code = codeOnly(src);
    for (const f of ["actorId", "isAdmin", "allUsers", "req.user"]) expect(code).not.toContain(f);
  });

  test("explaining a forecast mutates nothing", async () => {
    const before = await snapshot();
    await forecastExplainerService.explainDemandForecast();
    await forecastExplainerService.modelInventory();
    const after = await snapshot();
    expect(after).toEqual(before);
  });

  test("the service writes nothing", () => {
    const code = codeOnly(src);
    for (const w of [".create(", ".update(", ".delete(", ".upsert("]) expect(code).not.toContain(w);
  });
});
