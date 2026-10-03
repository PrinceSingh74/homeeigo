/**
 * PARTNER INTELLIGENCE — Item 4, Smart Shift Planning.
 *
 * Runs ONLY on the isolated `homigo_p39` database and aborts otherwise.
 *
 * Two properties are defended above all others:
 *
 *  1. The service is ADVISORY. It must have no write dependency at all — no transaction, no
 *     availability mutator, no booking update. A structural test asserts that from the source,
 *     because "it currently doesn't" is weaker than "it cannot without failing a test".
 *  2. Trade-offs are SURFACED, not hidden. A window excluded by declared hours, a top zone that is
 *     far away, a stale forecast — each must appear as a conflict rather than vanishing into a
 *     range boundary or a score.
 */
import { refuseIfNotIsolatedTestDb } from "./helpers/isolated-test-db";
import { describe, test, expect, beforeAll } from "bun:test";
import prisma from "../lib/prisma";
import { shiftPlanningService, SHIFT_RULES_VERSION } from "../services/shift-planning.service";

let providerRich = "";
let providerBare = "";
let serviceId = "";
let addressId = "";
let customerId = "";
let source = "";

const NET_PER_JOB = 500;
const GROSS_PER_JOB = 625;
const PEAK_HOUR = 6;        // deliberately outside the 09:00-18:00 declaration below
const IN_HOURS_PEAK = 11;  // inside it, so partial exclusion is the case under test

beforeAll(async () => {
  const db = (await prisma.$queryRawUnsafe<Array<{ db: string }>>("SELECT current_database() AS db"))[0].db;
  refuseIfNotIsolatedTestDb(db);

  source = await Bun.file(`${import.meta.dir}/../services/shift-planning.service.ts`).text();

  const stamp = Date.now();
  const mkProvider = async (tag: string, phone: string, hours: { start: string; end: string } | null) => {
    const user = await prisma.user.create({
      data: { firstName: tag, lastName: "SP", password: "x", role: "VENDOR", phoneNumber: phone, email: tag + "@sp.test" },
    });
    const p = await prisma.provider.create({
      data: {
        userId: user.id, businessName: tag, isActive: true, isVerified: true, isOnline: true,
        isApproved: true, registrationStatus: "APPROVED",
        ...(hours ? { workingHoursStart: hours.start, workingHoursEnd: hours.end } : {}),
      },
    });
    return p.id;
  };

  providerRich = await mkProvider("sp-rich-" + stamp, "+9178" + String(stamp).slice(-8), { start: "09:00", end: "18:00" });
  providerBare = await mkProvider("sp-bare-" + stamp, "+9177" + String(stamp).slice(-8), null);

  const svc =
    (await prisma.service.findFirst({ select: { id: true } })) ??
    (await prisma.service.create({
      data: {
        name: "SP Fixture Service " + stamp, slug: "sp-fixture-" + stamp, description: "fixture",
        category: "cleaning", basePrice: GROSS_PER_JOB, estimatedDuration: 60, isActive: true,
      },
      select: { id: true },
    }));
  serviceId = svc.id;

  const cust = await prisma.user.create({
    data: {
      firstName: "sp-cust-" + stamp, lastName: "SP", password: "x", role: "CUSTOMER",
      phoneNumber: "+9176" + String(stamp).slice(-8), email: "spc" + stamp + "@sp.test",
    },
  });
  customerId = cust.id;
  const addr = await prisma.address.create({
    data: {
      userId: cust.id, label: "Home", addressLine1: "1 SP St", city: "Bengaluru", state: "KA",
      zipCode: "560001", latitude: 12.9716, longitude: 77.5946,
    },
  });
  addressId = addr.id;

  /**
   * Concentrated history: most jobs at PEAK_HOUR, a few spread elsewhere so the concentration
   * ratio is meaningful. A single active hour scores 1.0 against itself and would produce no
   * window at all — that degenerate case is documented, not tested for a peak.
   */
  const seed = async (count: number, hour: number, offset: number) => {
    for (let i = 0; i < count; i++) {
      const when = new Date(Date.now() - (offset + i + 2) * 86_400_000);
      when.setUTCHours(hour, 0, 0, 0);
      const b = await prisma.booking.create({
        data: {
          bookingNumber: "SP-" + stamp + "-" + hour + "-" + i,
          userId: customerId, serviceId, addressId, providerId: providerRich, status: "COMPLETED",
          scheduledDate: when, completedAt: when,
          baseAmount: GROSS_PER_JOB, finalAmount: GROSS_PER_JOB, totalAmount: GROSS_PER_JOB,
        },
      });
      await prisma.earning.create({
        data: {
          providerId: providerRich, bookingId: b.id,
          grossAmount: GROSS_PER_JOB, commission: GROSS_PER_JOB - NET_PER_JOB, netEarning: NET_PER_JOB,
          createdAt: when, earningDate: when,
        },
      });
    }
  };
  /**
   * Two dominant hours plus a thin spread.
   *
   * The concentration rule compares an hour against the partner's OWN average per active hour, so
   * the spread matters: an earlier fixture with 12 and 8 jobs in two hours produced NO windows,
   * because two comparable peaks raise the average until neither is 2x it. That is the rule
   * working — "stands out from your own pattern" is meaningless when everything is the pattern.
   *
   * Here: 20 + 20 in the two peaks, then eight single-job hours. Average per active hour is
   * 48 / 10 = 4.8, threshold 9.6, so both peaks qualify and nothing else does.
   */
  await seed(20, PEAK_HOUR, 0);      // outside declared hours
  await seed(20, IN_HOURS_PEAK, 40); // inside declared hours
  for (const [i, hour] of [1, 2, 3, 4, 16, 17, 19, 20].entries()) {
    await seed(1, hour, 80 + i * 3);
  }
}, 120_000);

describe("SP — fixtures produce a real plan (guards against vacuous passes)", () => {
  test("the rich partner gets a plan with windows and reasons", async () => {
    const p = await shiftPlanningService.plan(providerRich);
    expect(p.state).toBe("OK");
    expect(p.reasons.length).toBeGreaterThanOrEqual(6);
    expect(p.recommendedWindows.length).toBeGreaterThan(0);
  }, 60_000);
});

describe("SP — ADVISORY ONLY: structural proof of no write dependency", () => {
  test("the service contains no mutator and opens no transaction", () => {
    // The decisive control. If any of these ever appear, the service can change partner state and
    // this fails before a reviewer has to notice.
    for (const forbidden of [
      "$transaction",
      "prisma.provider.update",
      "prisma.booking.update",
      "prisma.booking.create",
      "prisma.earning.",
      "prisma.walletTransaction",
      "prisma.withdrawal",
      "setOnline",
      "updateAvailability",
      "pauseProvider",
      "resumeProvider",
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });

  test("it holds no direct database handle at all", () => {
    // It works entirely through other services, so there is no prisma client to misuse.
    expect(source).not.toMatch(/^import prisma/m);
    expect(source).not.toContain('from "../lib/prisma"');
  });

  test("only read-oriented services are composed", () => {
    expect(source).toContain("partnerIntelligenceService");
    expect(source).toContain("zoneRecommendationService");
    expect(source).toContain("earningsCoachService");
    expect(source).toContain("partnerOperationsService.snapshot");
  });

  test("planning changes no row", async () => {
    const snap = async () => ({
      providers: await prisma.provider.count(),
      bookings: await prisma.booking.count(),
      earnings: await prisma.earning.count(),
      wallet: await prisma.walletTransaction.count(),
      outbox: await prisma.eventOutbox.count(),
      locations: await prisma.location.count(),
    });
    const before = await snap();
    await shiftPlanningService.plan(providerRich, { targetAmount: 3000 });
    await shiftPlanningService.plan(providerBare);
    expect(await snap()).toEqual(before);
  });
});

describe("SP — windows come from history, never invented", () => {
  test("every window is PARTNER-based with its evidence", async () => {
    const p = await shiftPlanningService.plan(providerRich);
    for (const w of p.recommendedWindows) {
      expect(w.basis).toBe("PARTNER");
      expect(w.jobsInWindow).toBeGreaterThan(0);
      expect(w.concentration).toBeGreaterThanOrEqual(2);
    }
  });

  test("a partner with no history gets no windows and no invented shift", async () => {
    const p = await shiftPlanningService.plan(providerBare);
    expect(p.recommendedWindows).toEqual([]);
    expect(p.recommendedStart).toBeNull();
    expect(p.recommendedEnd).toBeNull();
  });

  test("the demand model is reported, and excluded from timing when stale", async () => {
    const p = await shiftPlanningService.plan(providerRich);
    const demand = p.reasons.find((r) => r.code === "DEMAND")!;
    // Measured live: the horizon starts 68 days in the past and the hourly spread is 0.010, so it
    // cannot pick an hour. It must say so rather than be quietly used anyway.
    expect(["STALE", "UNAVAILABLE", "CONTRIBUTED"]).toContain(demand.state);
    if (demand.state === "STALE") {
      expect(demand.reasonCode).toBe("DEMAND_FORECAST_STALE");
      expect(p.conflicts.map((c) => c.code)).toContain("DEMAND_FORECAST_STALE");
    }
  }, 60_000);
});

describe("SP — trade-offs are surfaced, not hidden", () => {
  test("a window excluded by declared working hours is reported", async () => {
    // Caught by real observation: a 05:00 peak was clamped away by 09:00-18:00 and the plan said
    // nothing. The strongest evidence must never disappear into a range boundary.
    const p = await shiftPlanningService.plan(providerRich);
    const outside = p.conflicts.find((c) => c.code === "OUTSIDE_WORKING_HOURS");
    expect(outside).toBeDefined();
    expect(outside!.detail).toContain(String(PEAK_HOUR).padStart(2, "0") + ":00");
    expect(outside!.severity).toBe("CAUTION");
  });

  test("the recommended shift stays inside declared hours when any window fits", async () => {
    const p = await shiftPlanningService.plan(providerRich);
    const fits = p.recommendedWindows.some((w) => w.hourOfDay >= 9 && w.hourOfDay < 18);
    expect(fits).toBe(true); // the fixture must actually exercise the clamp, not skip it
    expect(Number(p.recommendedStart!.slice(0, 2))).toBeGreaterThanOrEqual(9);
    expect(Number(p.recommendedEnd!.slice(0, 2))).toBeLessThanOrEqual(18);
  });

  test("an unusable location is a stated limitation, never a zero distance", async () => {
    const p = await shiftPlanningService.plan(providerRich);
    if (p.travelConsiderations.locationState === "UNAVAILABLE") {
      expect(p.conflicts.map((c) => c.code)).toContain("NO_LOCATION_LIMITS_TRAVEL");
      expect(p.travelConsiderations.routeAvailable).toBe(false);
      for (const z of p.priorityZones) expect(z.distanceKm).toBeNull();
    }
  });

  test("route is unavailable rather than assumed without a live position", async () => {
    const p = await shiftPlanningService.plan(providerRich);
    if (p.travelConsiderations.locationState !== "LIVE") {
      expect(p.travelConsiderations.routeAvailable).toBe(false);
    }
  });

  test("weather absence is declared rather than assumed fine", async () => {
    const p = await shiftPlanningService.plan(providerRich);
    const weather = p.reasons.find((r) => r.code === "WEATHER")!;
    if (weather.state === "UNAVAILABLE") {
      expect(p.conflicts.map((c) => c.code)).toContain("WEATHER_UNAVAILABLE");
      expect(p.degraded).toContain("WEATHER_UNAVAILABLE");
    }
  });

  test("every conflict carries a code, a severity and a human explanation", async () => {
    const p = await shiftPlanningService.plan(providerRich);
    for (const c of p.conflicts) {
      expect(["INFO", "CAUTION"]).toContain(c.severity);
      expect(typeof c.detail).toBe("string");
      expect(c.detail.length).toBeGreaterThan(10);
    }
  });
});

describe("SP — explainability and bounds", () => {
  test("every reason carries state, source and freshness", async () => {
    const p = await shiftPlanningService.plan(providerRich);
    for (const r of p.reasons) {
      expect(["CONTRIBUTED", "UNAVAILABLE", "INSUFFICIENT_HISTORY", "STALE"]).toContain(r.state);
      expect(["REAL_TIME", "NEAR_REAL_TIME", "HISTORICAL", "FORECAST", "STATIC", "UNKNOWN"]).toContain(r.freshness);
      if (r.state !== "CONTRIBUTED") expect(typeof r.reasonCode).toBe("string");
    }
  });

  test("coverage is recomputable from the reasons", async () => {
    const p = await shiftPlanningService.plan(providerRich);
    const contributed = p.reasons.filter((r) => r.state === "CONTRIBUTED").length;
    expect(p.coverage).toBe(Math.round((contributed / p.reasons.length) * 100) / 100);
  });

  test("coverage and confidence stay in range", async () => {
    const p = await shiftPlanningService.plan(providerRich);
    for (const v of [p.coverage, p.confidence]) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  test("all four rule fingerprints travel with the plan", async () => {
    const p = await shiftPlanningService.plan(providerRich);
    expect(p.rulesVersion).toBe(SHIFT_RULES_VERSION);
    expect(p.contextRulesVersion).toBe("pi.rules.v1");
    expect(p.zoneRulesVersion).toBe("zone.rules.v1");
    expect(p.coachRulesVersion).toBe("coach.rules.v1");
  });
});

describe("SP — determinism and isolation", () => {
  test("same input produces byte-identical output", async () => {
    const a = await shiftPlanningService.plan(providerRich);
    const b = await shiftPlanningService.plan(providerRich);
    const strip = (p: typeof a) =>
      JSON.stringify({
        ...p,
        generatedAt: "",
        // `observedAt` is when each signal was READ — it is meant to differ between calls. The
        // decisions (windows, zones, conflicts, coverage) are what must be identical.
        reasons: p.reasons.map((r) => ({ ...r, observedAt: "" })),
      });
    expect(strip(b)).toBe(strip(a));
  });

  test("an unknown provider is PROVIDER_NOT_FOUND, not an empty-but-confident plan", async () => {
    const p = await shiftPlanningService.plan("does-not-exist");
    expect(p.state).toBe("PROVIDER_NOT_FOUND");
    expect(p.confidence).toBe(0);
    expect(p.recommendedWindows).toEqual([]);
    expect(p.priorityZones).toEqual([]);
  });

  test("one partner's plan never reflects another's history", async () => {
    const rich = await shiftPlanningService.plan(providerRich);
    const bare = await shiftPlanningService.plan(providerBare);
    expect(rich.recommendedWindows.length).toBeGreaterThan(0);
    // If history leaked, the bare partner would show windows it never earned.
    expect(bare.recommendedWindows).toEqual([]);
  });

  test("the target argument cannot widen what is read", async () => {
    const small = await shiftPlanningService.plan(providerRich, { targetAmount: 1 });
    const huge = await shiftPlanningService.plan(providerRich, { targetAmount: 9_999_999 });
    expect(JSON.stringify(huge.recommendedWindows)).toBe(JSON.stringify(small.recommendedWindows));
    expect(JSON.stringify(huge.priorityZones)).toBe(JSON.stringify(small.priorityZones));
  }, 30_000);
});
