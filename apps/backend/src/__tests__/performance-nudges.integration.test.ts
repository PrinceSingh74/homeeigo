/**
 * PARTNER INTELLIGENCE — Item 5, Performance Nudges.
 *
 * Runs ONLY on the isolated `homigo_p39` database and aborts otherwise.
 *
 * The property under defence is anti-fabrication. A nudge is a claim about a partner's behaviour,
 * and a wrong one is worse than none: it erodes trust in every other number the platform shows
 * them. So the negative cases matter more than the positive ones here — 1 of 1 must never become a
 * 100% trend, a single 5-star rating must never become a rating signal, and absent history must
 * never read as improvement.
 */
import { refuseIfNotIsolatedTestDb } from "./helpers/isolated-test-db";
import { describe, test, expect, beforeAll } from "bun:test";
import prisma from "../lib/prisma";
import { performanceNudgesService, NUDGE_RULES_VERSION } from "../services/performance-nudges.service";

let providerTrend = "";   // large, genuinely changed samples
let providerThin = "";    // 1 event per period — the fabrication trap
let providerNone = "";    // nothing at all
let serviceId = "";
let addressId = "";
let customerId = "";
let source = "";

const DAY = 86_400_000;
const inCurrent = (d = 5) => new Date(Date.now() - d * DAY);
const inBaseline = (d = 40) => new Date(Date.now() - d * DAY);

beforeAll(async () => {
  const db = (await prisma.$queryRawUnsafe<Array<{ db: string }>>("SELECT current_database() AS db"))[0].db;
  refuseIfNotIsolatedTestDb(db);

  source = await Bun.file(`${import.meta.dir}/../services/performance-nudges.service.ts`).text();

  const stamp = Date.now();
  const mkProvider = async (tag: string, phone: string) => {
    const user = await prisma.user.create({
      data: { firstName: tag, lastName: "PN", password: "x", role: "VENDOR", phoneNumber: phone, email: tag + "@pn.test" },
    });
    const p = await prisma.provider.create({
      data: {
        userId: user.id, businessName: tag, isActive: true, isVerified: true,
        isApproved: true, registrationStatus: "APPROVED",
      },
    });
    return p.id;
  };

  providerTrend = await mkProvider("pn-trend-" + stamp, "+9168" + String(stamp).slice(-8));
  providerThin = await mkProvider("pn-thin-" + stamp, "+9167" + String(stamp).slice(-8));
  providerNone = await mkProvider("pn-none-" + stamp, "+9166" + String(stamp).slice(-8));

  const svc =
    (await prisma.service.findFirst({ select: { id: true } })) ??
    (await prisma.service.create({
      data: {
        name: "PN Fixture Service " + stamp, slug: "pn-fixture-" + stamp, description: "fixture",
        category: "cleaning", basePrice: 500, estimatedDuration: 60, isActive: true,
      },
      select: { id: true },
    }));
  serviceId = svc.id;

  /**
   * A fresh customer + address per batch.
   *
   * `bookings_user_slot_excl` is an INCLUSIVE tstzrange scoped to one user, so a single fixture
   * customer cannot hold many same-day bookings however they are spaced. Separate customers avoid
   * the interaction and match reality: different offers come from different people.
   */
  let batchSeq = 0;
  const mkCustomer = async () => {
    batchSeq += 1;
    const u = await prisma.user.create({
      data: {
        firstName: "pn-cust-" + stamp + "-" + batchSeq, lastName: "PN", password: "x", role: "CUSTOMER",
        phoneNumber: "+916" + String(batchSeq) + String(stamp).slice(-7),
        email: "pnc" + stamp + "-" + batchSeq + "@pn.test",
      },
    });
    const a = await prisma.address.create({
      data: {
        userId: u.id, label: "Home", addressLine1: "1 PN St", city: "Bengaluru", state: "KA",
        zipCode: "560001", latitude: 12.9716, longitude: 77.5946,
      },
    });
    return { userId: u.id, addressId: a.id };
  };

  const primary = await mkCustomer();
  customerId = primary.userId;
  addressId = primary.addressId;

  /**
   * Dispatch offers with a decided outcome, dated into one window or the other.
   *
   * `AssignmentAttempt` requires a real `jobId`, and `AssignmentJob` requires a real `bookingId`,
   * so each offer needs a backing booking. That is the schema enforcing that an offer is always an
   * offer OF something — worth honouring in the fixture rather than working around.
   */
  const seedAttempts = async (providerId: string, accepted: number, timedOut: number, when: Date, tag: string) => {
    const batch = await mkCustomer();
    const total = accepted + timedOut;
    const prefix = "PN-OFFER-" + tag + "-" + stamp + "-";

    // Batched rather than row-by-row: the earlier sequential version made ~320 round-trips and
    // tripped the hook timeout once the database had grown. Three inserts plus two id lookups is
    // the same fixture in a fraction of the time, and no longer timing-fragile.
    await prisma.booking.createMany({
      data: Array.from({ length: total }, (_, i) => ({
        bookingNumber: prefix + i,
        userId: batch.userId,
        serviceId,
        addressId: batch.addressId,
        status: "PENDING" as const,
        // `bookings_user_slot_excl` is an INCLUSIVE tstzrange, so adjacent hour slots still touch.
        scheduledDate: new Date(when.getTime() + i * 7_200_000),
        createdAt: when,
        baseAmount: 500,
        finalAmount: 500,
        totalAmount: 500,
      })),
    });
    const bookings = await prisma.booking.findMany({
      where: { bookingNumber: { startsWith: prefix } },
      select: { id: true },
    });
    await prisma.assignmentJob.createMany({ data: bookings.map((b) => ({ bookingId: b.id })) });
    const jobs = await prisma.assignmentJob.findMany({
      where: { bookingId: { in: bookings.map((b) => b.id) } },
      select: { id: true },
    });
    await prisma.assignmentAttempt.createMany({
      data: jobs.map((j, i) => ({
        providerId,
        jobId: j.id,
        status: i < accepted ? ("ACCEPTED" as const) : ("TIMEOUT" as const),
        dispatchedAt: when,
      })),
    });
  };

  const seedBookings = async (providerId: string, completed: number, cancelled: number, when: Date, tag: string) => {
    const batch = await mkCustomer();
    await prisma.booking.createMany({
      data: Array.from({ length: completed + cancelled }, (_, i) => {
        const isDone = i < completed;
        const at = new Date(when.getTime() + i * 7_200_000);
        return {
          bookingNumber: "PN-" + tag + "-" + stamp + "-" + i,
          userId: batch.userId,
          serviceId,
          addressId: batch.addressId,
          providerId,
          status: isDone ? ("COMPLETED" as const) : ("CANCELLED_BY_PROVIDER" as const),
          scheduledDate: at,
          createdAt: when,
          ...(isDone ? { completedAt: at } : {}),
          baseAmount: 500,
          finalAmount: 500,
          totalAmount: 500,
        };
      }),
    });
  };

  // TREND partner: acceptance clearly up (20/40 -> 40/40), completion clearly down.
  await seedAttempts(providerTrend, 20, 20, inBaseline(), "tb");
  await seedAttempts(providerTrend, 38, 2, inCurrent(), "tc");
  await seedBookings(providerTrend, 30, 2, inBaseline(), "base");
  await seedBookings(providerTrend, 12, 20, inCurrent(), "cur");

  // THIN partner: exactly one decided offer per window, and one booking per window. Nothing here
  // is evidence of anything, and the service must say so.
  await seedAttempts(providerThin, 0, 1, inBaseline(), "nb");
  await seedAttempts(providerThin, 1, 0, inCurrent(), "nc");
  await seedBookings(providerThin, 0, 1, inBaseline(), "tbase");
  await seedBookings(providerThin, 1, 0, inCurrent(), "tcur");
});

describe("PN — fixtures produce real evidence (guards against vacuous passes)", () => {
  test("the trend partner yields OK metrics and at least one nudge", async () => {
    const r = await performanceNudgesService.compute(providerTrend);
    expect(r.state).toBe("OK");
    expect(r.metrics.length).toBe(4);
    expect(r.nudges.length).toBeGreaterThan(0);
  });
});

describe("PN — ANTI-FABRICATION: thin data never becomes a trend", () => {
  test("one decided offer per window produces NO acceptance nudge", async () => {
    // 1/1 = 100% against 0/1 = 0% is the textbook false trend. Agresti-Coull adjustment plus the
    // two-sigma test must suppress it.
    const r = await performanceNudgesService.compute(providerThin);
    const acc = r.metrics.find((m) => m.metric === "ACCEPTANCE_RATE")!;
    expect(acc.currentSample).toBe(1);
    expect(acc.baselineSample).toBe(1);
    expect(acc.significant).toBe(false);
    expect(r.nudges.find((n) => n.metric === "ACCEPTANCE_RATE")).toBeUndefined();
  });

  test("one booking per window produces NO completion or cancellation nudge", async () => {
    const r = await performanceNudgesService.compute(providerThin);
    for (const code of ["COMPLETION_RATE", "PROVIDER_CANCELLATION_RATE"] as const) {
      const m = r.metrics.find((x) => x.metric === code)!;
      expect(m.significant).toBe(false);
      expect(r.nudges.find((n) => n.metric === code)).toBeUndefined();
    }
  });

  test("a single rating is INSUFFICIENT_HISTORY, never a rating trend", async () => {
    await prisma.rating.create({
      data: {
        bookingId: (await prisma.booking.create({
          data: {
            bookingNumber: "PN-RATE-" + Date.now(), userId: customerId, serviceId, addressId,
            providerId: providerThin, status: "COMPLETED", scheduledDate: inCurrent(),
            completedAt: inCurrent(), createdAt: inCurrent(),
            baseAmount: 500, finalAmount: 500, totalAmount: 500,
          },
        })).id,
        userId: customerId, providerId: providerThin, stars: 5, createdAt: inCurrent(),
      },
    });
    const r = await performanceNudgesService.compute(providerThin);
    const rating = r.metrics.find((m) => m.metric === "AVERAGE_RATING")!;
    expect(rating.state).toBe("INSUFFICIENT_HISTORY");
    expect(rating.reasonCode).toBe("NEEDS_AT_LEAST_2_RATINGS");
    expect(rating.significant).toBe(false);
    expect(r.nudges.find((n) => n.metric === "AVERAGE_RATING")).toBeUndefined();
  });

  test("no events is INSUFFICIENT_HISTORY, never a zero rate and never improvement", async () => {
    const r = await performanceNudgesService.compute(providerNone);
    for (const m of r.metrics) {
      expect(m.state).not.toBe("OK");
      expect(m.currentValue).toBeNull();
      expect(m.significant).toBe(false);
      expect(typeof m.reasonCode).toBe("string");
    }
    expect(r.nudges).toEqual([]);
    expect(r.state).toBe("INSUFFICIENT_HISTORY");
  });

  test("zero offers never reads as a perfect score", async () => {
    // The dispatch engine defaults acceptanceRate to 100 when there are no offers, which is right
    // for routing and wrong for coaching. This layer must not copy that.
    const r = await performanceNudgesService.compute(providerNone);
    const acc = r.metrics.find((m) => m.metric === "ACCEPTANCE_RATE")!;
    expect(acc.currentValue).not.toBe(100);
    expect(acc.currentValue).toBeNull();
  });
});

describe("PN — metric definitions match the platform's", () => {
  test("acceptance uses ACCEPTED / (ACCEPTED + REJECTED + TIMEOUT)", async () => {
    const r = await performanceNudgesService.compute(providerTrend);
    const acc = r.metrics.find((m) => m.metric === "ACCEPTANCE_RATE")!;
    // Seeded 38 accepted of 40 decided in the current window.
    expect(acc.currentSample).toBe(40);
    expect(acc.currentValue).toBe(95);
    expect(acc.baselineSample).toBe(40);
    expect(acc.baselineValue).toBe(50);
    expect(acc.definition).toContain("timed-out");
  });

  test("completion excludes customer cancellations from the denominator", async () => {
    const before = await performanceNudgesService.compute(providerTrend);
    const completionBefore = before.metrics.find((m) => m.metric === "COMPLETION_RATE")!;
    // A customer cancellation must not move a partner's completion rate at all.
    await prisma.booking.create({
      data: {
        bookingNumber: "PN-USERCANCEL-" + Date.now(), userId: customerId, serviceId, addressId,
        providerId: providerTrend, status: "CANCELLED_BY_USER", scheduledDate: inCurrent(),
        createdAt: inCurrent(), baseAmount: 500, finalAmount: 500, totalAmount: 500,
      },
    });
    const after = await performanceNudgesService.compute(providerTrend);
    const completionAfter = after.metrics.find((m) => m.metric === "COMPLETION_RATE")!;
    expect(completionAfter.currentSample).toBe(completionBefore.currentSample);
    expect(completionAfter.currentValue).toBe(completionBefore.currentValue);
  });

  test("every metric states its own definition", async () => {
    const r = await performanceNudgesService.compute(providerTrend);
    for (const m of r.metrics) {
      expect(typeof m.definition).toBe("string");
      expect(m.definition.length).toBeGreaterThan(20);
    }
  });

  test("the window is the platform's 30 days, not an invented one", async () => {
    const r = await performanceNudgesService.compute(providerTrend);
    expect(r.windowDays).toBe(30);
    const m = r.metrics[0];
    const spanDays = (Date.parse(m.period.currentTo) - Date.parse(m.period.currentFrom)) / DAY;
    expect(Math.round(spanDays)).toBe(30);
  });
});

describe("PN — significance is derived, not asserted", () => {
  test("a significant change exceeds its own stated threshold", async () => {
    const r = await performanceNudgesService.compute(providerTrend);
    for (const m of r.metrics.filter((x) => x.significant)) {
      expect(m.significanceThreshold).not.toBeNull();
      // `adjustedChange` is the value the test used; `change` is the raw movement shown to the
      // partner. Only the former shares a scale with the threshold.
      expect(Math.abs(m.adjustedChange!)).toBeGreaterThan(m.significanceThreshold!);
    }
  });

  test("a non-significant change does not exceed it", async () => {
    const r = await performanceNudgesService.compute(providerThin);
    for (const m of r.metrics.filter((x) => x.state === "OK" && !x.significant)) {
      if (m.significanceThreshold !== null && m.adjustedChange !== null) {
        expect(Math.abs(m.adjustedChange)).toBeLessThanOrEqual(m.significanceThreshold);
      }
    }
  });

  test("confidence exists only where a change was significant", async () => {
    const r = await performanceNudgesService.compute(providerTrend);
    for (const m of r.metrics) {
      if (m.significant) expect(m.confidence).not.toBeNull();
      else expect(m.confidence).toBeNull();
      if (m.confidence !== null) expect(m.confidence).toBeLessThanOrEqual(0.95);
    }
  });

  test("every nudge carries its full evidence", async () => {
    const r = await performanceNudgesService.compute(providerTrend);
    for (const n of r.nudges) {
      expect(n.evidence.currentSample).toBeGreaterThan(0);
      expect(n.evidence.baselineSample).toBeGreaterThan(0);
      expect(n.evidence.currentValue).not.toBeNull();
      expect(n.evidence.baselineValue).not.toBeNull();
      expect(n.evidence.source).toContain("db:");
      expect(typeof n.evidence.observedAt).toBe("string");
    }
  });
});

describe("PN — non-punitive, non-causal language", () => {
  test("no nudge attributes cause or intent", async () => {
    const r = await performanceNudgesService.compute(providerTrend);
    const all = r.nudges.map((n) => n.message.toLowerCase()).join(" ");
    for (const banned of ["because", "due to", "caused", "you failed", "careless", "unreliable", "poor", "bad", "lazy"]) {
      expect(all).not.toContain(banned);
    }
  });

  test("severities stay within the neutral vocabulary", async () => {
    const r = await performanceNudgesService.compute(providerTrend);
    for (const n of r.nudges) {
      expect(["INFO", "OPPORTUNITY", "IMPROVEMENT", "WARNING"]).toContain(n.severity);
    }
  });

  test("a message always states both sides and the sample", async () => {
    const r = await performanceNudgesService.compute(providerTrend);
    for (const n of r.nudges) {
      expect(n.message).toContain("from");
      expect(n.message).toContain("to");
      expect(n.message).toContain("in sample");
    }
  });

  test("an improvement is labelled as such, not as a warning", async () => {
    const r = await performanceNudgesService.compute(providerTrend);
    const acc = r.nudges.find((n) => n.metric === "ACCEPTANCE_RATE");
    // Acceptance was seeded rising, so if it nudges at all it must read as improvement.
    if (acc) expect(acc.severity).toBe("IMPROVEMENT");
  });
});

describe("PN — read-only", () => {
  test("the service opens no transaction and calls no mutator", () => {
    for (const forbidden of [
      "$transaction",
      "prisma.provider.update",
      "prisma.booking.update",
      "prisma.earning.",
      "prisma.walletTransaction",
      "prisma.withdrawal",
      "routeNotification",
      "sendPush",
      "push.adapter",
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });

  test("computing nudges changes no row", async () => {
    const snap = async () => ({
      providers: await prisma.provider.count(),
      bookings: await prisma.booking.count(),
      attempts: await prisma.assignmentAttempt.count(),
      ratings: await prisma.rating.count(),
      wallet: await prisma.walletTransaction.count(),
      outbox: await prisma.eventOutbox.count(),
      notifications: await prisma.notification.count(),
    });
    const before = await snap();
    await performanceNudgesService.compute(providerTrend);
    await performanceNudgesService.compute(providerThin);
    expect(await snap()).toEqual(before);
  });
});

describe("PN — determinism and isolation", () => {
  test("same input produces byte-identical output", async () => {
    const a = await performanceNudgesService.compute(providerTrend);
    const b = await performanceNudgesService.compute(providerTrend);
    const strip = (r: typeof a) =>
      JSON.stringify({
        ...r,
        generatedAt: "",
        // Every period boundary is derived from `now`, so all four shift between calls — as does
        // observedAt. The decisions (values, samples, significance, nudges) must not.
        metrics: r.metrics.map((m) => ({ ...m, observedAt: "", period: null })),
        nudges: r.nudges.map((n) => ({ ...n, evidence: { ...n.evidence, observedAt: "", period: null } })),
      });
    expect(strip(b)).toBe(strip(a));
  });

  test("an unknown provider is PROVIDER_NOT_FOUND, not an empty result", async () => {
    const r = await performanceNudgesService.compute("does-not-exist");
    expect(r.state).toBe("PROVIDER_NOT_FOUND");
    expect(r.metrics).toEqual([]);
    expect(r.nudges).toEqual([]);
  });

  test("one partner's metrics never reflect another's events", async () => {
    const trend = await performanceNudgesService.compute(providerTrend);
    const none = await performanceNudgesService.compute(providerNone);
    expect(trend.metrics.find((m) => m.metric === "ACCEPTANCE_RATE")!.currentSample).toBe(40);
    // If events leaked, this partner would show a sample it never generated.
    expect(none.metrics.find((m) => m.metric === "ACCEPTANCE_RATE")!.currentSample).toBe(0);
  });

  test("the rules fingerprint travels with every result", async () => {
    const r = await performanceNudgesService.compute(providerTrend);
    expect(r.rulesVersion).toBe(NUDGE_RULES_VERSION);
  });
});
