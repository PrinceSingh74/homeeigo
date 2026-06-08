import prisma from "../lib/prisma";
import { SubscriptionStatus } from "@prisma/client";

/**
 * Membership Entitlement Engine — the SINGLE server-side authority on what a
 * user is allowed to do/receive by virtue of their active membership.
 *
 * Benefits live on the plan as structured rows (SubscriptionBenefit.type/value);
 * this service resolves a user's *effective* entitlements by folding the benefits
 * of their currently-active subscription. Nothing here trusts the frontend — every
 * caller (booking pricing, premium-only gating, cashback, support priority) asks
 * this service, never the client.
 */

/** Canonical benefit types. `type` null on a benefit = pure display label. */
export const BENEFIT = {
  DISCOUNT_PCT: "DISCOUNT_PCT",
  CASHBACK_PCT: "CASHBACK_PCT",
  PREMIUM_ONLY_ACCESS: "PREMIUM_ONLY_ACCESS",
  PRIORITY_BOOKING: "PRIORITY_BOOKING",
  PRIORITY_SUPPORT: "PRIORITY_SUPPORT",
  FREE_DELIVERY: "FREE_DELIVERY",
} as const;

export type BenefitType = (typeof BENEFIT)[keyof typeof BENEFIT];

export type Entitlements = {
  hasMembership: boolean;
  tier: string | null;
  planName: string | null;
  expiresAt: Date | null;
  discountPct: number; // 0..100
  cashbackPct: number; // 0..100
  premiumAccess: boolean; // may book premiumOnly services
  priorityBooking: boolean;
  prioritySupport: boolean;
  freeDelivery: boolean;
  benefits: { type: string; value: number | null; label: string }[];
};

const EMPTY: Entitlements = {
  hasMembership: false,
  tier: null,
  planName: null,
  expiresAt: null,
  discountPct: 0,
  cashbackPct: 0,
  premiumAccess: false,
  priorityBooking: false,
  prioritySupport: false,
  freeDelivery: false,
  benefits: [],
};

const clampPct = (n: number) => Math.max(0, Math.min(100, n));

export class EntitlementService {
  /**
   * Resolve a user's effective entitlements from their active subscription.
   * Read-only and side-effect free (does not write EXPIRED) — it simply ignores
   * subscriptions past their term via the query, so it's safe on hot paths.
   */
  async resolve(userId: string): Promise<Entitlements> {
    const sub = await prisma.userSubscription.findFirst({
      where: { userId, status: SubscriptionStatus.ACTIVE, expiresAt: { gt: new Date() } },
      include: { plan: { include: { benefits: true } } },
      orderBy: { expiresAt: "desc" },
    });
    if (!sub || !sub.plan) return { ...EMPTY };

    const out: Entitlements = {
      ...EMPTY,
      hasMembership: true,
      tier: sub.plan.tier,
      planName: sub.plan.name,
      expiresAt: sub.expiresAt,
    };

    for (const b of sub.plan.benefits) {
      if (!b.type) continue; // display-only label
      const v = b.value ?? 0;
      switch (b.type) {
        case BENEFIT.DISCOUNT_PCT:
          out.discountPct = clampPct(Math.max(out.discountPct, v));
          break;
        case BENEFIT.CASHBACK_PCT:
          out.cashbackPct = clampPct(Math.max(out.cashbackPct, v));
          break;
        case BENEFIT.PREMIUM_ONLY_ACCESS:
          out.premiumAccess = true;
          break;
        case BENEFIT.PRIORITY_BOOKING:
          out.priorityBooking = true;
          break;
        case BENEFIT.PRIORITY_SUPPORT:
          out.prioritySupport = true;
          break;
        case BENEFIT.FREE_DELIVERY:
          out.freeDelivery = true;
          break;
      }
      out.benefits.push({ type: b.type, value: b.value, label: b.label });
    }
    return out;
  }

  /** True if the user may book a `premiumOnly` service. */
  async canAccessPremiumServices(userId: string): Promise<boolean> {
    return (await this.resolve(userId)).premiumAccess;
  }

  /**
   * Membership discount for a booking, computed from the DB plan (tamper-proof).
   * Returns whole-rupee discount + the pct applied.
   */
  async membershipDiscount(
    userId: string,
    baseAmount: number,
  ): Promise<{ discountPct: number; discount: number }> {
    const { discountPct } = await this.resolve(userId);
    const discount = discountPct > 0 ? Math.round((baseAmount * discountPct) / 100) : 0;
    return { discountPct, discount };
  }

  /** Current period bucket for a quota benefit. */
  private periodKey(quotaPeriod: string | null): string {
    if (quotaPeriod === "MONTH") {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    }
    return "TOTAL";
  }

  /**
   * Record consumption of a benefit (count + cumulative ₹ value) in the
   * server-side usage ledger. Idempotent per call; powers quota + analytics.
   */
  async recordUsage(
    userId: string,
    benefitType: string,
    opts: { amount?: number; quotaPeriod?: string | null } = {},
  ): Promise<void> {
    const period = this.periodKey(opts.quotaPeriod ?? "MONTH");
    await prisma.membershipBenefitUsage.upsert({
      where: { userId_benefitType_period: { userId, benefitType, period } },
      create: { userId, benefitType, period, count: 1, amount: opts.amount ?? 0 },
      update: { count: { increment: 1 }, amount: { increment: opts.amount ?? 0 }, lastUsedAt: new Date() },
    });
  }

  /** Remaining quota for a capped benefit (null = unlimited). */
  async remainingQuota(
    userId: string,
    benefitType: string,
    limit: number,
    quotaPeriod: string | null = "MONTH",
  ): Promise<number> {
    const period = this.periodKey(quotaPeriod);
    const row = await prisma.membershipBenefitUsage.findUnique({
      where: { userId_benefitType_period: { userId, benefitType, period } },
    });
    return Math.max(0, limit - (row?.count ?? 0));
  }

  /** Server-side quota gate — returns false when benefit quota is exhausted. */
  async canUseBenefit(userId: string, benefitType: string): Promise<boolean> {
    const sub = await prisma.userSubscription.findFirst({
      where: { userId, status: SubscriptionStatus.ACTIVE, expiresAt: { gt: new Date() } },
      include: { plan: { include: { benefits: true } } },
    });
    if (!sub) return false;
    const benefit = sub.plan.benefits.find((b) => b.type === benefitType);
    if (!benefit?.quotaLimit) return true;
    const remaining = await this.remainingQuota(
      userId,
      benefitType,
      benefit.quotaLimit,
      benefit.quotaPeriod,
    );
    return remaining > 0;
  }
}

export const entitlementService = new EntitlementService();
