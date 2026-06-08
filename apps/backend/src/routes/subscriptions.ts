import { Elysia, t } from "elysia";
import { authPlugin } from "../plugins/auth.plugin";
import { subscriptionService } from "../services/subscription.service";
import { entitlementService } from "../services/entitlement.service";
import { cashbackService } from "../services/cashback.service";
import prisma from "../lib/prisma";
import { membershipCouponService } from "../services/membership-coupon.service";

export const subscriptionsRoutes = new Elysia({ prefix: "/api/subscriptions" })
  // Public: anyone can view the available plans.
  .get("/plans", async () => {
    const plans = await subscriptionService.plans();
    return { success: true, data: { plans } };
  })
  .use(authPlugin)
  .get("/me", async ({ requireAuth }) => {
    const { userId } = requireAuth();
    const data = await subscriptionService.mine(userId);
    return { success: true, data };
  })
  .get("/invoices", async ({ requireAuth }) => {
    const { userId } = requireAuth();
    const invoices = await subscriptionService.invoices(userId);
    return { success: true, data: { invoices } };
  })
  // Effective entitlements — the server-side source of truth the UI uses to show
  // discounts, unlock premium-only services, and render upgrade CTAs.
  .get("/entitlements", async ({ requireAuth }) => {
    const { userId } = requireAuth();
    const entitlements = await entitlementService.resolve(userId);
    return { success: true, data: entitlements };
  })
  .get("/benefit-usage", async ({ requireAuth }) => {
    const { userId } = requireAuth();
    const rows = await prisma.membershipBenefitUsage.findMany({
      where: { userId },
      orderBy: { lastUsedAt: "desc" },
    });
    const entitlements = await entitlementService.resolve(userId);
    return {
      success: true,
      data: {
        usage: rows.map((r) => ({
          benefitType: r.benefitType,
          period: r.period,
          count: r.count,
          amount: r.amount,
          lastUsedAt: r.lastUsedAt,
        })),
        entitlements,
      },
    };
  })
  .get("/cashback/history", async ({ requireAuth, query }) => {
    const { userId } = requireAuth();
    const data = await cashbackService.history(userId, query as Record<string, string>);
    return { success: true, data };
  })
  .get("/insights", async ({ requireAuth }) => {
    const { userId } = requireAuth();
    const [entitlements, usage, cashback] = await Promise.all([
      entitlementService.resolve(userId),
      prisma.membershipBenefitUsage.findMany({ where: { userId }, orderBy: { lastUsedAt: "desc" }, take: 20 }),
      cashbackService.history(userId, { limit: "5" }),
    ]);
    return {
      success: true,
      data: {
        entitlements,
        recentBenefitUsage: usage,
        recentCashback: cashback.cashbacks,
        cashbackSummary: cashback.summary,
      },
    };
  })
  .post(
    "/order",
    async ({ requireAuth, body, set }) => {
      const { userId } = requireAuth();
      const data = await subscriptionService.createOrder(userId, body.planId);
      if (!data) {
        set.status = 404;
        return { success: false, error: "Plan not found", code: "NOT_FOUND" };
      }
      return { success: true, data };
    },
    { body: t.Object({ planId: t.String() }) },
  )
  .post(
    "/verify",
    async ({ requireAuth, body, set }) => {
      const { userId } = requireAuth();
      const result = await subscriptionService.verify(userId, body);
      if ("error" in result) {
        set.status = result.error === "INVALID_SIGNATURE" ? 400 : 404;
        return { success: false, error: result.error, code: result.error };
      }
      return { success: true, message: "Membership activated", data: result };
    },
    {
      body: t.Object({
        razorpayOrderId: t.String(),
        razorpayPaymentId: t.String(),
        razorpaySignature: t.String(),
      }),
    },
  )
  .get("/coupons", async ({ requireAuth }) => {
    const { userId } = requireAuth();
    const coupons = await membershipCouponService.myCoupons(userId);
    return { success: true, data: { coupons } };
  })
  .post("/cancel", async ({ requireAuth, set }) => {
    const { userId } = requireAuth();
    const ok = await subscriptionService.cancel(userId);
    if (!ok) {
      set.status = 400;
      return { success: false, error: "No active membership to cancel", code: "NO_ACTIVE" };
    }
    return { success: true, message: "Auto-renew cancelled. Access continues until expiry." };
  });
