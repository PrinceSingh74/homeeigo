/**
 * PHASE 9 — Capability 5, finance narratives.
 *
 * Runs ONLY on the isolated `homigo_p39` database and aborts otherwise.
 *
 * Two properties are defended. That the ledger stays authoritative: every figure must equal what its
 * source returned, exactly, and no path may write. And that a narrative never explains a number away
 * — the known period mismatch must arrive flagged, never attributed to refunds.
 */
import { refuseIfNotIsolatedTestDb } from "./helpers/isolated-test-db";
import { describe, test, expect, beforeAll } from "bun:test";
import prisma from "../lib/prisma";
import {
  financeNarrativeService,
  FINANCE_NARRATIVE_RULES_VERSION,
  FINANCE_REASON,
  REVIEW_ACTIONS,
} from "../services/finance-narrative.service";
import { executiveIntelligenceService } from "../services/executive-intelligence.service";
import { financeDashboardService } from "../services/finance-dashboard.service";
import { EXEC_REASON } from "../services/executive-intelligence.types";

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
  const [bookings, payments, wallet, ledger, journals, notifications, outbox, instances, jobs, integrityRuns] =
    await Promise.all([
      prisma.booking.count(), prisma.payment.count(), prisma.walletTransaction.count(),
      prisma.ledgerEntry.count(), prisma.journalEntry.count(), prisma.notification.count(),
      prisma.eventOutbox.count(), prisma.workflowInstance.count(), prisma.scheduledJob.count(),
      prisma.financialIntegrityRun.count(),
    ]);
  return { bookings, payments, wallet, ledger, journals, notifications, outbox, instances, jobs, integrityRuns };
}

beforeAll(async () => {
  const db = (await prisma.$queryRawUnsafe<Array<{ db: string }>>("SELECT current_database() AS db"))[0].db;
  refuseIfNotIsolatedTestDb(db);
  src = await Bun.file(`${import.meta.dir}/../services/finance-narrative.service.ts`).text();
});

// ── Ledger authority ──────────────────────────────────────────────────────────

describe("the ledger stays authoritative", () => {
  test("every finance figure equals its source exactly", async () => {
    const r = await financeNarrativeService.build("monthly");
    const src30 = await financeDashboardService.getOverview(30);
    const get = (m: string) => r.narratives.find((n) => n.metric === m)?.value;

    // Non-vacuous: the report must actually contain narratives.
    expect(r.narratives.length).toBeGreaterThan(5);
    expect(get("walletLiability")).toBe(src30.walletLiability);
    expect(get("giftCardLiability")).toBe(src30.giftCardLiability);
    expect(get("cashbackLiability")).toBe(src30.cashbackLiability);
    expect(get("providerLiability")).toBe(src30.providerPayable);
    expect(get("chargebackExposure")).toBe(src30.chargebackExposure.amount);
    expect(get("gmv")).toBe(src30.gmv);
  });

  test("the service computes no financial value of its own", () => {
    const code = codeOnly(src);
    for (const f of ["_sum", "aggregate(", "reduce((", "+ balance", "- refund"]) {
      expect(code).not.toContain(f);
    }
    // Non-vacuous: it does consume the authoritative services.
    expect(code).toContain("ledgerReconciliationService.buildReport");
    expect(code).toContain("executiveIntelligenceService.getContext");
  });

  test("the mutating reconciliation and integrity entry points are never called", () => {
    const code = codeOnly(src);
    // `reconcile()` posts adjustment entries; `validate()`/`runChecks()` persist a run row.
    expect(code).not.toContain("reconcile(");
    expect(code).not.toContain(".validate(");
    expect(code).not.toContain("runChecks");
    expect(code).toContain("getLatestReport");
  });

  test("the service writes nothing", () => {
    const code = codeOnly(src);
    for (const w of [".create(", ".update(", ".delete(", ".upsert(", "$executeRaw"]) {
      expect(code).not.toContain(w);
    }
  });
});

// ── Period semantics and known defects ────────────────────────────────────────

describe("known defects survive into the narrative", () => {
  /**
   * UPDATED: the defect this test was written to pin has been REPAIRED at the source.
   *
   * `financeDashboardService.getOverview` now subtracts `refundsInPeriod` — refund requests
   * COMPLETED with `processedAt` inside the window — instead of the all-time refund total. Verified
   * against live data: 30-day GMV 21,283 minus in-period refunds 2,732 gives netRevenue 18,551,
   * where the old formula produced -10,070.70 by subtracting the all-time 11,912.70. The all-time
   * figure survives separately and correctly as `refundLiability`.
   *
   * So the assertion is inverted rather than deleted: netRevenue must now arrive **clean**, and both
   * of its terms must share one rolling window. A test that still demanded the flag would fail the
   * fix, and deleting it would leave the repair unguarded.
   */
  test("netRevenue arrives clean now that both terms share one window", async () => {
    const r = await financeNarrativeService.build("monthly");
    const nr = r.narratives.find((n) => n.metric === "netRevenue")!;
    expect(nr.type).not.toBe("FINANCE_DATA_QUALITY");
    expect(nr.state).not.toBe("DATA_QUALITY_ISSUE");
    expect(nr.reasonCode).not.toBe(EXEC_REASON.MIXED_PERIOD_BASIS);
    // The basis is now a single rolling window, not a mixture of two.
    expect(nr.periodBasis).not.toBe("MIXED");
    expect(nr.value).not.toBeNull();
  });

  /**
   * The repair itself, asserted against the authoritative source rather than the narrative.
   *
   * This is what makes the inversion above safe: if someone reverted the formula to the all-time
   * refund total, this fails immediately and by arithmetic, not by a label.
   */
  test("netRevenue equals in-window GMV minus in-window refunds", async () => {
    const overview = await financeDashboardService.getOverview(30);
    expect(Math.round((overview.gmv - overview.refundsInPeriod) * 100) / 100)
      .toBe(overview.netRevenue);
    // The all-time refund total still exists, and is not the term being subtracted.
    expect(overview.refundLiability).toBeGreaterThanOrEqual(0);
    if (overview.refundLiability !== overview.refundsInPeriod) {
      expect(Math.round((overview.gmv - overview.refundLiability) * 100) / 100)
        .not.toBe(overview.netRevenue);
    }
  });

  test("no narrative attributes a figure to refunds or any other cause", async () => {
    const r = await financeNarrativeService.build("monthly");
    for (const n of r.narratives) {
      const lower = n.statement.toLowerCase();
      for (const causal of ["because", "caused", "due to", "driven by", "refunds increased"]) {
        expect(lower).not.toContain(causal);
      }
    }
  });

  test("the statement table contains no causal or alarmist sentence", () => {
    for (const s of Object.values(financeNarrativeService.statements())) {
      const lower = s.toLowerCase();
      for (const w of ["because", "caused", "critical", "urgent", "alarming", "healthy"]) {
        expect(lower).not.toContain(w);
      }
    }
  });

  test("margin keeps its ambiguity rather than being resolved", async () => {
    const r = await financeNarrativeService.build("monthly");
    const m = r.narratives.find((n) => n.metric === "platformMarginPct")!;
    expect(m.type).toBe("FINANCE_MARGIN");
    expect(m.statement.toLowerCase()).toContain("cannot distinguish an undefined ratio");
    expect(m.state).toBe("DATA_QUALITY_ISSUE");
  });

  test("a balance is described as a balance, not as a period figure", async () => {
    const r = await financeNarrativeService.build("monthly");
    const w = r.narratives.find((n) => n.metric === "walletLiability")!;
    expect(w.type).toBe("FINANCE_LIQUIDITY");
    expect(w.periodBasis).toBe("POINT_IN_TIME");
    expect(w.statement.toLowerCase()).toContain("not a figure for the requested period");
  });
});

// ── Reconciliation ────────────────────────────────────────────────────────────

describe("reconciliation is surfaced, never resolved", () => {
  test("every finding reports both sides and their delta", async () => {
    const r = await financeNarrativeService.build("monthly");
    expect(r.reconciliation.findings.length).toBeGreaterThan(0);
    for (const f of r.reconciliation.findings) {
      expect(typeof f.operationalBalance).toBe("number");
      expect(typeof f.ledgerBalance).toBe("number");
      expect(typeof f.delta).toBe("number");
      expect(f.reasonCode.length).toBeGreaterThan(0);
    }
  });

  /**
   * The defect caught on the first real observation.
   *
   * "Pending Cashback (info)" compares cashback owed to customers against the PLATFORM_REVENUE
   * ledger account — different quantities with no reason to match. Treating its 36,176.80 delta as
   * drift produced a false DELTA_PRESENT.
   */
  test("an informational row is not counted as drift", async () => {
    const r = await financeNarrativeService.build("monthly");
    const info = r.reconciliation.findings.filter((f) => f.informational);
    if (info.length > 0) {
      for (const f of info) {
        expect(f.clean).toBe(true);
        expect(f.reasonCode).toBe(FINANCE_REASON.RECONCILIATION_INFORMATIONAL);
      }
      /**
       * Its delta is still reported — hiding it would be as wrong as counting it.
       *
       * Asserted as "present and numeric" rather than "non-zero": the first version required a
       * non-zero delta, which held on production data (36,176.80) and failed on the isolated
       * database where both sides are zero. A test must not encode one environment's numbers.
       */
      for (const f of info) expect(Number.isFinite(f.delta)).toBe(true);
    }
    const counted = r.reconciliation.findings.filter((f) => !f.informational && f.delta !== 0).length;
    expect(r.reconciliation.accountsWithDelta).toBe(counted);
  });

  test("no tolerance is applied to a real reconciliation row", () => {
    const code = codeOnly(src);
    // A tolerance would be a business judgement; exact equality is the only test used.
    expect(code).toContain("r.delta === 0");
    for (const t of ["Math.abs(r.delta)", "< 0.01", "< 1)"]) {
      expect(code).not.toContain(t);
    }
  });

  test("the state follows the counted deltas", async () => {
    const r = await financeNarrativeService.build("monthly");
    if (r.reconciliation.accountsWithDelta > 0) {
      expect(r.reconciliation.state).toBe("DELTA_PRESENT");
    } else {
      expect(r.reconciliation.state).toBe("CLEAN");
    }
  });

  test("integrity comes from a stored run and never triggers one", async () => {
    const before = await prisma.financialIntegrityRun.count();
    const r = await financeNarrativeService.build("monthly");
    const after = await prisma.financialIntegrityRun.count();
    expect(after).toBe(before);
    if (r.integrity.status !== null) {
      expect(r.integrity.observedAt).not.toBeNull();
    } else {
      expect(r.integrity.reasonCode).toBe(FINANCE_REASON.INTEGRITY_REPORT_ABSENT);
    }
  });
});

// ── Rounding, currency, signs ─────────────────────────────────────────────────

describe("presentation never becomes the fact", () => {
  test("the exact value is preserved while the display form rounds", () => {
    const exact = 90608.79999999992;
    const formatted = financeNarrativeService.format(exact, "INR");
    expect(formatted).toBe("INR 90608.80");
    // The rounded string is not the value, and nothing reads it back.
    expect(Number(formatted!.replace("INR ", ""))).not.toBe(exact);
  });

  test("a narrative carries both the exact value and the display form", async () => {
    const r = await financeNarrativeService.build("monthly");
    const p = r.narratives.find((n) => n.metric === "providerLiability")!;
    const src30 = await financeDashboardService.getOverview(30);
    expect(p.value).toBe(src30.providerPayable);
    expect(p.formatted).toBe(financeNarrativeService.format(src30.providerPayable, "INR"));
  });

  test("a null value formats to null, never to zero", () => {
    expect(financeNarrativeService.format(null, "INR")).toBeNull();
  });

  test("negative values keep their sign through formatting", () => {
    expect(financeNarrativeService.format(-2018.7, "INR")).toBe("INR -2018.70");
    expect(financeNarrativeService.format(-0.005, "INR")).toContain("-");
  });

  test("currency comes from the source, not from an assumption", () => {
    const code = codeOnly(src);
    // INR is read off the fact's unit; there is no unconditional default.
    expect(code).toContain('f.unit === "INR"');
    expect(code).not.toContain('currency = "INR"');
  });
});

// ── Advisory boundary ─────────────────────────────────────────────────────────

describe("a narrative can ask for review and nothing more", () => {
  test("every narrative declares it requires no approval because it does nothing", async () => {
    const r = await financeNarrativeService.build("monthly");
    for (const n of r.narratives) expect(n.requiresHumanApproval).toBe(false);
  });

  test("review actions are advisory sentences, never executable verbs", () => {
    for (const a of Object.values(REVIEW_ACTIONS)) {
      const lower = a.toLowerCase();
      expect(lower.startsWith("review") || lower.startsWith("investigate") || lower.startsWith("resolve")).toBe(true);
      for (const verb of ["execute", "issue refund", "credit", "adjust ", "approve"]) {
        expect(lower).not.toContain(verb);
      }
    }
  });

  test("flagged metrics attract a review prompt, clean ones do not", async () => {
    const r = await financeNarrativeService.build("monthly");
    const nr = r.narratives.find((n) => n.metric === "netRevenue")!;
    // netRevenue no longer needs a period-semantics review: the source was repaired. A metric that
    // is still flagged must still attract its prompt, which the remaining assertions cover.
    expect(nr.reviewActions).not.toContain(REVIEW_ACTIONS.REVIEW_PERIOD_SEMANTICS);
    const gmv = r.narratives.find((n) => n.metric === "gmv")!;
    expect(gmv.reviewActions).toEqual([]);
  });

  test("no approval or high-risk path is reachable from here", () => {
    const code = codeOnly(src);
    for (const f of ["createApprovalRequest", "consumeApproval", "high_risk", "refundService", "walletService"]) {
      expect(code).not.toContain(f);
    }
  });

  test("no LLM is in the narrative path", () => {
    const code = codeOnly(src);
    for (const f of ["aiGateway", "generateText", "openai", "gemini", "groq", "anthropic"]) {
      expect(code.toLowerCase()).not.toContain(f.toLowerCase());
    }
  });
});

// ── The six negative tests ────────────────────────────────────────────────────

describe("negative: the narrative degrades rather than inventing", () => {
  test("1. an unavailable fact yields FINANCE_UNAVAILABLE with no value", () => {
    const ctx = { rulesVersion: "exec.context.v1" } as never;
    const n = financeNarrativeService.narrateFact(
      "gmv",
      {
        value: null, period: { basis: "ROLLING", from: null, to: null, days: 7, timezone: "Asia/Kolkata" },
        source: "s", observedAt: null, freshness: "UNAVAILABLE", state: "UNAVAILABLE",
        confidence: null, rulesVersion: null, modelVersion: null, reasonCode: "SOURCE_UNAVAILABLE",
      },
      ctx,
    );
    expect(n.type).toBe("FINANCE_UNAVAILABLE");
    expect(n.value).toBeNull();
    expect(n.formatted).toBeNull();
  });

  test("2. altering prose leaves the finance facts unchanged", async () => {
    const r = await financeNarrativeService.build("monthly");
    const n = r.narratives[0]!;
    const before = JSON.stringify({ v: n.value, e: n.evidence, s: n.state, b: n.periodBasis });
    const rewritten = { ...n, statement: "Something else entirely." };
    expect(JSON.stringify({ v: rewritten.value, e: rewritten.evidence, s: rewritten.state, b: rewritten.periodBasis }))
      .toBe(before);
  });

  test("3. evidence always names an authoritative source, never a dashboard", async () => {
    const r = await financeNarrativeService.build("monthly");
    for (const n of r.narratives) {
      for (const e of n.evidence) {
        expect(e.source.length).toBeGreaterThan(0);
        expect(e.source.toLowerCase()).not.toContain("dashboard-ui");
        expect(e.periodBasis.length).toBeGreaterThan(0);
      }
    }
  });

  test("4. a mixed period cannot be described causally", async () => {
    const r = await financeNarrativeService.build("monthly");
    const mixed = r.narratives.filter((n) => n.periodBasis === "MIXED");
    expect(mixed.length).toBeGreaterThan(0);
    for (const n of mixed) {
      expect(n.statement.toLowerCase()).toContain("different period bases");
      expect(n.statement.toLowerCase()).not.toContain("because");
    }
  });

  test("5. zero GMV keeps the margin meaning undefined", async () => {
    const daily = await financeNarrativeService.build("daily");
    const m = daily.narratives.find((n) => n.metric === "platformMarginPct")!;
    expect(m.state).toBe("DATA_QUALITY_ISSUE");
    if (m.reasonCode === EXEC_REASON.MARGIN_SEMANTICS_HUMAN_DECISION_REQUIRED) {
      expect(m.statement.toLowerCase()).toContain("undefined ratio");
    }
  });

  test("6. the same context produces the same narrative", async () => {
    const ctx = await executiveIntelligenceService.getContext("monthly");
    const a = await financeNarrativeService.build("monthly", { context: ctx });
    const b = await financeNarrativeService.build("monthly", { context: ctx });
    expect(JSON.stringify(a.narratives)).toBe(JSON.stringify(b.narratives));
  });
});

// ── Privacy and side effects ──────────────────────────────────────────────────

describe("privacy and side effects", () => {
  test("no customer or payment identity reaches a narrative", async () => {
    const r = await financeNarrativeService.build("monthly");
    const s = JSON.stringify(r).toLowerCase();
    for (const leak of ["phonenumber", "email", "cardnumber", "upi", "accountnumber", "ifsc", "password"]) {
      expect(s).not.toContain(leak);
    }
  });

  test("the service takes no actor or role parameter", () => {
    const code = codeOnly(src);
    for (const f of ["actorId", "isAdmin", "allUsers", "req.user"]) {
      expect(code).not.toContain(f);
    }
  });

  test("building a narrative mutates nothing, including integrity runs", async () => {
    const before = await snapshot();
    await financeNarrativeService.build("monthly");
    await financeNarrativeService.build("weekly");
    await financeNarrativeService.readReconciliation();
    await financeNarrativeService.readIntegrity();
    const after = await snapshot();
    expect(after).toEqual(before);
  });

  test("versions are carried on every narrative", async () => {
    const r = await financeNarrativeService.build("monthly");
    expect(r.rulesVersion).toBe(FINANCE_NARRATIVE_RULES_VERSION);
    for (const n of r.narratives) {
      expect(n.rulesVersion).toBe(FINANCE_NARRATIVE_RULES_VERSION);
      expect(n.contextRulesVersion).toBe("exec.context.v1");
    }
  });
});
