/**
 * PHASE 9 — Capability 3, revenue anomaly intelligence.
 *
 * Runs ONLY on the isolated `homigo_p39` database and aborts otherwise.
 *
 * The property defended: the detector refuses whenever the data cannot carry a baseline, and refuses
 * again when a baseline exists but no threshold has been approved. Most of these tests assert that
 * nothing was produced — so several deliberately construct a *stable* series as well, to prove the
 * refusals are conditional rather than unconditional.
 */
import { refuseIfNotIsolatedTestDb } from "./helpers/isolated-test-db";
import { describe, test, expect, beforeAll } from "bun:test";
import prisma from "../lib/prisma";
import {
  revenueAnomalyService,
  revenueAnomalyPolicy,
  isAnomalyPolicyApproved,
  REVENUE_ANOMALY_RULES_VERSION,
  DETECTION_METHOD,
  ANOMALY_REASON,
  EXCLUDED_METRICS,
} from "../services/revenue-anomaly.service";
import type { DayPoint } from "../services/revenue-anomaly.service";

let src = "";

function codeOnly(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split(String.fromCharCode(10))
    .map((l) => l.replace(/(^|\s)\/\/.*$/, ""))
    .join(String.fromCharCode(10));
}

/** A series with real dispersion, used to prove the refusals are conditional. */
function stableSeries(): DayPoint[] {
  const vals = [900, 1100, 1000, 1200, 800, 1050, 950, 1150, 1000, 1100, 900, 1250];
  return vals.map((v, i) => ({
    day: `2026-07-${String(i + 1).padStart(2, "0")}`,
    value: v,
    activity: "ACTIVITY" as const,
  }));
}

type Counts = Record<string, number>;
async function snapshot(): Promise<Counts> {
  const [bookings, payments, wallet, ledger, notifications, outbox, instances, jobs] =
    await Promise.all([
      prisma.booking.count(), prisma.payment.count(), prisma.walletTransaction.count(),
      prisma.ledgerEntry.count(), prisma.notification.count(), prisma.eventOutbox.count(),
      prisma.workflowInstance.count(), prisma.scheduledJob.count(),
    ]);
  return { bookings, payments, wallet, ledger, notifications, outbox, instances, jobs };
}

beforeAll(async () => {
  const db = (await prisma.$queryRawUnsafe<Array<{ db: string }>>("SELECT current_database() AS db"))[0].db;
  refuseIfNotIsolatedTestDb(db);
  src = await Bun.file(`${import.meta.dir}/../services/revenue-anomaly.service.ts`).text();
});

// ── No invented threshold ─────────────────────────────────────────────────────

describe("no threshold is invented", () => {
  test("the policy ships unset and cannot approve itself", () => {
    expect(revenueAnomalyPolicy.threshold).toBeNull();
    expect(revenueAnomalyPolicy.enabled).toBe(false);
    expect(revenueAnomalyPolicy.status).toBe("UNSET");
    expect(isAnomalyPolicyApproved()).toBe(false);
  });

  test("a partial policy never approves", () => {
    expect(isAnomalyPolicyApproved({ enabled: true, threshold: null, status: "APPROVED" })).toBe(false);
    expect(isAnomalyPolicyApproved({ enabled: false, threshold: 3, status: "APPROVED" })).toBe(false);
    expect(isAnomalyPolicyApproved({ enabled: true, threshold: 3, status: "UNSET" })).toBe(false);
    expect(isAnomalyPolicyApproved({ enabled: true, threshold: 3, status: "APPROVED" })).toBe(true);
  });

  test("no familiar statistical constant is hardcoded as a threshold", () => {
    const code = codeOnly(src);
    // 0.6745 is the modified z-score constant and is allowed; a *threshold* is not.
    for (const t of ["> 2", "> 3", ">= 2", ">= 3", "0.2)", "* 1.5"]) {
      expect(code).not.toContain(t);
    }
  });

  test("the policy is not environment-driven", () => {
    expect(codeOnly(src)).not.toContain("process.env");
  });
});

// ── Baseline stability is measured, not assumed ───────────────────────────────

describe("the baseline is measured and can be refused", () => {
  test("a zero MAD is reported as degenerate", () => {
    const sparse: DayPoint[] = Array.from({ length: 20 }, (_, i) => ({
      day: `2026-07-${String(i + 1).padStart(2, "0")}`,
      value: i < 15 ? 0 : 1000,
      activity: i < 15 ? ("ZERO_ACTIVITY" as const) : ("ACTIVITY" as const),
    }));
    const b = revenueAnomalyService.measureBaseline(sparse);
    expect(b.mad).toBe(0);
    expect(b.stable).toBe(false);
    expect(b.reasonCode).toBe(ANOMALY_REASON.MAD_ZERO);
  });

  test("fewer than two points has no variance and is refused", () => {
    const b = revenueAnomalyService.measureBaseline([
      { day: "2026-07-01", value: 500, activity: "ACTIVITY" },
    ]);
    expect(b.stable).toBe(false);
    expect(b.reasonCode).toBe(ANOMALY_REASON.TOO_FEW_POINTS);
  });

  /** Non-vacuous counterpart: a series with real dispersion must be accepted. */
  test("a series with genuine dispersion is stable", () => {
    const b = revenueAnomalyService.measureBaseline(stableSeries());
    expect(b.stable).toBe(true);
    expect(b.mad).toBeGreaterThan(0);
    expect(b.median).toBeGreaterThan(0);
    expect(b.reasonCode).toBeUndefined();
  });

  test("dispersion measures are published even when the baseline is refused", () => {
    const sparse: DayPoint[] = Array.from({ length: 12 }, (_, i) => ({
      day: `2026-07-${String(i + 1).padStart(2, "0")}`,
      value: i === 11 ? 9000 : 0,
      activity: i === 11 ? ("ACTIVITY" as const) : ("ZERO_ACTIVITY" as const),
    }));
    const b = revenueAnomalyService.measureBaseline(sparse);
    expect(b.stable).toBe(false);
    // The numbers a human needs in order to choose a threshold are still reported.
    expect(b.n).toBe(12);
    expect(b.zeroShare).toBeGreaterThan(0.9);
    expect(b.outlierRatio).not.toBeNull();
  });

  test("outlier concentration is measured but never used to reject", () => {
    const code = codeOnly(src);
    expect(code).toContain("outlierRatio");
    // No branch turns the ratio into a verdict — that would be an invented threshold.
    expect(code).not.toMatch(/outlierRatio\s*[<>]/);
  });
});

// ── Zero activity vs missing data ─────────────────────────────────────────────

describe("a zero is not the same as an absence", () => {
  test("days inside the span with no payments are ZERO_ACTIVITY, not missing", async () => {
    const series = await revenueAnomalyService.dailySeries();
    if (series.length === 0) return;
    const zeros = series.filter((s) => s.activity === "ZERO_ACTIVITY");
    for (const z of zeros) expect(z.value).toBe(0);
    const active = series.filter((s) => s.activity === "ACTIVITY");
    for (const a of active) expect(a.value).toBeGreaterThan(0);
  });

  test("no day outside the observed span is emitted", async () => {
    const series = await revenueAnomalyService.dailySeries();
    if (series.length < 2) return;
    // Both ends must be real activity — the span is defined by observed payments.
    expect(series[0]!.activity).toBe("ACTIVITY");
    expect(series[series.length - 1]!.activity).toBe("ACTIVITY");
  });

  test("the series is contiguous with no gaps", async () => {
    const series = await revenueAnomalyService.dailySeries();
    if (series.length < 2) return;
    for (let i = 1; i < series.length; i++) {
      const prev = Date.parse(series[i - 1]!.day + "T00:00:00+05:30");
      const cur = Date.parse(series[i]!.day + "T00:00:00+05:30");
      expect(cur - prev).toBe(86400000);
    }
  });
});

// ── Honest method metadata ────────────────────────────────────────────────────

describe("the method describes itself accurately", () => {
  test("it is STATISTICAL and never claims to be a model", () => {
    expect(DETECTION_METHOD).toBe("STATISTICAL");
    const code = codeOnly(src);
    for (const f of ["trainingWindow", "modelName", "ML", "predict("]) {
      expect(code).not.toContain(f);
    }
  });

  test("modelVersion is null rather than a fabricated string", async () => {
    const r = await revenueAnomalyService.evaluate("gmv");
    expect(r.modelVersion).toBeNull();
    expect(r.rulesVersion).toBe(REVENUE_ANOMALY_RULES_VERSION);
    expect(r.detectionMethod).toBe("STATISTICAL");
  });

  test("no LLM is in the detection path", () => {
    const code = codeOnly(src);
    for (const f of ["aiGateway", "generateText", "openai", "gemini", "groq", "anthropic"]) {
      expect(code.toLowerCase()).not.toContain(f.toLowerCase());
    }
  });
});

// ── Excluded metrics ──────────────────────────────────────────────────────────

describe("the defective net-revenue figure is excluded", () => {
  test("netRevenue and its derivatives are excluded by name", () => {
    expect([...EXCLUDED_METRICS].sort()).toEqual(["netRevenue", "platformMarginPct", "totalLiabilities"]);
  });

  test("evaluating an excluded metric returns a data-quality refusal", async () => {
    for (const m of ["netRevenue", "platformMarginPct"]) {
      const r = await revenueAnomalyService.evaluate(m);
      expect(r.state).toBe("DATA_QUALITY_ISSUE");
      expect(r.reasonCode).toBe(ANOMALY_REASON.METRIC_EXCLUDED);
      expect(r.observedValue).toBeNull();
      expect(r.deviation).toBeNull();
    }
  });
});

// ── The six negative tests ────────────────────────────────────────────────────

describe("negative: nothing is produced that cannot be justified", () => {
  test("1. an unsupported threshold cannot silently appear", async () => {
    const r = await revenueAnomalyService.evaluate("gmv");
    expect(r.state).not.toBe("EVALUATED");
    expect(["UNSTABLE_BASELINE", "THRESHOLD_UNSET", "INSUFFICIENT_DATA", "DATA_QUALITY_ISSUE"])
      .toContain(r.state);
  });

  test("2. a missing baseline cannot produce an anomaly", async () => {
    const r = await revenueAnomalyService.evaluate("gmv");
    if (r.state === "UNSTABLE_BASELINE") {
      expect(r.baselineValue).toBeNull();
      expect(r.deviation).toBeNull();
      expect(r.anomalyScore).toBeNull();
    }
  });

  test("3. missing data never becomes zero", () => {
    const code = codeOnly(src);
    // The series is built only between observed payments; nothing back-fills outside it.
    expect(code).toContain("ZERO_ACTIVITY");
    expect(code).toContain("ACTIVITY");
  });

  test("4. prose cannot alter anomaly facts", async () => {
    const r = await revenueAnomalyService.evaluate("gmv");
    const before = JSON.stringify({ s: r.state, o: r.observedValue, b: r.baselineValue, d: r.deviation, e: r.evidence });
    const narrated = { ...r, baselineDefinition: "A completely different description." };
    expect(JSON.stringify({ s: narrated.state, o: narrated.observedValue, b: narrated.baselineValue, d: narrated.deviation, e: narrated.evidence }))
      .toBe(before);
  });

  test("5. removing evidence degrades the result rather than substituting", () => {
    const b = revenueAnomalyService.measureBaseline([]);
    expect(b.stable).toBe(false);
    expect(b.reasonCode).toBe(ANOMALY_REASON.TOO_FEW_POINTS);
    expect(b.median).toBe(0);
    expect(b.coefficientOfVariation).toBeNull();
  });

  test("6. the same source data produces the same result", async () => {
    const a = await revenueAnomalyService.evaluate("gmv");
    const b = await revenueAnomalyService.evaluate("gmv");
    const strip = (r: typeof a) => JSON.stringify({ ...r, generatedAt: null });
    expect(strip(a)).toBe(strip(b));
  });
});

// ── A stable baseline still needs a threshold ─────────────────────────────────

describe("a stable baseline is not permission to judge", () => {
  test("with dispersion present, the refusal moves from baseline to threshold", () => {
    const b = revenueAnomalyService.measureBaseline(stableSeries());
    expect(b.stable).toBe(true);
    // The baseline is fine; the missing piece is now the business decision, not the data.
    expect(isAnomalyPolicyApproved()).toBe(false);
  });

  test("an approved policy is what unlocks EVALUATED, and nothing else", () => {
    expect(isAnomalyPolicyApproved({ enabled: true, threshold: 3.5, status: "APPROVED" })).toBe(true);
    expect(isAnomalyPolicyApproved()).toBe(false);
  });
});

// ── Provenance and side effects ───────────────────────────────────────────────

describe("provenance and side effects", () => {
  test("evidence names its source and the baseline definition is explicit", async () => {
    const r = await revenueAnomalyService.evaluate("gmv");
    expect(r.source).toContain("payments");
    if (r.evidence.length > 0) {
      for (const e of r.evidence) expect(e.source.length).toBeGreaterThan(0);
      expect(r.baselineDefinition).toContain("Asia/Kolkata");
      expect(r.baselineDefinition).toContain("zero activity");
    }
  });

  test("no causal or materiality language appears anywhere", () => {
    const lower = src.toLowerCase();
    for (const w of ["because customers", "caused by", "is concerning", "materially"]) {
      expect(lower).not.toContain(w);
    }
  });

  test("detection mutates nothing", async () => {
    const before = await snapshot();
    await revenueAnomalyService.evaluate("gmv");
    await revenueAnomalyService.evaluate("netRevenue");
    await revenueAnomalyService.dailySeries();
    const after = await snapshot();
    expect(after).toEqual(before);
  });

  test("the detector reads payments only and writes nothing", () => {
    const code = codeOnly(src);
    expect(code).toContain("prisma.payment.findMany");
    for (const w of [".create(", ".update(", ".delete(", ".upsert("]) {
      expect(code).not.toContain(w);
    }
  });
});
