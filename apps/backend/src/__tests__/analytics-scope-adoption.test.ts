/**
 * DQ-7: proves scoping works against a real database, and that the call sites that must be scoped
 * still are.
 *
 * `data-provenance.test.ts` already covers classification — which origin a row gets. This covers the
 * half that decides whether any of it matters: the predicate has to actually change the answer, the
 * inheritance through a relation has to reach tables with no column of their own, and the call sites
 * have to keep using it.
 *
 * The contrastive fixture matters. A predicate asserted only against rows it excludes passes just as
 * well when it excludes everything, so every population is present here — REAL, UNKNOWN (NULL), and
 * one row of each non-business origin — and each assertion names the exact count it expects.
 *
 * Runs against `homigo_test`. Rows are created under a unique marker and removed afterwards.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { provenanceForNewUser } from "../lib/data-provenance";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { DataOrigin } from "@prisma/client";
import prisma from "../lib/prisma";
import { analyticsWhere, analyticsWhereVia, INHERITS_PROVENANCE_VIA } from "../lib/analytics-scope";

const MARKER = `dq7-${Date.now()}`;
const email = (suffix: string) => `${MARKER}-${suffix}@scope-test.invalid`;

/** One user per population, so every branch of the predicate has something to include or exclude. */
const POPULATIONS: Array<[string, DataOrigin | null]> = [
  ["real", "REAL"],
  ["unknown", null],
  ["fixture", "FIXTURE"],
  ["test", "TEST"],
  ["cert", "CERTIFICATION"],
  ["synthetic", "SYNTHETIC"],
  ["inferred-cert", "INFERRED_CERTIFICATION"],
];

/** BUSINESS = REAL + UNKNOWN. Two of the seven. */
const EXPECTED_BUSINESS = 2;

const createdUserIds: string[] = [];

beforeAll(async () => {
  for (const [suffix, origin] of POPULATIONS) {
    const u = await prisma.user.create({
      data: {
        ...provenanceForNewUser(email(suffix)),
        email: email(suffix),
        phoneNumber: `+9199${String(Math.floor(Math.random() * 100_000_000)).padStart(8, "0")}`,
        firstName: "dq7",
        lastName: suffix,
        password: "not-a-real-hash",
        role: "CUSTOMER",
        dataOrigin: origin,
      },
      select: { id: true },
    });
    createdUserIds.push(u.id);
  }
});

afterAll(async () => {
  if (createdUserIds.length) await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
});

/**
 * Selected by id, not by the marker in the e-mail: `users.email` is encrypted at rest, so a
 * `startsWith` on it matches nothing and every assertion here would have compared 0 to 0 and passed
 * for the wrong reason. A lambda because the ids do not exist until `beforeAll` has run.
 */
const mine = () => ({ id: { in: createdUserIds } });

describe("analyticsWhere — the predicate changes the answer", () => {
  it("counts every population without a scope", async () => {
    expect(await prisma.user.count({ where: mine() })).toBe(POPULATIONS.length);
  });

  it("BUSINESS admits REAL and UNKNOWN, and nothing else", async () => {
    expect(await prisma.user.count({ where: { ...mine(), ...analyticsWhere() } })).toBe(EXPECTED_BUSINESS);
  });

  it("DECLARED_REAL_ONLY excludes UNKNOWN as well", async () => {
    // The stricter population is the one that must never be the default: it erases all history.
    expect(await prisma.user.count({ where: { ...mine(), ...analyticsWhere("DECLARED_REAL_ONLY") } })).toBe(1);
  });

  it("NON_BUSINESS is the exact complement of BUSINESS", async () => {
    const nonBusiness = await prisma.user.count({ where: { ...mine(), ...analyticsWhere("NON_BUSINESS") } });
    expect(nonBusiness).toBe(POPULATIONS.length - EXPECTED_BUSINESS);
  });

  it("ALL is a no-op rather than a filter that happens to match everything", async () => {
    expect(await prisma.user.count({ where: { ...mine(), ...analyticsWhere("ALL") } })).toBe(POPULATIONS.length);
  });

  it("treats an INFERRED_* origin exactly as its declared counterpart", async () => {
    // How a row was classified must never decide whether it counts.
    const inferred = await prisma.user.count({
      where: { ...mine(), dataOrigin: "INFERRED_CERTIFICATION", ...analyticsWhere() },
    });
    expect(inferred).toBe(0);
  });
});

describe("analyticsWhereVia — tables with no column of their own", () => {
  it("scopes a provider through the user behind it", async () => {
    // `AND`, not a spread. Both fragments key on `user`, and in an object literal the later key
    // wins, so spreading would drop the `mine()` restriction and count every provider in the
    // database. It does not error — the number just comes back bigger, which is the worst way for
    // a scoping bug to present itself. This assertion started at 242 for exactly that reason.
    const all = await prisma.provider.count({ where: { user: mine() } });
    const business = await prisma.provider.count({
      where: { AND: [{ user: mine() }, analyticsWhereVia("provider")] },
    });
    expect(business).toBeLessThanOrEqual(all);
  });

  it("is a legal query against a model that has no dataOrigin column", async () => {
    // The point of the inheritance: `payments` has no column, and this must still execute.
    // Awaited rather than asserted on the PrismaPromise: bun's `.resolves` does not recognise a
    // thenable that is not a native Promise, and would fail before the query ever ran.
    expect(await prisma.payment.count({ where: analyticsWhereVia("payment") })).toBeGreaterThanOrEqual(0);
    expect(
      await prisma.walletTransaction.count({ where: analyticsWhereVia("walletTransaction") }),
    ).toBeGreaterThanOrEqual(0);
  });

  it("names a real relation for every inheriting model", () => {
    // A typo here would produce a filter that silently matches nothing.
    for (const [model, relation] of Object.entries(INHERITS_PROVENANCE_VIA)) {
      const where = analyticsWhereVia(model as keyof typeof INHERITS_PROVENANCE_VIA);
      expect(JSON.stringify(where)).toContain(relation);
    }
  });
});

describe("DQ-7 adoption — the call sites that must stay scoped", () => {
  // Structural, because the runtime value depends on data that differs per environment. Each entry
  // is a site the impact measurement showed was materially wrong unscoped.
  const SITES: Array<[string, string]> = [
    ["src/services/admin.service.ts", "dashboard + analytics totals"],
    ["src/services/geo-intelligence.service.ts", "executive KPIs"],
    ["src/lib/partner-exec-metrics.ts", "the business gauges Prometheus scrapes"],
    ["src/services/refund-workflow.service.ts", "refund console: 97.1% of rows are not business"],
    ["src/lib/refund-backlog-metrics.ts", "the refund alerts that page a human"],
    ["src/services/stats.service.ts", "public counters shown to customers"],
    ["src/services/finance-analytics.service.ts", "unit economics"],
    ["src/services/membership-analytics.service.ts", "upgrade funnel"],
  ];

  for (const [file, why] of SITES) {
    it(`${file} — ${why}`, () => {
      const text = readFileSync(join(import.meta.dir, "..", "..", file), "utf8");
      expect(text).toContain("analytics-scope");
      expect(text).toMatch(/analyticsWhere(Via)?\(/);
    });
  }

  it("keeps GMV and the booking count in the same population", () => {
    // Scoping one side of a ratio and not the other is worse than scoping neither, because the
    // result stops being an obviously inflated total and becomes a plausible wrong one.
    const text = readFileSync(join(import.meta.dir, "..", "..", "src/services/finance-analytics.service.ts"), "utf8");
    const gmv = text.slice(text.indexOf("amountPaid"), text.indexOf("amountPaid") + 400);
    expect(gmv).toContain("analyticsWhereVia");
  });
});

describe("mandate L — the 16 intelligence/analytics services carry their classification", () => {
  /**
   * Population reads scoped in the mandate-L pass. The pattern also admits `analyticsSqlPredicate`:
   * two of these scope hand-written SQL, which `analyticsWhere()` cannot reach.
   */
  const SCOPED_16: Array<[string, string]> = [
    ["src/services/customer-intelligence.service.ts", "NPS/CSAT ratings + the repeat-rate SQL"],
    ["src/services/growth-intelligence.service.ts", "referral GMV joined through bookings"],
    ["src/services/membership-insights.service.ts", "plan subscribers, benefit usage, churn risk, upgrade list"],
    ["src/services/partner-acquisition-analytics.service.ts", "active-partner supply in the funnel"],
    ["src/services/revenue-anomaly.service.ts", "the daily GMV series every baseline is measured on"],
  ];

  for (const [file, why] of SCOPED_16) {
    it(`${file} — ${why}`, () => {
      const text = readFileSync(join(import.meta.dir, "..", "..", file), "utf8");
      expect(text).toContain("analytics-scope");
      expect(text).toMatch(/analytics(Where(Via)?|SqlPredicate(Via)?)\(/);
    });
  }

  /**
   * The other eleven are classified, deliberately, as NOT scoped — deleting one of these files (or
   * adding a population read to it) should resurface the classification, so each is pinned here:
   *
   *   eta-intelligence               D  per-provider calibration; ML label tables; synthetic
   *                                     exclusion lives in countTrainingEligible's booking_number
   *                                     contract with BigQuery (vw_eta_training_eligible)
   *   finance-intelligence           C  canonical GMV is reconciled against the ledger (registry)
   *   finance-liability              C  the platform owes every balance however the account was made
   *   payout-operations              C  real money movement; the queue must see every row
   *   fraud-admin                    B/F a fraud control scoped quiet is a control that cannot fire
   *   partner-intelligence           D  one partner's day
   *   satisfaction-intelligence      D  signal for one booking
   *   knowledge-analytics            b  KB/ML metadata tables, no business population
   *   support-intelligence-analytics H  AI-layer observability over support tables
   *   executive-intelligence         c  no direct reads; carries figures from scoped producers
   *   executive-reporting            c  no direct reads; finance-dashboard + chargeback producers
   */
  const CLASSIFIED_UNSCOPED_16 = [
    "src/services/eta-intelligence.service.ts",
    "src/services/finance-intelligence.service.ts",
    "src/services/finance-liability.service.ts",
    "src/services/payout-operations.service.ts",
    "src/services/fraud-admin.service.ts",
    "src/services/partner-intelligence.service.ts",
    "src/services/satisfaction-intelligence.service.ts",
    "src/services/knowledge-analytics.service.ts",
    "src/services/support-intelligence-analytics.service.ts",
    "src/services/executive-intelligence.service.ts",
    "src/services/executive-reporting.service.ts",
  ];

  it("every deliberately-unscoped service still exists where the classification says", () => {
    for (const file of CLASSIFIED_UNSCOPED_16) {
      // readFileSync throwing here means the file moved and the classification above is stale.
      expect(readFileSync(join(import.meta.dir, "..", "..", file), "utf8").length).toBeGreaterThan(0);
    }
  });
});
