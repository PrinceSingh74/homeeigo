import { describe, expect, test } from "bun:test";
import { serviceCatalogConfigSchema } from "../lib/service-catalog-config";
import {
  applyMatchingWeights,
  assertSplitAllowed,
  assertWalletAllowed,
  configuredMatchingWeights,
  paymentCapabilities,
  qualityBlocksCompletion,
  qualitySnapshot,
  warrantyWindow,
} from "../lib/service-runtime-policy";

describe("payment policy", () => {
  test("unset flags keep today's allow behaviour", () => {
    const cfg = serviceCatalogConfigSchema.parse({});
    expect(paymentCapabilities(cfg)).toEqual({
      walletAvailable: true,
      couponAvailable: true,
      membershipAvailable: true,
      splitPaymentAvailable: true,
    });
    expect(assertWalletAllowed(cfg)).toBeNull();
    expect(assertSplitAllowed(cfg)).toBeNull();
  });

  test("explicit false is enforced", () => {
    const cfg = serviceCatalogConfigSchema.parse({
      payment: { walletAllowed: false, splitPaymentAllowed: false, couponAllowed: false, membershipAllowed: false },
    });
    expect(paymentCapabilities(cfg).walletAvailable).toBe(false);
    expect(assertWalletAllowed(cfg)).toBe("WALLET_NOT_ALLOWED");
    expect(assertSplitAllowed(cfg)).toBe("SPLIT_NOT_ALLOWED");
  });
});

describe("matching weights", () => {
  test("unset matching keeps the historical additive formula", () => {
    expect(configuredMatchingWeights(serviceCatalogConfigSchema.parse({}))).toBeNull();
  });

  test("configured weights rebalance the existing components", () => {
    const cfg = serviceCatalogConfigSchema.parse({
      matching: { ratingWeight: 1, distanceWeight: 0, availabilityWeight: 0, responseWeight: 0, completionWeight: 0 },
    });
    const weights = configuredMatchingWeights(cfg)!;
    const score = applyMatchingWeights(
      { ratingScore: 30, distanceScore: 25, availabilityScore: 20, responseScore: 15, completionScore: 10 },
      weights,
    );
    expect(score).toBe(100);
  });
});

describe("quality completion gate", () => {
  test("unset quality does not block", () => {
    expect(qualitySnapshot(serviceCatalogConfigSchema.parse({}))).toBeNull();
    expect(qualityBlocksCompletion(null, { photos: 0, hasBefore: false, hasAfter: false, checklistComplete: false })).toBeNull();
  });

  test("proofRequired blocks without photos", () => {
    const q = qualitySnapshot(serviceCatalogConfigSchema.parse({ quality: { proofRequired: true } }));
    expect(qualityBlocksCompletion(q, { photos: 0, hasBefore: false, hasAfter: false, checklistComplete: true })).toBe(
      "QUALITY_PROOF_REQUIRED",
    );
    expect(qualityBlocksCompletion(q, { photos: 1, hasBefore: false, hasAfter: false, checklistComplete: true })).toBeNull();
  });

  test("checklist blocks until complete", () => {
    const q = qualitySnapshot(serviceCatalogConfigSchema.parse({ quality: { checklist: ["Wipe surfaces"] } }));
    expect(qualityBlocksCompletion(q, { photos: 0, hasBefore: false, hasAfter: false, checklistComplete: false })).toBe(
      "QUALITY_CHECKLIST_REQUIRED",
    );
    expect(qualityBlocksCompletion(q, { photos: 0, hasBefore: false, hasAfter: false, checklistComplete: true })).toBeNull();
  });
});

describe("warranty window", () => {
  test("disabled quality does not open a warranty", () => {
    expect(warrantyWindow(null, new Date("2026-09-20T00:00:00.000Z"))).toBeNull();
  });

  test("configured days record an until timestamp", () => {
    const q = qualitySnapshot(serviceCatalogConfigSchema.parse({ quality: { warrantyDays: 30 } }));
    const w = warrantyWindow(q, new Date("2026-09-20T00:00:00.000Z"));
    expect(w?.days).toBe(30);
    expect(w?.until).toBe("2026-10-20T00:00:00.000Z");
  });

  test("elapsed window is identifiable from until without a Warranty table", () => {
    const q = qualitySnapshot(serviceCatalogConfigSchema.parse({ quality: { warrantyDays: 7 } }));
    const w = warrantyWindow(q, new Date("2026-01-01T00:00:00.000Z"));
    expect(w?.until).toBe("2026-01-08T00:00:00.000Z");
    expect(new Date("2026-01-09T00:00:00.000Z") > new Date(w!.until)).toBe(true);
    expect(new Date("2026-01-07T00:00:00.000Z") > new Date(w!.until)).toBe(false);
  });
});
