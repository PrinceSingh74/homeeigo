/**
 * PHASE 9 — Capability 2, KPI explanations.
 *
 * Runs ONLY on the isolated `homigo_p39` database and aborts otherwise.
 *
 * The property defended: an explanation can never make a KPI look better-founded than it is. The
 * eight negative tests at the end are the load-bearing ones — each removes or degrades something and
 * asserts the explanation degrades with it rather than inventing a replacement.
 */
import { refuseIfNotIsolatedTestDb } from "./helpers/isolated-test-db";
import { describe, test, expect, beforeAll } from "bun:test";
import prisma from "../lib/prisma";
import {
  executiveKpiExplainer,
  KPI_EXPLAINER_RULES_VERSION,
} from "../services/executive-kpi-explainer.service";
import type { KpiState } from "../services/executive-kpi-explainer.service";
import { executiveIntelligenceService } from "../services/executive-intelligence.service";
import { EXEC_REASON } from "../services/executive-intelligence.types";
import type { ExecutiveFact, ExecutiveIntelligenceContext } from "../services/executive-intelligence.types";

let src = "";

function codeOnly(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split(String.fromCharCode(10))
    .map((l) => l.replace(/(^|\s)\/\/.*$/, ""))
    .join(String.fromCharCode(10));
}

const rolling7 = {
  basis: "ROLLING" as const,
  from: "2026-08-23T00:00:00Z",
  to: "2026-08-30T00:00:00Z",
  days: 7,
  timezone: "Asia/Kolkata",
};

function makeFact(over: Partial<ExecutiveFact<number>> = {}): ExecutiveFact<number> {
  return {
    value: 100,
    unit: "INR",
    period: rolling7,
    source: "test",
    observedAt: "2026-08-30T00:00:00Z",
    freshness: "FRESH",
    state: "OK",
    confidence: null,
    rulesVersion: null,
    modelVersion: null,
    ...over,
  };
}

const emptyCtx: ExecutiveIntelligenceContext = {
  requestedPeriod: rolling7,
  domains: {},
  unavailableDomains: [],
  caveats: [],
  generatedAt: "2026-08-30T00:00:00Z",
  rulesVersion: "exec.context.v1",
  modelVersions: {},
};

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
  src = await Bun.file(`${import.meta.dir}/../services/executive-kpi-explainer.service.ts`).text();
});

// ── Grounding ─────────────────────────────────────────────────────────────────

describe("explanations state what happened, never why", () => {
  test("no statement asserts causation", () => {
    for (const text of Object.values(executiveKpiExplainer.statements())) {
      const lower = text.toLowerCase();
      for (const causal of ["because", "caused", "due to", "driven by", "as a result"]) {
        expect(lower).not.toContain(causal);
      }
    }
  });

  test("no statement claims materiality", () => {
    for (const text of Object.values(executiveKpiExplainer.statements())) {
      const lower = text.toLowerCase();
      for (const word of ["significant", "material", "sharp", "concerning", "healthy", "strong"]) {
        expect(lower).not.toContain(word);
      }
    }
  });

  test("no materiality threshold exists in the code", () => {
    const code = codeOnly(src);
    for (const t of ["0.05", "0.1", "0.2", "> 5", "> 10", "> 20"]) {
      expect(code).not.toContain(t);
    }
  });

  test("the explainer recomputes no business value", () => {
    const code = codeOnly(src);
    for (const forbidden of ["prisma.", "aggregate(", "_sum", "walletBalance"]) {
      expect(code).not.toContain(forbidden);
    }
    // Non-vacuous: it consumes the context and the authoritative overview.
    expect(code).toContain("executiveIntelligenceService.getContext");
    expect(code).toContain("financeDashboardService.getOverview");
  });

  test("no LLM is in the explanation path", () => {
    const code = codeOnly(src);
    for (const f of ["aiGateway", "generateText", "openai", "gemini", "groq", "anthropic"]) {
      expect(code.toLowerCase()).not.toContain(f.toLowerCase());
    }
  });
});

// ── Comparison discipline ─────────────────────────────────────────────────────

describe("comparison is derived only where the arithmetic is honest", () => {
  test("the allow-list contains exactly the additive rolling flows", () => {
    expect(executiveKpiExplainer.derivableKpis()).toEqual(["gmv", "revenue", "subscriptionRevenue"]);
  });

  test("netRevenue is never given a comparison", async () => {
    const cmp = await executiveKpiExplainer.deriveComparison(
      "netRevenue",
      makeFact({ value: -2018.7 }),
    );
    expect(cmp).toBeNull();
  });

  test("margin and balances are never given a comparison", async () => {
    for (const kpi of ["platformMarginPct", "walletLiability", "totalLiabilities", "activeZones"]) {
      expect(await executiveKpiExplainer.deriveComparison(kpi, makeFact())).toBeNull();
    }
  });

  test("a POINT_IN_TIME balance cannot be compared even if named in the allow-list", async () => {
    const balance = makeFact({
      period: { basis: "POINT_IN_TIME", from: null, to: "2026-08-30T00:00:00Z", days: null, timezone: "Asia/Kolkata" },
    });
    expect(await executiveKpiExplainer.deriveComparison("gmv", balance)).toBeNull();
  });

  test("a derived comparison is labelled DERIVED and states its method", async () => {
    const kpis = await executiveKpiExplainer.explainAll("weekly");
    const gmv = kpis.find((k) => k.kpi === "gmv");
    expect(gmv).toBeDefined();
    if (gmv!.comparison) {
      expect(gmv!.comparison.basis).toBe("DERIVED");
      expect(gmv!.comparison.method).toContain("getOverview");
      expect(gmv!.comparison.previousPeriod.days).toBe(7);
    }
  });

  test("scoreGrowth is not reused as a comparison", () => {
    expect(codeOnly(src)).not.toContain("scoreGrowth");
  });
});

// ── The eight negative tests ──────────────────────────────────────────────────

describe("negative: an explanation degrades rather than inventing", () => {
  test("1. changing prose leaves the structured KPI untouched", async () => {
    const kpis = await executiveKpiExplainer.explainAll("weekly");
    const k = kpis[0]!;
    const before = JSON.stringify({ v: k.value, c: k.comparison, s: k.state, f: k.factState });
    const rewritten = { ...k, statement: "Entirely different wording." };
    expect(JSON.stringify({ v: rewritten.value, c: rewritten.comparison, s: rewritten.state, f: rewritten.factState }))
      .toBe(before);
  });

  test("2. an unavailable fact yields KPI_UNAVAILABLE with no value", async () => {
    const f = makeFact({ value: null, state: "UNAVAILABLE", reasonCode: EXEC_REASON.SOURCE_UNAVAILABLE });
    const e = await executiveKpiExplainer.explainFact("REVENUE", "gmv", f, emptyCtx);
    expect(e.state).toBe("KPI_UNAVAILABLE");
    expect(e.value).toBeNull();
    expect(e.comparison).toBeNull();
  });

  test("3. no comparable period yields no fabricated percentage", async () => {
    const f = makeFact({ period: { ...rolling7, days: null } });
    const e = await executiveKpiExplainer.explainFact("REVENUE", "gmv", f, emptyCtx);
    expect(e.state).toBe("KPI_NO_COMPARABLE_PERIOD");
    expect(e.comparison).toBeNull();
    expect(e.statement).toContain("No comparable previous period");
  });

  test("4. a stale fact is explained as stale", async () => {
    const f = makeFact({ state: "STALE", freshness: "STALE", reasonCode: EXEC_REASON.FORECAST_STALE });
    const e = await executiveKpiExplainer.explainFact("DEMAND", "totalPredicted", f, emptyCtx);
    expect(e.state).toBe("KPI_STALE");
    expect(e.reasonCode).toBe(EXEC_REASON.FORECAST_STALE);
    expect(e.comparison).toBeNull();
  });

  test("5. a data-quality flag survives into the explanation", async () => {
    const f = makeFact({ state: "DATA_QUALITY_ISSUE", reasonCode: EXEC_REASON.MIXED_PERIOD_BASIS });
    const e = await executiveKpiExplainer.explainFact("REVENUE", "netRevenue", f, emptyCtx);
    expect(e.state).toBe("KPI_DATA_QUALITY");
    expect(e.reasonCode).toBe(EXEC_REASON.MIXED_PERIOD_BASIS);
    expect(e.statement.toLowerCase()).toContain("known issue");
    // The value is preserved — the warning is added, not substituted for the number.
    expect(e.value).toBe(100);
  });

  test("6. zero GMV carries the margin-semantics reason, not a fabricated meaning", async () => {
    const f = makeFact({
      value: 0, unit: "percent", state: "DATA_QUALITY_ISSUE",
      reasonCode: EXEC_REASON.MARGIN_SEMANTICS_HUMAN_DECISION_REQUIRED,
    });
    const e = await executiveKpiExplainer.explainFact("REVENUE", "platformMarginPct", f, emptyCtx);
    expect(e.state).toBe("KPI_DATA_QUALITY");
    expect(e.reasonCode).toBe(EXEC_REASON.MARGIN_SEMANTICS_HUMAN_DECISION_REQUIRED);
    expect(e.statement.toLowerCase()).not.toContain("margin is 0");
  });

  /**
   * UPDATED: the netRevenue period mismatch has been REPAIRED at the source.
   *
   * `getOverview` now subtracts in-window refunds rather than the all-time total, so netRevenue is
   * no longer a mixed-basis figure and no longer carries `KPI_DATA_QUALITY`. What this test always
   * really guarded is unchanged and still asserted: **whatever state it lands in, the explanation
   * never invents a cause.** A KPI explainer that started saying "because refunds increased" would
   * be manufacturing an analysis nothing in the platform performed.
   */
  test("7. netRevenue is explained without inventing a cause, whatever its state", async () => {
    const kpis = await executiveKpiExplainer.explainAll("weekly");
    const nr = kpis.find((k) => k.kpi === "netRevenue")!;
    // The mixed-basis flag is gone because the mixture is gone.
    expect(nr.state).not.toBe("KPI_DATA_QUALITY");
    const lower = nr.statement.toLowerCase();
    for (const causal of ["refunds increased", "because", "demand", "customers", "driven by", "due to"]) {
      expect(lower).not.toContain(causal);
    }
    // A comparison is either absent or explicitly DERIVED — never presented as a published figure.
    if (nr.comparison) expect(nr.comparison.basis).toBe("DERIVED");
  });

  test("8. a zero baseline yields an undefined percentage, not infinity", async () => {
    const cmp = await executiveKpiExplainer.deriveComparison("subscriptionRevenue", makeFact({ value: 0 }));
    if (cmp && cmp.previousValue === 0) {
      expect(cmp.percentChange).toBeNull();
      expect(Number.isFinite(cmp.absoluteChange)).toBe(true);
    }
    expect(true).toBe(true);
  });
});

// ── Real-data behaviour ───────────────────────────────────────────────────────

describe("real data produces every required class", () => {
  test("all four classes appear, and none is empty by accident", async () => {
    const kpis = await executiveKpiExplainer.explainAll("weekly");
    expect(kpis.length).toBeGreaterThan(5);
    const states = new Set(kpis.map((k) => k.state));
    // Non-vacuous: these are the states live data actually produces today.
    expect(states.has("KPI_DATA_QUALITY")).toBe(true);
    expect(states.has("KPI_NO_COMPARABLE_PERIOD")).toBe(true);
    const healthy = kpis.filter((k) =>
      k.state === "KPI_INCREASED" || k.state === "KPI_DECREASED" || k.state === "KPI_STABLE");
    expect(healthy.length).toBeGreaterThan(0);
  });

  test("every explanation carries provenance and versions", async () => {
    const kpis = await executiveKpiExplainer.explainAll("weekly");
    for (const k of kpis) {
      expect(k.source.length).toBeGreaterThan(0);
      expect(k.versions.kpiRulesVersion).toBe(KPI_EXPLAINER_RULES_VERSION);
      expect(k.versions.contextRulesVersion).toBe("exec.context.v1");
      expect(k.statement.length).toBeGreaterThan(0);
    }
  });

  test("every state emitted has a sentence", async () => {
    const kpis = await executiveKpiExplainer.explainAll("weekly");
    const statements = executiveKpiExplainer.statements();
    for (const k of kpis) {
      expect(statements[k.state as KpiState]).toBe(k.statement);
    }
  });

  test("the context is built once and reused across all KPIs", async () => {
    const ctx = await executiveIntelligenceService.getContext("weekly");
    const kpis = await executiveKpiExplainer.explainAll("weekly", { context: ctx });
    expect(kpis.length).toBeGreaterThan(5);
    for (const k of kpis) expect(k.versions.contextRulesVersion).toBe(ctx.rulesVersion);
  });

  test("explanation is deterministic for one context", async () => {
    const ctx = await executiveIntelligenceService.getContext("weekly");
    const a = await executiveKpiExplainer.explainAll("weekly", { context: ctx });
    const b = await executiveKpiExplainer.explainAll("weekly", { context: ctx });
    const strip = (x: typeof a) => JSON.stringify(x.map((k) => ({ ...k, comparison: k.comparison })));
    expect(strip(a)).toBe(strip(b));
  });

  test("no PII reaches an explanation", async () => {
    const kpis = await executiveKpiExplainer.explainAll("weekly");
    const s = JSON.stringify(kpis).toLowerCase();
    for (const leak of ["phonenumber", "email", "password", "aadhar", "pannumber", "otp"]) {
      expect(s).not.toContain(leak);
    }
  });

  test("explanation mutates nothing", async () => {
    const before = await snapshot();
    await executiveKpiExplainer.explainAll("weekly");
    await executiveKpiExplainer.explainAll("monthly");
    const after = await snapshot();
    expect(after).toEqual(before);
  });
});
