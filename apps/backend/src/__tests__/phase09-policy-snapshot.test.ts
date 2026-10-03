/**
 * Phase 09 — the cancellation policy is versioned data, and a booking is quoted against the copy it
 * froze at creation.
 *
 * Two separate claims:
 *   1. moving the tiers from hard-coded numbers into data changed NO amount and NO boundary;
 *   2. a booking carrying a frozen policy is charged by that policy, not by the current one.
 */
import { describe, expect, test } from "bun:test";
import { CANCELLATION_POLICY, CANCELLATION_POLICY_VERSION, cancellationPolicyFromSnapshot, cancellationPolicyService, type CancellationPolicySnapshot, CANCELLATION_POLICY_V1 } from "../services/cancellation-policy.service";

const NOW = new Date("2026-12-24T10:00:00.000Z");
const inHours = (h: number) => new Date(NOW.getTime() + h * 3_600_000);
const quote = (hours: number, extra: Record<string, unknown> = {}) =>
  cancellationPolicyService.calculate({
    paidAmount: 1000,
    scheduledDate: inHours(hours),
    bookingStatus: "ACCEPTED",
    cancelledBy: "user",
    now: NOW,
    ...extra,
  });

describe("the published tiers and the charged tiers are the same tiers", () => {
  test("every tier the calculator can return is one the policy publishes", () => {
    const published = new Set(CANCELLATION_POLICY.tiers.map((t) => t.id));
    for (const h of [100, 25, 24.0001, 24, 12, 2, 1.999, 0.1]) {
      expect(published.has(quote(h).tier)).toBe(true);
    }
    expect(published.has(quote(1, { bookingStatus: "IN_PROGRESS" }).tier)).toBe(true);
  });

  test("the under-2-hours tier is `late`, the id the policy publishes (it used to answer `very_late`)", () => {
    const q = quote(1);
    expect(q.tier).toBe("late");
    expect(q.feePercent).toBe(25);
    expect(q.refundAmount).toBe(750);
  });
});

describe("boundaries", () => {
  /**
   * v1's boundaries are pinned against the FROZEN v1 policy, because that is what a booking placed
   * under it is still charged by. The original comparisons were `> 24` (exclusive) and `>= 2`
   * (inclusive) and normalising either would have moved real money at the edge.
   */
  test("v1: more than 24 hours is free; exactly 24 hours is the standard window", () => {
    const v1 = (h: number) => quote(h, { policy: CANCELLATION_POLICY_V1 });
    expect(v1(24.5).tier).toBe("free");
    expect(v1(24.5).refundAmount).toBe(1000);
    expect(v1(24).tier).toBe("standard"); // `> 24`, not `>= 24`
    expect(v1(24).refundAmount).toBe(900);
    expect(v1(2).tier).toBe("standard");
    expect(v1(1.999).tier).toBe("late");
  });

  test("v2 (active): 2 hours or more is free, and the boundary is inclusive", () => {
    expect(quote(24).tier).toBe("free");
    expect(quote(2).tier).toBe("free");
    expect(quote(2).refundAmount).toBe(1000);
    expect(quote(1.999).tier).toBe("late");
    expect(quote(1.999).refundAmount).toBe(750);
  });

  test("in progress is 50%, and a provider cancellation or admin-full is always whole", () => {
    expect(quote(1, { bookingStatus: "IN_PROGRESS" })).toMatchObject({ tier: "in_progress", refundAmount: 500 });
    expect(quote(1, { cancelledBy: "provider" })).toMatchObject({ tier: "provider_cancel", refundAmount: 1000 });
    expect(quote(1, { cancelledBy: "admin", adminRefundPolicy: "full" })).toMatchObject({ refundAmount: 1000 });
  });

  test("a rounded fee never returns more than was paid, and never less than zero", () => {
    for (const paid of [0, 0.01, 33.33, 999.99, 123456.78]) {
      for (const h of [48, 5, 0.5]) {
        const q = cancellationPolicyService.calculate({
          paidAmount: paid, scheduledDate: inHours(h), bookingStatus: "ACCEPTED", cancelledBy: "user", now: NOW,
        });
        expect(q.refundAmount).toBeGreaterThanOrEqual(0);
        expect(q.refundAmount).toBeLessThanOrEqual(q.paidAmount);
        expect(Math.round((q.refundAmount + q.feeAmount) * 100) / 100).toBe(q.paidAmount);
      }
    }
  });
});

describe("a booking is charged by the policy it was sold under", () => {
  /** A policy that differs from today's in every number that matters. */
  const frozen: CancellationPolicySnapshot = {
    version: "cancellation.test-frozen",
    tiers: [
      { id: "free", label: "Free", window: "more than 6h", feePercent: 0, refundPercent: 100, minHoursBefore: 6, boundary: "exclusive", message: "Free cancellation." },
      { id: "late", label: "Late", window: "under 6h", feePercent: 40, refundPercent: 60, minHoursBefore: 0, boundary: "inclusive", message: "40% fee applies." },
    ],
  };

  test("the frozen tiers decide the refund, not the current ones", () => {
    // The active policy (v2) refunds 12 hours out in full; the frozen policy below does not.
    expect(quote(12).refundAmount).toBe(1000);
    const q = quote(12, { policy: frozen });
    expect(q.tier).toBe("free");
    expect(q.refundAmount).toBe(1000);
    expect(q.message).toBe("Free cancellation.");
  });

  test("the frozen policy's own late tier applies below its own threshold", () => {
    const q = quote(3, { policy: frozen });
    expect(q.tier).toBe("late");
    expect(q.feePercent).toBe(40);
    expect(q.refundAmount).toBe(600);
  });

  test("no snapshot means the current policy — the only honest answer for a row without one", () => {
    expect(quote(12, { policy: null }).refundAmount).toBe(quote(12).refundAmount);
  });

  test("a booking frozen on v1 is still charged v1 after v2 was published", () => {
    const q = quote(12, { policy: CANCELLATION_POLICY_V1 });
    expect(q.tier).toBe("standard");
    expect(q.feePercent).toBe(10);
    expect(q.refundAmount).toBe(900);
  });
});

describe("a snapshot is validated, not trusted", () => {
  const read = cancellationPolicyFromSnapshot;

  test("the policy written at booking time reads back exactly", () => {
    const snap = { policy: { cancellation: CANCELLATION_POLICY } };
    const back = read(snap);
    expect(back?.version).toBe(CANCELLATION_POLICY_VERSION);
    expect(back?.tiers.length).toBe(CANCELLATION_POLICY.tiers.length);
  });

  test("missing, empty and malformed snapshots return null rather than a half-parsed policy", () => {
    for (const bad of [null, undefined, {}, { policy: {} }, { policy: { cancellation: {} } }, "nope", 7,
      { policy: { cancellation: { version: 1, tiers: [] } } },
      { policy: { cancellation: { version: "v", tiers: "no" } } }]) {
      expect(read(bad)).toBeNull();
    }
  });

  test("a tier with an impossible fee is dropped, and a policy left with no time tier is refused", () => {
    const withBadFee = {
      policy: { cancellation: { version: "v", tiers: [
        { id: "late", feePercent: 400, message: "m", minHoursBefore: 0 },
        { id: "free", feePercent: 0, message: "m", minHoursBefore: 24 },
      ] } },
    };
    expect(read(withBadFee)?.tiers.map((t) => t.id)).toEqual(["free"]);

    const onlyStatusTier = {
      policy: { cancellation: { version: "v", tiers: [{ id: "in_progress", feePercent: 50, message: "m", minHoursBefore: null }] } },
    };
    expect(read(onlyStatusTier)).toBeNull();
  });

  test("a policy whose tiers are all rejected cannot silently zero a refund", () => {
    const allBad = { policy: { cancellation: { version: "v", tiers: [{ id: "x", feePercent: "free", message: 2 }] } } };
    expect(read(allBad)).toBeNull();
    // and the caller therefore quotes the live policy (v2: free at 12 hours out)
    expect(quote(12, { policy: read(allBad) }).refundAmount).toBe(1000);
  });
});
