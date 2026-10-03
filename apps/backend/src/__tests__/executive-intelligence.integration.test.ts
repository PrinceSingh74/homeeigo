/**
 * PHASE 9 — Capability 1, Executive Intelligence Context.
 *
 * Runs ONLY on the isolated `homigo_p39` database and aborts otherwise.
 *
 * Two properties are defended. That the layer adds provenance and nothing else — every number must
 * equal what the authoritative service returned, byte for byte. And that it never launders a
 * problem: a mixed-basis figure, an undefined margin and a stale forecast must each arrive labelled,
 * because the value of this layer is entirely in what it refuses to smooth over.
 */
import { refuseIfNotIsolatedTestDb } from "./helpers/isolated-test-db";
import { describe, test, expect, beforeAll } from "bun:test";
import prisma from "../lib/prisma";
import { executiveIntelligenceService } from "../services/executive-intelligence.service";
import {
  EXECUTIVE_CONTEXT_RULES_VERSION,
  EXEC_REASON,
  fact,
  missingFact,
  suspectFact,
} from "../services/executive-intelligence.types";
import type { ExecutiveDomain, ExecutivePeriod } from "../services/executive-intelligence.types";
import { executiveReportingService } from "../services/executive-reporting.service";
import { CADENCE_DEFAULT_TIMEZONE } from "../notifications/governance/timezone";

let serviceSource = "";

function codeOnly(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split(String.fromCharCode(10))
    .map((l) => l.replace(/(^|\s)\/\/.*$/, ""))
    .join(String.fromCharCode(10));
}

const samplePeriod: ExecutivePeriod = {
  basis: "ROLLING", from: "2026-08-01T00:00:00Z", to: "2026-08-08T00:00:00Z",
  days: 7, timezone: "Asia/Kolkata",
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

/** Read-only context builder — ledger/outbox/notifications may change from async producers while getContext() runs in the combined serial suite. */
async function readOnlySideEffectSnapshot(): Promise<Omit<Counts, "ledger" | "notifications" | "outbox">> {
  const s = await snapshot();
  const { ledger: _l, notifications: _n, outbox: _o, ...rest } = s;
  return rest;
}

beforeAll(async () => {
  const db = (await prisma.$queryRawUnsafe<Array<{ db: string }>>("SELECT current_database() AS db"))[0].db;
  refuseIfNotIsolatedTestDb(db);
  serviceSource = await Bun.file(`${import.meta.dir}/../services/executive-intelligence.service.ts`).text();
});

// ── Fact constructors ─────────────────────────────────────────────────────────

describe("the fact contract cannot express a fabricated value", () => {
  test("a missing fact is null, never zero", () => {
    const f = missingFact<number>({
      state: "UNAVAILABLE", reasonCode: EXEC_REASON.SOURCE_UNAVAILABLE,
      source: "s", period: samplePeriod, unit: "INR",
    });
    expect(f.value).toBeNull();
    expect(f.confidence).toBeNull();
    expect(f.modelVersion).toBeNull();
    expect(f.rulesVersion).toBeNull();
    expect(f.freshness).toBe("UNAVAILABLE");
    expect(f.reasonCode).toBe(EXEC_REASON.SOURCE_UNAVAILABLE);
  });

  test("confidence and versions default to null rather than a plausible number", () => {
    const f = fact({ value: 10, period: samplePeriod, source: "s", observedAt: null });
    expect(f.confidence).toBeNull();
    expect(f.modelVersion).toBeNull();
    expect(f.rulesVersion).toBeNull();
    // No observedAt means the age is genuinely unknown — not fresh.
    expect(f.freshness).toBe("UNKNOWN");
  });

  test("a fact with an observation time is FRESH only because one was supplied", () => {
    const f = fact({ value: 10, period: samplePeriod, source: "s", observedAt: "2026-08-08T00:00:00Z" });
    expect(f.freshness).toBe("FRESH");
    expect(f.state).toBe("OK");
  });

  test("a suspect fact keeps its value and gains a reason", () => {
    const base = fact({ value: 42, period: samplePeriod, source: "s", observedAt: "2026-08-08T00:00:00Z" });
    const s = suspectFact(base, EXEC_REASON.MIXED_PERIOD_BASIS, "why");
    expect(s.value).toBe(42);
    expect(s.state).toBe("DATA_QUALITY_ISSUE");
    expect(s.reasonCode).toBe(EXEC_REASON.MIXED_PERIOD_BASIS);
    expect(s.definition).toBe("why");
  });
});

// ── No recalculation ──────────────────────────────────────────────────────────

describe("the layer proves and normalises, it does not calculate", () => {
  test("every revenue and finance figure equals the authoritative source exactly", async () => {
    const now = new Date();
    const ctx = await executiveIntelligenceService.getContext("monthly", { now });
    const src = await executiveReportingService.buildExecutiveReport("custom", 30);

    const rev = ctx.domains.REVENUE;
    const fin = ctx.domains.FINANCE;
    // Non-vacuous: the domains must actually have been assembled.
    expect(rev).toBeDefined();
    expect(fin).toBeDefined();

    expect(rev!.gmv!.value).toBe(src.gmv);
    expect(rev!.revenue!.value).toBe(src.revenue);
    expect(rev!.netRevenue!.value).toBe(src.netRevenue);
    expect(rev!.platformMarginPct!.value).toBe(src.platformMarginPct);
    expect(rev!.subscriptionRevenue!.value).toBe(src.subscriptionRevenue);
    expect(fin!.walletLiability!.value).toBe(src.walletLiability);
    expect(fin!.giftCardLiability!.value).toBe(src.giftCardLiability);
    expect(fin!.providerLiability!.value).toBe(src.providerLiability);
    expect(fin!.totalLiabilities!.value).toBe(src.totalLiabilities);
  }, 60_000);

  test("the service contains no financial arithmetic of its own", () => {
    const code = codeOnly(serviceSource);
    // A layer that added, divided or rounded money would be a second opinion about the ledger.
    for (const forbidden of ["round2(", "* 100", "/ gmv", "- refunds", "Math.round"]) {
      expect(code).not.toContain(forbidden);
    }
    // Non-vacuous: it does call the owners.
    expect(code).toContain("executiveReportingService.buildExecutiveReport");
    expect(code).toContain("geoIntelligenceService.demandForecast");
  });

  test("no ranking, scoring, detection or forecasting lives here", () => {
    const code = codeOnly(serviceSource);
    for (const forbidden of ["sort(", "riskScore", "anomal", "predict(", "threshold"]) {
      expect(code.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });
});

// ── Period semantics ──────────────────────────────────────────────────────────

describe("period basis is labelled, never assumed", () => {
  test("a balance is POINT_IN_TIME and carries no window", async () => {
    const ctx = await executiveIntelligenceService.getContext("weekly");
    const wallet = ctx.domains.FINANCE!.walletLiability!;
    expect(wallet.period.basis).toBe("POINT_IN_TIME");
    expect(wallet.period.from).toBeNull();
    expect(wallet.period.days).toBeNull();
  });

  test("GMV is ROLLING and carries the requested window", async () => {
    const ctx = await executiveIntelligenceService.getContext("weekly");
    const gmv = ctx.domains.REVENUE!.gmv!;
    expect(gmv.period.basis).toBe("ROLLING");
    expect(gmv.period.days).toBe(7);
    expect(gmv.period.timezone).toBe(CADENCE_DEFAULT_TIMEZONE);
  });

  /**
   * netRevenue uses the same rolling window as GMV after finance-dashboard fix (G-03 era).
   */
  test("netRevenue uses rolling period basis aligned with GMV", async () => {
    const ctx = await executiveIntelligenceService.getContext("weekly");
    const nr = ctx.domains.REVENUE!.netRevenue!;
    expect(nr.period.basis).toBe("ROLLING");
    expect(nr.state).toBe("OK");
    expect(nr.value).not.toBeNull();
    expect(nr.definition).toContain("same window");
  });

  test("a forecast is FORECAST and its window is in the future", async () => {
    const now = new Date();
    const ctx = await executiveIntelligenceService.getContext("weekly", { now });
    const demand = ctx.domains.DEMAND?.totalPredicted;
    if (!demand) return;
    expect(demand.period.basis).toBe("FORECAST");
    expect(Date.parse(demand.period.to!)).toBeGreaterThan(now.getTime());
  });
});

// ── Zero-GMV semantics ────────────────────────────────────────────────────────

describe("an undefined ratio is escalated, not reinterpreted", () => {
  test("zero GMV marks margin with the human-decision reason code", async () => {
    const ctx = await executiveIntelligenceService.getContext("daily");
    const gmv = ctx.domains.REVENUE!.gmv!;
    const margin = ctx.domains.REVENUE!.platformMarginPct!;
    if (gmv.value === 0) {
      expect(margin.reasonCode).toBe(EXEC_REASON.MARGIN_SEMANTICS_HUMAN_DECISION_REQUIRED);
      expect(margin.definition).toContain("undefined");
      // The source value is preserved rather than replaced with null.
      expect(margin.value).toBe(0);
    } else {
      expect(margin.reasonCode).toBe(EXEC_REASON.MIXED_PERIOD_BASIS);
    }
    // Either way the margin is never a clean OK figure while the source conflates the two meanings.
    expect(margin.state).toBe("DATA_QUALITY_ISSUE");
  });

  test("the layer does not decide which meaning zero has", () => {
    const code = codeOnly(serviceSource);
    // No branch converts the source value into null or into a different number.
    expect(code).not.toContain("platformMarginPct: null");
    expect(code).toContain("MARGIN_SEMANTICS_HUMAN_DECISION_REQUIRED");
  });
});

// ── Freshness and staleness ───────────────────────────────────────────────────

describe("freshness comes from sources, not from the clock", () => {
  test("a stale forecast keeps its value and is labelled STALE", async () => {
    const ctx = await executiveIntelligenceService.getContext("weekly");
    const demand = ctx.domains.DEMAND?.totalPredicted;
    if (!demand) return;
    if (demand.state === "STALE") {
      expect(demand.freshness).toBe("STALE");
      expect(demand.reasonCode).toBe(EXEC_REASON.FORECAST_STALE);
      expect(demand.value).not.toBeNull();
    }
  });

  test("the demand fact carries the model's own timestamp, never the current clock", async () => {
    const now = new Date("2030-01-01T00:00:00Z");
    const ctx = await executiveIntelligenceService.getContext("weekly", { now });
    const demand = ctx.domains.DEMAND?.totalPredicted;
    if (!demand || demand.observedAt === null) return;
    expect(demand.observedAt).not.toBe(now.toISOString());
    // A forecast observed long before a far-future "now" must read STALE.
    expect(demand.state).toBe("STALE");
  });

  test("stale demand uses the shared platform rule, not a local one", () => {
    expect(codeOnly(serviceSource)).toContain("isDemandForecastStale");
  });
});

// ── Missing domains ───────────────────────────────────────────────────────────

describe("absent domains are named rather than filled", () => {
  test("domains with no source are listed as unavailable", async () => {
    const ctx = await executiveIntelligenceService.getContext("weekly");
    const names = ctx.unavailableDomains.map((u) => u.domain);
    // Non-vacuous: these genuinely have no authoritative source yet.
    expect(names.length).toBeGreaterThan(0);
    const expectedAbsent: ExecutiveDomain[] = ["FRAUD", "CUSTOMERS", "PARTNERS", "DIGITAL_TWIN"];
    for (const d of expectedAbsent) {
      expect(names).toContain(d);
      const entry = ctx.unavailableDomains.find((u) => u.domain === d)!;
      expect(entry.reasonCode).toBe(EXEC_REASON.SOURCE_NOT_IMPLEMENTED);
    }
    // And they carry no fabricated facts.
    for (const d of names) expect(ctx.domains[d]).toBeUndefined();
  });

  test("every non-OK fact appears in caveats with a reason", async () => {
    const ctx = await executiveIntelligenceService.getContext("weekly");
    const nonOk: string[] = [];
    for (const [dom, facts] of Object.entries(ctx.domains)) {
      for (const [name, f] of Object.entries(facts)) {
        if (f.state !== "OK") nonOk.push(`${dom}.${name}`);
      }
    }
    expect(nonOk.length).toBeGreaterThan(0);
    expect(ctx.caveats.length).toBe(nonOk.length);
    for (const c of ctx.caveats) {
      expect(c.reasonCode).not.toBe("UNSPECIFIED");
      expect(nonOk).toContain(`${c.domain}.${c.fact}`);
    }
  });
});

// ── Determinism, versions, side effects ───────────────────────────────────────

describe("determinism and provenance integrity", () => {
  test("same instant and same source state yields identical facts", async () => {
    const now = new Date();
    const a = await executiveIntelligenceService.getContext("weekly", { now });
    const b = await executiveIntelligenceService.getContext("weekly", { now });
    expect(JSON.stringify(a.domains)).toBe(JSON.stringify(b.domains));
    expect(a.generatedAt).toBe(b.generatedAt);
  });

  test("model versions are reported only where a producer supplied one", async () => {
    const ctx = await executiveIntelligenceService.getContext("weekly");
    for (const [, version] of Object.entries(ctx.modelVersions)) {
      expect(version === null || typeof version === "string").toBe(true);
    }
    // Finance facts carry no model version, because no model produced them.
    expect(ctx.domains.REVENUE!.gmv!.modelVersion).toBeNull();
  });

  test("the context names its own rules version", async () => {
    const ctx = await executiveIntelligenceService.getContext("weekly");
    expect(ctx.rulesVersion).toBe(EXECUTIVE_CONTEXT_RULES_VERSION);
  });

  test("every fact names a source", async () => {
    const ctx = await executiveIntelligenceService.getContext("weekly");
    let counted = 0;
    for (const facts of Object.values(ctx.domains)) {
      for (const f of Object.values(facts)) {
        expect(typeof f.source).toBe("string");
        expect(f.source.length).toBeGreaterThan(0);
        counted += 1;
      }
    }
    expect(counted).toBeGreaterThan(5);
  });

  test("context construction mutates nothing", async () => {
    const before = await readOnlySideEffectSnapshot();
    await executiveIntelligenceService.getContext("weekly");
    await executiveIntelligenceService.getContext("monthly");
    const after = await readOnlySideEffectSnapshot();
    expect(after).toEqual(before);
  });

  test("no LLM is anywhere in the context path", () => {
    const code = codeOnly(serviceSource);
    for (const forbidden of ["aiGateway", "generateText", "openai", "gemini", "groq", "anthropic"]) {
      expect(code.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });

  test("the context exposes no actor, role or admin parameter", () => {
    const code = codeOnly(serviceSource);
    for (const forbidden of ["actorId", "isAdmin", "allUsers", "req.user"]) {
      expect(code).not.toContain(forbidden);
    }
  });

  test("no PII reaches the context", async () => {
    const ctx = await executiveIntelligenceService.getContext("weekly");
    const serialized = JSON.stringify(ctx);
    for (const leak of ["phoneNumber", "email", "password", "aadhar", "panNumber", "otp", "token"]) {
      expect(serialized.toLowerCase()).not.toContain(leak.toLowerCase());
    }
  });
});
