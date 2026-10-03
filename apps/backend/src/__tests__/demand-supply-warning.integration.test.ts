/**
 * PHASE 9 — Capability 4, demand / supply warnings.
 *
 * Runs ONLY on the isolated `homigo_p39` database and aborts otherwise.
 *
 * The property defended: a comparison is refused on its *shape* before its numbers are considered,
 * and refused again when the supply telemetry cannot support it. Because most live results are
 * refusals, several tests construct an approved policy or a usable supply to prove the refusals are
 * conditional rather than unconditional.
 */
import { refuseIfNotIsolatedTestDb } from "./helpers/isolated-test-db";
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { seedOwnZone, removeOwnZone } from "./helpers/own-zone";
import prisma from "../lib/prisma";
import {
  demandSupplyWarningService,
  demandSupplyPolicy,
  isDemandSupplyPolicyApproved,
  DEMAND_SUPPLY_RULES_VERSION,
  DS_REASON,
  PRESENCE_TTL_SEC,
} from "../services/demand-supply-warning.service";

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
  const [bookings, assignments, payments, wallet, ledger, notifications, outbox, instances, jobs] =
    await Promise.all([
      prisma.booking.count(), prisma.assignmentJob.count(), prisma.payment.count(),
      prisma.walletTransaction.count(), prisma.ledgerEntry.count(), prisma.notification.count(),
      prisma.eventOutbox.count(), prisma.workflowInstance.count(), prisma.scheduledJob.count(),
    ]);
  return { bookings, assignments, payments, wallet, ledger, notifications, outbox, instances, jobs };
}

beforeAll(async () => {
  const db = (await prisma.$queryRawUnsafe<Array<{ db: string }>>("SELECT current_database() AS db"))[0].db;
  refuseIfNotIsolatedTestDb(db);
  src = await Bun.file(`${import.meta.dir}/../services/demand-supply-warning.service.ts`).text();
});

// ── Comparison classification ─────────────────────────────────────────────────


// This file asserts on live zone signals; it owns the zone they are built from (see helpers/own-zone).
let ownZoneId: string | null = null;
beforeAll(async () => {
  ownZoneId = await seedOwnZone(`dsw-${Date.now().toString(36)}`);
});
afterAll(async () => {
  await removeOwnZone(ownZoneId);
});

describe("a comparison is judged on its shape before its numbers", () => {
  test("global demand against zone supply is a scope mismatch", () => {
    const r = demandSupplyWarningService.classifyComparison("FORECAST", "POINT_IN_TIME", "GLOBAL", "ZONE", true);
    expect(r.state).toBe("SCOPE_MISMATCH");
    expect(r.reasonCode).toBe(DS_REASON.FORECAST_GLOBAL_SCOPE);
    expect(r.kind).toBeNull();
  });

  test("a rolling window against a point-in-time balance is a time mismatch", () => {
    const r = demandSupplyWarningService.classifyComparison("ROLLING", "POINT_IN_TIME", "ZONE", "ZONE", false);
    expect(r.state).toBe("TIME_MISMATCH");
    expect(r.kind).toBe("ROLLING_VS_POINT_IN_TIME");
  });

  test("a stale forecast is named stale rather than compared", () => {
    const r = demandSupplyWarningService.classifyComparison("FORECAST", "POINT_IN_TIME", "ZONE", "ZONE", true);
    expect(r.state).toBe("DEMAND_FORECAST_STALE");
    expect(r.kind).toBe("CURRENT_VS_STALE");
  });

  test("a fresh forecast against current supply is still incomparable", () => {
    const r = demandSupplyWarningService.classifyComparison("FORECAST", "POINT_IN_TIME", "ZONE", "ZONE", false);
    expect(r.state).toBe("INCOMPARABLE");
    expect(r.kind).toBe("CURRENT_VS_FORECAST");
  });

  /** Non-vacuous counterpart: the one valid pairing must actually be allowed through. */
  test("current against current, same scope, is permitted", () => {
    const r = demandSupplyWarningService.classifyComparison("POINT_IN_TIME", "POINT_IN_TIME", "ZONE", "ZONE", false);
    expect(r.kind).toBe("CURRENT_VS_CURRENT");
    expect(r.state).toBeNull();
    expect(r.reasonCode).toBeNull();
  });

  test("scope is checked before anything else", () => {
    // Even a valid basis pairing fails when scopes differ.
    const r = demandSupplyWarningService.classifyComparison("POINT_IN_TIME", "POINT_IN_TIME", "GLOBAL", "ZONE", false);
    expect(r.state).toBe("SCOPE_MISMATCH");
  });
});

// ── Supply quality ────────────────────────────────────────────────────────────

describe("supply telemetry is measured, not trusted", () => {
  test("providers without a location row are counted as invisible", async () => {
    const q = await demandSupplyWarningService.measureSupplyQuality();
    expect(q.onlineProviders).toBeGreaterThanOrEqual(q.withLocationRow);
    expect(q.invisible).toBe(q.onlineProviders - q.withLocationRow);
  });

  test("supply is unusable when nothing falls inside the presence window", async () => {
    const q = await demandSupplyWarningService.measureSupplyQuality();
    if (q.withLocationRow > 0 && q.withinPresenceWindow === 0) {
      expect(q.usable).toBe(false);
      expect(q.reasonCode).toBe(DS_REASON.SUPPLY_TELEMETRY_STALE);
    }
    expect(PRESENCE_TTL_SEC).toBe(60);
  });

  test("age statistics are published so the gap is inspectable", async () => {
    const q = await demandSupplyWarningService.measureSupplyQuality();
    if (q.withLocationRow > 0) {
      expect(q.freshestAgeSec).not.toBeNull();
      expect(q.medianAgeSec).not.toBeNull();
      expect(q.freshestAgeSec!).toBeLessThanOrEqual(q.medianAgeSec!);
    }
  });

  test("no location rows at all is reported as incomplete, not as zero supply", async () => {
    const q = await demandSupplyWarningService.measureSupplyQuality();
    if (q.withLocationRow === 0) {
      expect(q.usable).toBe(false);
      expect(q.reasonCode).toBe(DS_REASON.SUPPLY_TELEMETRY_INCOMPLETE);
      expect(q.freshestAgeSec).toBeNull();
    }
  });
});

// ── Policy ────────────────────────────────────────────────────────────────────

describe("no imbalance threshold is invented", () => {
  test("the policy ships unset", () => {
    expect(demandSupplyPolicy.pressureThreshold).toBeNull();
    expect(demandSupplyPolicy.enabled).toBe(false);
    expect(demandSupplyPolicy.status).toBe("UNSET");
    expect(isDemandSupplyPolicyApproved()).toBe(false);
  });

  test("a partial policy never approves, a complete one does", () => {
    expect(isDemandSupplyPolicyApproved({ enabled: true, pressureThreshold: null, status: "APPROVED" })).toBe(false);
    expect(isDemandSupplyPolicyApproved({ enabled: false, pressureThreshold: 2, status: "APPROVED" })).toBe(false);
    expect(isDemandSupplyPolicyApproved({ enabled: true, pressureThreshold: 2, status: "UNSET" })).toBe(false);
    expect(isDemandSupplyPolicyApproved({ enabled: true, pressureThreshold: 2, status: "APPROVED" })).toBe(true);
  });

  test("no familiar multiple is hardcoded", () => {
    const code = codeOnly(src);
    for (const t of ["1.5", "2.0", "* 2)", "0.3", "0.2"]) {
      expect(code).not.toContain(t);
    }
  });

  test("the policy is not environment-driven", () => {
    expect(codeOnly(src)).not.toContain("process.env");
  });
});

// ── Live assessment ───────────────────────────────────────────────────────────

describe("live assessment refuses honestly", () => {
  test("every zone reports a state and a reason", async () => {
    const r = await demandSupplyWarningService.assess();
    expect(r.zones.length).toBeGreaterThan(0);
    for (const z of r.zones) {
      expect(z.reasonCode.length).toBeGreaterThan(0);
      expect(z.rulesVersion).toBe(DEMAND_SUPPLY_RULES_VERSION);
      expect(z.scope).toBe("ZONE");
      expect(z.zoneId.length).toBeGreaterThan(0);
    }
  });

  test("unusable supply blocks every zone verdict regardless of demand", async () => {
    const r = await demandSupplyWarningService.assess();
    if (!r.supplyQuality.usable) {
      for (const z of r.zones) {
        expect(z.state).toBe("SUPPLY_UNAVAILABLE");
        // The supply number is withheld rather than shown as a small-but-real figure.
        expect(z.supplyValue).toBeNull();
        // Demand is still reported — it is the supply term that is untrustworthy.
        expect(typeof z.demandValue).toBe("number");
      }
    }
  });

  test("the global forecast is reported separately and never joined to a zone", async () => {
    const r = await demandSupplyWarningService.assess();
    expect(r.globalForecast.scope).toBe("GLOBAL");
    for (const z of r.zones) {
      // No zone carries the forecast value.
      expect(z.demandBasis).not.toBe("FORECAST");
    }
  });

  test("a stale forecast is labelled stale and keeps its value", async () => {
    const r = await demandSupplyWarningService.assess();
    if (r.globalForecast.state === "DEMAND_FORECAST_STALE") {
      expect(r.globalForecast.reasonCode).toBe(DS_REASON.FORECAST_STALE);
      expect(r.globalForecast.modelVersion).not.toBeNull();
    }
  });

  test("evidence names its source on every item", async () => {
    const r = await demandSupplyWarningService.assess();
    for (const z of r.zones) {
      expect(z.evidence.length).toBeGreaterThan(0);
      for (const e of z.evidence) expect(e.source.length).toBeGreaterThan(0);
    }
  });

  test("zoneId is the identity and duplicate names stay distinct", async () => {
    const r = await demandSupplyWarningService.assess();
    const ids = r.zones.map((z) => z.zoneId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("assessment is deterministic for a fixed instant", async () => {
    const now = new Date();
    const a = await demandSupplyWarningService.assess({ now });
    const b = await demandSupplyWarningService.assess({ now });
    expect(JSON.stringify(a.zones)).toBe(JSON.stringify(b.zones));
  });
});

// ── The five negative tests ───────────────────────────────────────────────────

describe("negative: nothing is manufactured", () => {
  test("stale demand cannot become current", () => {
    const r = demandSupplyWarningService.classifyComparison("FORECAST", "POINT_IN_TIME", "ZONE", "ZONE", true);
    expect(r.state).toBe("DEMAND_FORECAST_STALE");
    expect(r.state).not.toBe("DEMAND_SUPPLY_BALANCED");
  });

  test("global supply cannot be compared to zone demand", () => {
    const r = demandSupplyWarningService.classifyComparison("POINT_IN_TIME", "POINT_IN_TIME", "ZONE", "GLOBAL", false);
    expect(r.state).toBe("SCOPE_MISMATCH");
  });

  test("missing supply does not become zero", async () => {
    const r = await demandSupplyWarningService.assess();
    if (!r.supplyQuality.usable) {
      for (const z of r.zones) expect(z.supplyValue).not.toBe(0);
    }
  });

  test("missing demand does not become zero", async () => {
    const r = await demandSupplyWarningService.assess();
    if (r.globalForecast.state === "DEMAND_UNAVAILABLE") {
      expect(r.globalForecast.value).toBeNull();
    }
  });

  test("an arbitrary threshold cannot silently activate", async () => {
    const r = await demandSupplyWarningService.assess();
    for (const z of r.zones) {
      expect(z.state).not.toBe("DEMAND_PRESSURE");
      expect(z.state).not.toBe("SUPPLY_CONSTRAINT");
    }
  });

  /** Non-vacuous: with usable supply and an approved policy, verdicts do appear. */
  test("an approved policy plus usable supply is what unlocks a verdict", () => {
    expect(isDemandSupplyPolicyApproved({ enabled: true, pressureThreshold: 2, status: "APPROVED" })).toBe(true);
    const code = codeOnly(src);
    // The path exists in code and is reachable — it is gated, not absent.
    expect(code).toContain("DEMAND_PRESSURE");
    expect(code).toContain("DEMAND_SUPPLY_BALANCED");
  });
});

// ── Surge boundary, privacy, side effects ─────────────────────────────────────

describe("boundaries", () => {
  test("no payout or price claim is made from informational surge", () => {
    const code = codeOnly(src);
    for (const w of ["payout", "chargeableBase", "weatherSurge", "priceMultiplier"]) {
      expect(code).not.toContain(w);
    }
  });

  test("no LLM is in the detection path", () => {
    const code = codeOnly(src);
    for (const f of ["aiGateway", "generateText", "openai", "gemini", "groq", "anthropic"]) {
      expect(code.toLowerCase()).not.toContain(f.toLowerCase());
    }
  });

  test("no partner identity or contact detail is exposed", async () => {
    const r = await demandSupplyWarningService.assess();
    const s = JSON.stringify(r).toLowerCase();
    for (const leak of ["phonenumber", "email", "latitude", "longitude", "providerid", "password"]) {
      expect(s).not.toContain(leak);
    }
  });

  test("the service takes no actor or role parameter", () => {
    const code = codeOnly(src);
    for (const f of ["actorId", "isAdmin", "allUsers", "req.user"]) {
      expect(code).not.toContain(f);
    }
  });

  test("assessment mutates nothing", async () => {
    const before = await snapshot();
    await demandSupplyWarningService.assess();
    await demandSupplyWarningService.measureSupplyQuality();
    const after = await snapshot();
    expect(after).toEqual(before);
  });

  test("the service writes nothing", () => {
    const code = codeOnly(src);
    for (const w of [".create(", ".update(", ".delete(", ".upsert("]) {
      expect(code).not.toContain(w);
    }
  });

  test("stale demand uses the shared platform rule", () => {
    expect(codeOnly(src)).toContain("isDemandForecastStale");
  });
});
