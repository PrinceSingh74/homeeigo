import { MembershipCouponStatus, type Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import { parsePagination } from "../lib/pagination";
import { cacheService } from "./cache.service";
import { entitlementService } from "./entitlement.service";
import { FraudEventType } from "@prisma/client";
import { fraudSignalService } from "./fraud-signal.service";

export type MembershipCouponResult =
  | { ok: true; couponId: string; code: string; discount: number }
  | { ok: false; error: string };

/**
 * Enterprise membership coupon platform — server-validated, fraud-protected.
 */
export class MembershipCouponService {
  async validateForUser(
    userId: string,
    code: string,
    baseAmount: number,
    ctx: { serviceCategory?: string; geography?: string } = {},
  ): Promise<MembershipCouponResult> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { isEmailVerified: true },
    });
    if (!user?.isEmailVerified) return { ok: false, error: "EMAIL_NOT_VERIFIED" };

    const normalized = code.trim().toUpperCase();
    const coupon = await prisma.membershipCoupon.findUnique({
      where: { code: normalized },
      include: { rule: true, campaign: true },
    });
    if (!coupon) return { ok: false, error: "INVALID_CODE" };
    if (coupon.status !== MembershipCouponStatus.ACTIVE) return { ok: false, error: "COUPON_INACTIVE" };

    const now = new Date();
    const startsAt = coupon.startsAt ?? coupon.campaign?.startsAt;
    const expiresAt = coupon.expiresAt ?? coupon.rule?.expiresAt ?? coupon.campaign?.expiresAt;
    if (startsAt && startsAt > now) return { ok: false, error: "NOT_STARTED" };
    if (expiresAt && expiresAt < now) return { ok: false, error: "EXPIRED" };

    const maxUses = coupon.maxRedemptions ?? coupon.rule?.usageLimit;
    if (maxUses != null && coupon.redemptionCount >= maxUses) {
      return { ok: false, error: "MAX_REDEMPTIONS" };
    }

    const minOrder = coupon.minOrderAmount ?? coupon.rule?.minOrderAmount;
    if (minOrder != null && baseAmount < minOrder) return { ok: false, error: "MIN_ORDER_NOT_MET" };

    const perUserLimit = coupon.perUserLimit ?? coupon.rule?.userLimit ?? 1;
    const userRedemptions = await prisma.membershipCouponRedemption.count({
      where: { couponId: coupon.id, userId },
    });
    if (userRedemptions >= perUserLimit) return { ok: false, error: "USER_LIMIT_REACHED" };

    const planRestricted = coupon.planRestricted.length
      ? coupon.planRestricted
      : (coupon.rule?.planRestricted ?? []);
    if (planRestricted.length > 0) {
      const entitlements = await entitlementService.resolve(userId);
      const tier = (entitlements.tier ?? "free").toLowerCase();
      if (!planRestricted.map((p) => p.toLowerCase()).includes(tier)) {
        return { ok: false, error: "PLAN_NOT_ELIGIBLE" };
      }
    }

    const geo = coupon.geography ?? coupon.rule?.geography;
    if (geo && ctx.geography && geo.toLowerCase() !== ctx.geography.toLowerCase()) {
      return { ok: false, error: "GEOGRAPHY_NOT_ELIGIBLE" };
    }

    const category = coupon.serviceCategory ?? coupon.rule?.serviceCategory;
    if (category && ctx.serviceCategory && category !== ctx.serviceCategory) {
      return { ok: false, error: "CATEGORY_NOT_ELIGIBLE" };
    }

    const discount = this.computeDiscount(coupon.discountPct, coupon.discountAmount, baseAmount);
    if (discount <= 0) return { ok: false, error: "NO_DISCOUNT" };

    return { ok: true, couponId: coupon.id, code: coupon.code, discount };
  }

  private computeDiscount(pct: number | null, flat: number | null, baseAmount: number): number {
    let discount = 0;
    if (pct != null && pct > 0) discount = Math.round((baseAmount * pct) / 100);
    if (flat != null && flat > 0) discount = Math.max(discount, Math.round(flat));
    return Math.min(discount, baseAmount);
  }

  /** Atomic coupon consumption inside a booking creation transaction. */
  async consumeInTransaction(
    tx: Prisma.TransactionClient,
    couponId: string,
    userId: string,
    bookingId: string,
    discountApplied: number,
    revenueBefore: number,
    revenueAfter: number,
  ) {
    const key = `booking:${bookingId}:${couponId}`;
    const existing = await tx.membershipCouponRedemption.findUnique({
      where: { idempotencyKey: key },
    });
    if (existing) return existing;

    const coupon = await tx.membershipCoupon.findUnique({
      where: { id: couponId },
      include: { rule: true },
    });
    if (!coupon || coupon.status !== MembershipCouponStatus.ACTIVE) {
      throw new Error("COUPON_INACTIVE");
    }
    const maxUses = coupon.maxRedemptions ?? coupon.rule?.usageLimit;
    if (maxUses != null && coupon.redemptionCount >= maxUses) {
      throw new Error("MAX_REDEMPTIONS");
    }
    const perUserLimit = coupon.perUserLimit ?? coupon.rule?.userLimit ?? 1;
    const userRedemptions = await tx.membershipCouponRedemption.count({
      where: { couponId, userId },
    });
    if (userRedemptions >= perUserLimit) throw new Error("USER_LIMIT_REACHED");

    const redemption = await tx.membershipCouponRedemption.create({
      data: {
        couponId,
        userId,
        bookingId,
        discountApplied,
        revenueBefore,
        revenueAfter,
        idempotencyKey: key,
      },
    });
    await tx.membershipCoupon.update({
      where: { id: couponId },
      data: { redemptionCount: { increment: 1 } },
    });
    return redemption;
  }

  async recordRedemption(
    couponId: string,
    userId: string,
    bookingId: string,
    discountApplied: number,
    revenueBefore: number,
    revenueAfter: number,
    idempotencyKey?: string,
  ) {
    const key = idempotencyKey ?? `booking:${bookingId}:${couponId}`;
    const existing = await prisma.membershipCouponRedemption.findUnique({
      where: { idempotencyKey: key },
    });
    if (existing) return existing;

    try {
      return await prisma.$transaction(async (tx) =>
        this.consumeInTransaction(
          tx,
          couponId,
          userId,
          bookingId,
          discountApplied,
          revenueBefore,
          revenueAfter,
        ),
      );
    } catch (err) {
      void fraudSignalService
        .capture(FraudEventType.BOOKING, { userId }, { id: bookingId, type: "membership_coupon_duplicate" })
        .catch(() => undefined);
      throw err;
    }
  }

  async myCoupons(userId: string) {
    const entitlements = await entitlementService.resolve(userId);
    const tier = (entitlements.tier ?? "").toLowerCase();
    const coupons = await prisma.membershipCoupon.findMany({
      where: { status: MembershipCouponStatus.ACTIVE },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    const redemptions = await prisma.membershipCouponRedemption.findMany({
      where: { userId },
      select: { couponId: true, createdAt: true },
    });
    const usedMap = new Map(redemptions.map((r) => [r.couponId, r.createdAt]));

    return coupons
      .filter((c) => {
        if (!c.planRestricted.length) return true;
        return c.planRestricted.map((p) => p.toLowerCase()).includes(tier);
      })
      .map((c) => ({
        id: c.id,
        code: c.code,
        name: c.name,
        discountPct: c.discountPct,
        discountAmount: c.discountAmount,
        expiresAt: c.expiresAt,
        usedAt: usedMap.get(c.id)?.toISOString() ?? null,
        eligible: !usedMap.has(c.id) || c.perUserLimit > 1,
      }));
  }

  async adminList(query: Record<string, string | undefined> = {}) {
    const { page, limit, skip } = parsePagination(query);
    const status = query.status?.toUpperCase() as MembershipCouponStatus | undefined;
    const where = status ? { status } : {};
    const [coupons, total] = await Promise.all([
      prisma.membershipCoupon.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
        include: { campaign: { select: { name: true } } },
      }),
      prisma.membershipCoupon.count({ where }),
    ]);
    return { coupons, total, page };
  }

  async adminCreate(data: {
    code: string;
    name: string;
    discountPct?: number;
    discountAmount?: number;
    planRestricted?: string[];
    maxRedemptions?: number;
    perUserLimit?: number;
    geography?: string;
    serviceCategory?: string;
    campaignId?: string;
    startsAt?: string;
    expiresAt?: string;
    status?: MembershipCouponStatus;
  }) {
    const coupon = await prisma.membershipCoupon.create({
      data: {
        code: data.code.trim().toUpperCase(),
        name: data.name,
        discountPct: data.discountPct,
        discountAmount: data.discountAmount,
        planRestricted: data.planRestricted ?? [],
        maxRedemptions: data.maxRedemptions,
        perUserLimit: data.perUserLimit ?? 1,
        geography: data.geography,
        serviceCategory: data.serviceCategory,
        campaignId: data.campaignId,
        startsAt: data.startsAt ? new Date(data.startsAt) : undefined,
        expiresAt: data.expiresAt ? new Date(data.expiresAt) : undefined,
        status: data.status ?? MembershipCouponStatus.ACTIVE,
        rule: {
          create: {
            planRestricted: data.planRestricted ?? [],
            usageLimit: data.maxRedemptions,
            userLimit: data.perUserLimit ?? 1,
            geography: data.geography,
            serviceCategory: data.serviceCategory,
            minOrderAmount: undefined,
            expiresAt: data.expiresAt ? new Date(data.expiresAt) : undefined,
          },
        },
      },
    });
    await cacheService.invalidate("membership:coupon:analytics");
    return coupon;
  }

  async adminUpdate(id: string, data: Partial<{ status: MembershipCouponStatus; name: string }>) {
    const coupon = await prisma.membershipCoupon.update({ where: { id }, data });
    await cacheService.invalidate("membership:coupon:analytics");
    return coupon;
  }

  async adminBulkGenerate(
    prefix: string,
    count: number,
    template: Omit<Parameters<MembershipCouponService["adminCreate"]>[0], "code">,
  ) {
    const codes: string[] = [];
    for (let i = 0; i < count; i++) {
      const code = `${prefix}${String(i + 1).padStart(4, "0")}`.toUpperCase();
      await this.adminCreate({ ...template, code, name: `${template.name} ${i + 1}` });
      codes.push(code);
    }
    return codes;
  }

  async analytics() {
    return cacheService.getOrFetch("membership:coupon:analytics", 120, async () => {
      const [issued, redeemed, revenue] = await Promise.all([
        prisma.membershipCoupon.count(),
        prisma.membershipCouponRedemption.count(),
        prisma.membershipCouponRedemption.aggregate({
          _sum: { discountApplied: true, revenueBefore: true, revenueAfter: true },
        }),
      ]);
      const active = await prisma.membershipCoupon.count({
        where: { status: MembershipCouponStatus.ACTIVE },
      });
      const conversionPct =
        issued > 0 ? Math.round((redeemed / issued) * 1000) / 10 : 0;
      return {
        issued,
        active,
        redeemed,
        conversionPct,
        revenueImpact: {
          discountGiven: revenue._sum.discountApplied ?? 0,
          revenueBefore: revenue._sum.revenueBefore ?? 0,
          revenueAfter: revenue._sum.revenueAfter ?? 0,
        },
      };
    });
  }

  async exportCsv(): Promise<string> {
    const coupons = await prisma.membershipCoupon.findMany({
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { redemptions: true } } },
    });
    const header = "code,name,status,redemptions,discount_pct,expires_at";
    const rows = coupons.map(
      (c) =>
        `${c.code},${c.name},${c.status},${c._count.redemptions},${c.discountPct ?? ""},${c.expiresAt?.toISOString() ?? ""}`,
    );
    return [header, ...rows].join("\n");
  }
}

export const membershipCouponService = new MembershipCouponService();
