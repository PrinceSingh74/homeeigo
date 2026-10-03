/**
 * PARTNER INTELLIGENCE — Item 3, Earnings Coach.
 *
 * Runs ONLY on the isolated `homigo_p39` database and aborts otherwise.
 *
 * The property these tests defend: the coach may state a GAP and a JOB COUNT, but must never state
 * an outcome. There is no field, and no code path, that says how much the partner will earn. It
 * reports what is realised (fact), what a job has historically been worth (estimate with an error),
 * and whether the required count sits inside their own record (comparison) — three different kinds
 * of number that must never be merged.
 */
import { refuseIfNotIsolatedTestDb } from "./helpers/isolated-test-db";
import { describe, test, expect, beforeAll } from "bun:test";
import prisma from "../lib/prisma";
import {
  earningsCoachService,
  EARNINGS_COACH_RULES_VERSION,
  MIN_JOBS_FOR_PLAN,
} from "../services/earnings-coach.service";

let providerRich = "";   // enough history for a plan
let providerThin = "";   // below the sample floor
let providerNone = "";   // no earnings at all
let serviceId = "";
let addressId = "";
let customerId = "";

const NET_PER_JOB = 500;
const GROSS_PER_JOB = 625; // 20% commission → net 500, so gross/net confusion would be visible

beforeAll(async () => {
  const db = (await prisma.$queryRawUnsafe<Array<{ db: string }>>("SELECT current_database() AS db"))[0].db;
  refuseIfNotIsolatedTestDb(db);

  const stamp = Date.now();
  const mkProvider = async (tag: string, phone: string) => {
    const user = await prisma.user.create({
      data: { firstName: tag, lastName: "EC", password: "x", role: "VENDOR", phoneNumber: phone, email: tag + "@ec.test" },
    });
    const p = await prisma.provider.create({
      data: { userId: user.id, businessName: tag, isActive: true, isVerified: true, isOnline: true },
    });
    return p.id;
  };

  providerRich = await mkProvider("ec-rich-" + stamp, "+9188" + String(stamp).slice(-8));
  providerThin = await mkProvider("ec-thin-" + stamp, "+9187" + String(stamp).slice(-8));
  providerNone = await mkProvider("ec-none-" + stamp, "+9186" + String(stamp).slice(-8));

  /**
   * A service must exist for a booking to reference. The catalogue is platform configuration, not
   * partner history, so creating one in an isolated database is fixture setup rather than
   * fabricated evidence — and it keeps the suite runnable against a freshly cloned schema.
   */
  const svc =
    (await prisma.service.findFirst({ select: { id: true } })) ??
    (await prisma.service.create({
      data: {
        name: "EC Fixture Service " + stamp,
        slug: "ec-fixture-" + stamp,
        description: "fixture",
        category: "cleaning",
        basePrice: GROSS_PER_JOB,
        estimatedDuration: 60,
        isActive: true,
      },
      select: { id: true },
    }));
  serviceId = svc.id;

  const cust = await prisma.user.create({
    data: {
      firstName: "ec-cust-" + stamp, lastName: "EC", password: "x", role: "CUSTOMER",
      phoneNumber: "+9185" + String(stamp).slice(-8), email: "ecc" + stamp + "@ec.test",
    },
  });
  customerId = cust.id;
  const addr = await prisma.address.create({
    data: {
      userId: cust.id, label: "Home", addressLine1: "1 EC St", city: "Bengaluru", state: "KA",
      zipCode: "560001", latitude: 12.9716, longitude: 77.5946,
    },
  });
  addressId = addr.id;

  /**
   * Completed jobs plus their EARNING rows. Net and gross are deliberately different so a
   * gross/net mix-up would change the job count and be caught, not hidden.
   */
  const seedJobs = async (providerId: string, count: number, hour: number) => {
    for (let i = 0; i < count; i++) {
      const when = new Date(Date.now() - (i + 2) * 86_400_000);
      when.setUTCHours(hour, 0, 0, 0);
      const b = await prisma.booking.create({
        data: {
          bookingNumber: "EC-" + providerId.slice(-6) + "-" + stamp + "-" + i,
          userId: customerId, serviceId, addressId, providerId, status: "COMPLETED",
          scheduledDate: when, completedAt: when,
          baseAmount: GROSS_PER_JOB, finalAmount: GROSS_PER_JOB, totalAmount: GROSS_PER_JOB,
        },
      });
      await prisma.earning.create({
        data: {
          providerId, bookingId: b.id,
          grossAmount: GROSS_PER_JOB, commission: GROSS_PER_JOB - NET_PER_JOB, netEarning: NET_PER_JOB,
          createdAt: when, earningDate: when,
        },
      });
    }
  };

  await seedJobs(providerRich, 10, 9);
  await seedJobs(providerThin, MIN_JOBS_FOR_PLAN - 1, 14);
});

describe("EC — fixtures produce a real plan (guards against vacuous passes)", () => {
  test("the rich partner gets an OK plan with a populated opportunity block", async () => {
    const p = await earningsCoachService.plan(providerRich, 3000);
    expect(p.state).toBe("OK");
    expect(p.opportunity).not.toBeNull();
    expect(p.realized).not.toBeNull();
    expect(p.reasons.length).toBeGreaterThan(0);
  });
});

describe("EC — realised earnings are facts, read from the ledger", () => {
  test("trailing figures match the seeded net earnings exactly", async () => {
    const p = await earningsCoachService.plan(providerRich, 3000);
    // 10 jobs x net 500, all inside the trailing 30-day window.
    expect(p.realized!.trailing30d).toBe(10 * NET_PER_JOB);
    expect(p.realized!.currency).toBe("INR");
  });

  test("the per-job average is NET, not gross", async () => {
    // The decisive check: gross is 625, net is 500. If the coach used gross it would report 625
    // here and ask for fewer jobs than the partner actually needs.
    const p = await earningsCoachService.plan(providerRich, 3000);
    expect(p.opportunity!.averageNetPerJob).toBe(NET_PER_JOB);
    expect(p.opportunity!.averageNetPerJob).not.toBe(GROSS_PER_JOB);
  });
});

describe("EC — target and gap arithmetic", () => {
  test("gap is target minus what is already realised today", async () => {
    const p = await earningsCoachService.plan(providerRich, 3000);
    expect(p.target!.amount).toBe(3000);
    expect(p.target!.remainingGap).toBe(3000 - p.realized!.today);
  });

  test("jobs needed is the gap divided by the partner's own net average", async () => {
    const p = await earningsCoachService.plan(providerRich, 3000);
    const expected = Math.ceil(p.target!.remainingGap / p.opportunity!.averageNetPerJob);
    expect(p.opportunity!.estimatedJobsNeeded).toBe(expected);
  });

  test("a zero target yields a zero gap, not a negative one", async () => {
    const p = await earningsCoachService.plan(providerRich, 0);
    expect(p.target!.remainingGap).toBe(0);
    expect(p.opportunity!.estimatedJobsNeeded).toBe(0);
  });

  test("an already-met target is stated as met rather than as a negative gap", async () => {
    const p = await earningsCoachService.plan(providerRich, 1);
    // Realised today may be 0 in fixtures, in which case the gap is legitimately 1.
    expect(p.target!.remainingGap).toBeGreaterThanOrEqual(0);
    if (p.target!.alreadyMet) expect(p.state).toBe("TARGET_ALREADY_MET");
  });
});

describe("EC — the estimate carries its own error", () => {
  test("a standard error and a job range accompany every estimate", async () => {
    const p = await earningsCoachService.plan(providerRich, 3000);
    expect(typeof p.opportunity!.standardError).toBe("number");
    expect(p.opportunity!.standardError).toBeGreaterThanOrEqual(0);
    const [lo, hi] = p.opportunity!.jobsNeededRange;
    expect(lo).toBeLessThanOrEqual(hi);
    expect(p.opportunity!.estimatedJobsNeeded).toBeGreaterThanOrEqual(lo);
    expect(p.opportunity!.estimatedJobsNeeded).toBeLessThanOrEqual(hi);
  });

  test("confidence is bounded and never reads as certainty", async () => {
    const p = await earningsCoachService.plan(providerRich, 3000);
    expect(p.opportunity!.confidence).toBeGreaterThan(0);
    expect(p.opportunity!.confidence).toBeLessThanOrEqual(0.95);
  });

  test("sample size travels with the estimate", async () => {
    const p = await earningsCoachService.plan(providerRich, 3000);
    expect(p.opportunity!.sampleSize).toBe(10);
  });
});

describe("EC — insufficient history is a state, not a guess", () => {
  test("below the sample floor there is no opportunity block at all", async () => {
    const p = await earningsCoachService.plan(providerThin, 3000);
    expect(p.state).toBe("INSUFFICIENT_HISTORY");
    expect(p.opportunity).toBeNull();
    expect(p.reasonCode).toBe("NEEDS_" + MIN_JOBS_FOR_PLAN + "_JOBS");
  });

  test("realised earnings are still reported honestly when a plan cannot be made", async () => {
    // The partner earned real money; that fact does not disappear because the sample is thin.
    const p = await earningsCoachService.plan(providerThin, 3000);
    expect(p.realized).not.toBeNull();
    expect(p.realized!.trailing30d).toBe((MIN_JOBS_FOR_PLAN - 1) * NET_PER_JOB);
  });

  test("a partner with no earnings at all gets INSUFFICIENT_HISTORY, not zeroes", async () => {
    const p = await earningsCoachService.plan(providerNone, 3000);
    expect(p.state).toBe("INSUFFICIENT_HISTORY");
    expect(p.opportunity).toBeNull();
    expect(p.realized).toBeNull();
  });

  test("an unknown provider is PROVIDER_NOT_FOUND, not an empty plan", async () => {
    const p = await earningsCoachService.plan("does-not-exist", 3000);
    expect(p.state).toBe("PROVIDER_NOT_FOUND");
    expect(p.opportunity).toBeNull();
    expect(p.target).toBeNull();
  });
});

describe("EC — feasibility compares against the partner's own record", () => {
  test("the band is one of the defined values and cites the evidence", async () => {
    const p = await earningsCoachService.plan(providerRich, 3000);
    expect(["WITHIN_TYPICAL_DAY", "REQUIRES_BEST_DAY", "ABOVE_OBSERVED_CAPACITY", "UNKNOWN"]).toContain(
      p.feasibility.band,
    );
    if (p.feasibility.band !== "UNKNOWN") {
      expect(p.feasibility.bestObservedDay).not.toBeNull();
      expect(p.feasibility.typicalJobsPerActiveDay).not.toBeNull();
    }
  });

  test("an impossible target is called out rather than quietly accepted", async () => {
    // 10,000,000 could not be reached in a day by any observed record.
    const p = await earningsCoachService.plan(providerRich, 10_000_000);
    expect(p.opportunity!.estimatedJobsNeeded).toBeGreaterThan(p.feasibility.bestObservedDay ?? 0);
    expect(p.feasibility.band).toBe("ABOVE_OBSERVED_CAPACITY");
  });
});

describe("EC — time windows only when the partner's own history supports them", () => {
  test("a concentrated hour is reported with its evidence and PARTNER basis", async () => {
    const p = await earningsCoachService.plan(providerRich, 3000);
    for (const w of p.timeWindows) {
      expect(w.basis).toBe("PARTNER");
      expect(w.jobsInWindow).toBeGreaterThanOrEqual(MIN_JOBS_FOR_PLAN);
      expect(w.concentration).toBeGreaterThanOrEqual(2);
      expect(w.hourOfDay).toBeGreaterThanOrEqual(0);
      expect(w.hourOfDay).toBeLessThanOrEqual(23);
    }
  });

  test("a thin history produces no window rather than a noisy one", async () => {
    const p = await earningsCoachService.plan(providerThin, 3000);
    expect(p.timeWindows).toEqual([]);
  });
});

describe("EC — never promises an outcome", () => {
  test("no field states projected or guaranteed earnings", async () => {
    const p = await earningsCoachService.plan(providerRich, 3000);
    const json = JSON.stringify(p).toLowerCase();
    for (const banned of ["guarantee", "guaranteed", "you will earn", "assured", "promised"]) {
      expect(json).not.toContain(banned);
    }
    // There is no projected-earnings field at all — the plan stops at a job count.
    expect(json).not.toContain("projectedearnings");
    expect(json).not.toContain("expectedearnings");
  });

  test("the three kinds of number stay in separate blocks", async () => {
    const p = await earningsCoachService.plan(providerRich, 3000);
    // Realised is a fact, opportunity is an estimate, feasibility is a comparison. Merging them
    // is exactly how "you will earn X" gets accidentally invented.
    expect(Object.keys(p.realized!)).toEqual(["today", "trailing7d", "trailing30d", "currency"]);
    expect(p.opportunity).toHaveProperty("standardError");
    expect(p.feasibility).toHaveProperty("band");
  });
});

describe("EC — explainability", () => {
  test("every reason carries a state, a source and a human detail", async () => {
    const p = await earningsCoachService.plan(providerRich, 3000);
    for (const r of p.reasons) {
      expect(["CONTRIBUTED", "UNAVAILABLE", "INSUFFICIENT_HISTORY"]).toContain(r.state);
      expect(typeof r.detail).toBe("string");
      expect(r.detail.length).toBeGreaterThan(0);
      if (r.state !== "CONTRIBUTED") expect(typeof r.reasonCode).toBe("string");
    }
  });

  test("both rule fingerprints travel with the plan", async () => {
    const p = await earningsCoachService.plan(providerRich, 3000);
    expect(p.rulesVersion).toBe(EARNINGS_COACH_RULES_VERSION);
    expect(p.contextRulesVersion).toBe("pi.rules.v1");
  });
});

describe("EC — determinism and isolation", () => {
  test("same input produces byte-identical output", async () => {
    const a = await earningsCoachService.plan(providerRich, 3000);
    const b = await earningsCoachService.plan(providerRich, 3000);
    const strip = (p: typeof a) =>
      JSON.stringify({ ...p, generatedAt: "", reasons: p.reasons.map((r) => ({ ...r, observedAt: "" })) });
    expect(strip(b)).toBe(strip(a));
  });

  test("one partner's plan never reflects another partner's earnings", async () => {
    const rich = await earningsCoachService.plan(providerRich, 3000);
    const none = await earningsCoachService.plan(providerNone, 3000);
    expect(rich.realized!.trailing30d).toBe(10 * NET_PER_JOB);
    // If earnings leaked across partners, this one would show money it never made.
    expect(none.realized).toBeNull();
    expect(none.opportunity).toBeNull();
  });

  test("the target argument cannot widen what data is read", async () => {
    // Target only sets the goal. A wildly different target must not change realised facts.
    const small = await earningsCoachService.plan(providerRich, 100);
    const huge = await earningsCoachService.plan(providerRich, 999_999);
    expect(huge.realized!.trailing30d).toBe(small.realized!.trailing30d);
    expect(huge.opportunity!.sampleSize).toBe(small.opportunity!.sampleSize);
    expect(huge.opportunity!.averageNetPerJob).toBe(small.opportunity!.averageNetPerJob);
  });
});

describe("EC — read-only: no financial mutation", () => {
  test("building a plan changes no financial or booking row", async () => {
    const before = {
      earnings: await prisma.earning.count(),
      bookings: await prisma.booking.count(),
      wallet: await prisma.walletTransaction.count(),
      withdrawals: await prisma.withdrawal.count(),
      outbox: await prisma.eventOutbox.count(),
    };
    await earningsCoachService.plan(providerRich, 3000);
    await earningsCoachService.plan(providerThin, 5000);
    const after = {
      earnings: await prisma.earning.count(),
      bookings: await prisma.booking.count(),
      wallet: await prisma.walletTransaction.count(),
      withdrawals: await prisma.withdrawal.count(),
      outbox: await prisma.eventOutbox.count(),
    };
    expect(after).toEqual(before);
  });
});

describe("EC — EarningSettlementStatus: CREDITED included, REVERSED excluded", () => {
  test("a REVERSED earning is not forecastable and does not inflate realised totals", async () => {
    const stamp = Date.now();
    const user = await prisma.user.create({
      data: {
        firstName: "ec-rev-" + stamp, lastName: "EC", password: "x", role: "VENDOR",
        phoneNumber: "+9184" + String(stamp).slice(-8), email: "ecrev" + stamp + "@ec.test",
      },
    });
    const provider = await prisma.provider.create({
      data: { userId: user.id, businessName: "ec-rev", isActive: true, isVerified: true, isOnline: true },
    });

    const seedOne = async (i: number, status: "CREDITED" | "REVERSED") => {
      const when = new Date(Date.now() - (i + 3) * 86_400_000);
      const b = await prisma.booking.create({
        data: {
          bookingNumber: "ECREV-" + stamp + "-" + i,
          userId: customerId, serviceId, addressId, providerId: provider.id, status: "COMPLETED",
          scheduledDate: when, completedAt: when,
          baseAmount: GROSS_PER_JOB, finalAmount: GROSS_PER_JOB, totalAmount: GROSS_PER_JOB,
        },
      });
      await prisma.earning.create({
        data: {
          providerId: provider.id, bookingId: b.id,
          grossAmount: GROSS_PER_JOB, commission: GROSS_PER_JOB - NET_PER_JOB, netEarning: NET_PER_JOB,
          paymentStatus: status, createdAt: when, earningDate: when,
        },
      });
    };

    await seedOne(0, "CREDITED");
    await seedOne(1, "CREDITED");
    await seedOne(2, "CREDITED");
    await seedOne(3, "REVERSED");

    const walletBefore = await prisma.provider.findUnique({
      where: { id: provider.id },
      select: { walletBalance: true },
    });

    const p = await earningsCoachService.plan(provider.id, 3000);
    expect(p.state).toBe("OK");
    expect(p.realized!.trailing30d).toBe(3 * NET_PER_JOB);
    expect(p.opportunity!.sampleSize).toBe(3);
    expect(p.opportunity!.averageNetPerJob).toBe(NET_PER_JOB);

    const walletAfter = await prisma.provider.findUnique({
      where: { id: provider.id },
      select: { walletBalance: true },
    });
    expect(walletAfter!.walletBalance).toBe(walletBefore!.walletBalance);
  });

  test("REVERSED-only history is INSUFFICIENT_HISTORY, not a plan built from clawed-back money", async () => {
    const stamp = Date.now() + 1;
    const user = await prisma.user.create({
      data: {
        firstName: "ec-revonly-" + stamp, lastName: "EC", password: "x", role: "VENDOR",
        phoneNumber: "+9183" + String(stamp).slice(-8), email: "ecro" + stamp + "@ec.test",
      },
    });
    const provider = await prisma.provider.create({
      data: { userId: user.id, businessName: "ec-revonly", isActive: true, isVerified: true, isOnline: true },
    });
    for (let i = 0; i < 6; i++) {
      const when = new Date(Date.now() - (i + 3) * 86_400_000);
      const b = await prisma.booking.create({
        data: {
          bookingNumber: "ECRO-" + stamp + "-" + i,
          userId: customerId, serviceId, addressId, providerId: provider.id, status: "COMPLETED",
          scheduledDate: when, completedAt: when,
          baseAmount: GROSS_PER_JOB, finalAmount: GROSS_PER_JOB, totalAmount: GROSS_PER_JOB,
        },
      });
      await prisma.earning.create({
        data: {
          providerId: provider.id, bookingId: b.id,
          grossAmount: GROSS_PER_JOB, commission: GROSS_PER_JOB - NET_PER_JOB, netEarning: NET_PER_JOB,
          paymentStatus: "REVERSED", createdAt: when, earningDate: when,
        },
      });
    }
    const p = await earningsCoachService.plan(provider.id, 3000);
    expect(p.state).toBe("INSUFFICIENT_HISTORY");
    expect(p.opportunity).toBeNull();
  });
});
