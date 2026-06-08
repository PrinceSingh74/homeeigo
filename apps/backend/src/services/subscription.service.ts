import { prisma } from "../lib/prisma";
import { razorpayService } from "./razorpay.service";
import { SubscriptionStatus, type SubscriptionInterval } from "@prisma/client";
import { financialLedgerService } from "./financial-ledger.service";

const MONTHS: Record<SubscriptionInterval, number> = {
  MONTHLY: 1,
  QUARTERLY: 3,
  YEARLY: 12,
};

function addMonths(from: Date, months: number): Date {
  const d = new Date(from);
  d.setMonth(d.getMonth() + months);
  return d;
}

function subInvoiceNumber(): string {
  return `SUB-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

/** A plan benefit as admin sends it: a plain display label, or a structured
 *  entitlement (type + value [+ quota]). Both forms are accepted. */
export type BenefitInput =
  | string
  | { label: string; type?: string | null; value?: number | null; quotaLimit?: number | null; quotaPeriod?: string | null };

function normalizeBenefits(benefits: BenefitInput[] | undefined): {
  label: string;
  type: string | null;
  value: number | null;
  quotaLimit: number | null;
  quotaPeriod: string | null;
  sortOrder: number;
}[] {
  return (benefits ?? []).map((b, i) =>
    typeof b === "string"
      ? { label: b, type: null, value: null, quotaLimit: null, quotaPeriod: null, sortOrder: i }
      : {
          label: b.label,
          type: b.type ?? null,
          value: b.value ?? null,
          quotaLimit: b.quotaLimit ?? null,
          quotaPeriod: b.quotaPeriod ?? null,
          sortOrder: i,
        },
  );
}

export class SubscriptionService {
  /** Active plans with benefits, cheapest-interval first. */
  async plans() {
    return prisma.membershipPlan.findMany({
      where: { isActive: true },
      include: { benefits: { orderBy: { sortOrder: "asc" } } },
      orderBy: { sortOrder: "asc" },
    });
  }

  /** Flip any of this user's ACTIVE subscriptions whose term has passed → EXPIRED. */
  private async expireStale(userId: string) {
    await prisma.userSubscription.updateMany({
      where: { userId, status: SubscriptionStatus.ACTIVE, expiresAt: { lt: new Date() } },
      data: { status: SubscriptionStatus.EXPIRED },
    });
  }

  /** The user's current active subscription (if any) + full history. */
  async mine(userId: string) {
    await this.expireStale(userId);
    const subs = await prisma.userSubscription.findMany({
      where: { userId },
      include: { plan: { include: { benefits: { orderBy: { sortOrder: "asc" } } } } },
      orderBy: { createdAt: "desc" },
    });
    const active = subs.find(
      (s) => s.status === SubscriptionStatus.ACTIVE && s.expiresAt && s.expiresAt > new Date(),
    );
    return { active: active ?? null, history: subs };
  }

  async hasActiveMembership(userId: string): Promise<boolean> {
    const { active } = await this.mine(userId);
    return active !== null;
  }

  /**
   * Create a Razorpay order for buying/renewing a plan and a PENDING subscription
   * row. The price is taken from the DB plan (never the client) — tamper-proof.
   */
  async createOrder(userId: string, planId: string) {
    const plan = await prisma.membershipPlan.findFirst({ where: { id: planId, isActive: true } });
    if (!plan) return null;
    const order = await razorpayService.createOrder(plan.price, `sub_${userId}`, { userId, planId });
    await prisma.userSubscription.create({
      data: {
        userId,
        planId: plan.id,
        status: SubscriptionStatus.PENDING,
        razorpayOrderId: order.orderId,
      },
    });
    return {
      razorpayOrderId: order.orderId,
      amount: order.amount,
      currency: order.currency,
      key: razorpayService.keyId,
      planName: plan.name,
    };
  }

  /**
   * Verify the payment signature and activate the subscription. Extends from the
   * user's current expiry if they still have an active plan (true renewal).
   */
  async verify(
    userId: string,
    body: { razorpayOrderId: string; razorpayPaymentId: string; razorpaySignature: string },
  ): Promise<{ ok: true; subscriptionId: string; expiresAt: Date } | { error: string }> {
    const pending = await prisma.userSubscription.findFirst({
      where: { userId, razorpayOrderId: body.razorpayOrderId },
      include: { plan: true },
    });
    if (!pending || !pending.plan) return { error: "NOT_FOUND" };
    if (pending.status === SubscriptionStatus.ACTIVE) {
      return { ok: true, subscriptionId: pending.id, expiresAt: pending.expiresAt ?? new Date() };
    }
    const valid = razorpayService.verifyPaymentSignature(
      body.razorpayOrderId,
      body.razorpayPaymentId,
      body.razorpaySignature,
    );
    if (!valid) return { error: "INVALID_SIGNATURE" };

    const result = await this.activatePaidSubscription(
      pending.id,
      userId,
      body.razorpayOrderId,
      body.razorpayPaymentId,
    );
    return { ok: true, subscriptionId: result.id, expiresAt: result.expiresAt };
  }

  async reconcileFromWebhook(
    razorpayOrderId: string,
    razorpayPaymentId: string,
  ): Promise<{ handled: boolean; reason: string }> {
    const pending = await prisma.userSubscription.findFirst({
      where: { razorpayOrderId },
      include: { plan: true },
    });
    if (!pending || !pending.plan) return { handled: false, reason: "SUBSCRIPTION_NOT_FOUND" };
    if (pending.status === SubscriptionStatus.ACTIVE) {
      return { handled: true, reason: "SUBSCRIPTION_ALREADY_ACTIVE" };
    }
    await this.activatePaidSubscription(pending.id, pending.userId, razorpayOrderId, razorpayPaymentId);
    const invoice = await prisma.subscriptionInvoice.findFirst({
      where: { razorpayOrderId },
      orderBy: { createdAt: "desc" },
    });
    if (invoice) {
      void financialLedgerService.recordSubscription(invoice.id, invoice.amount).catch(() => undefined);
    }
    return { handled: true, reason: "SUBSCRIPTION_ACTIVATED" };
  }

  async reconcilePendingFromOrders(): Promise<number> {
    const pending = await prisma.userSubscription.findMany({
      where: { status: SubscriptionStatus.PENDING, razorpayOrderId: { not: null } },
      take: 50,
    });
    let activated = 0;
    for (const sub of pending) {
      if (!sub.razorpayOrderId) continue;
      const payments = await razorpayService.fetchOrderPayments(sub.razorpayOrderId);
      const captured = payments.find((p) => p.status === "captured");
      if (!captured) continue;
      const result = await this.reconcileFromWebhook(sub.razorpayOrderId, captured.id);
      if (result.handled) activated++;
    }
    return activated;
  }

  private async activatePaidSubscription(
    subscriptionId: string,
    userId: string,
    razorpayOrderId: string,
    razorpayPaymentId: string,
  ) {
    const pending = await prisma.userSubscription.findFirst({
      where: { id: subscriptionId, userId },
      include: { plan: true },
    });
    if (!pending?.plan) throw new Error("SUBSCRIPTION_NOT_FOUND");
    if (pending.status === SubscriptionStatus.ACTIVE) {
      return { id: pending.id, expiresAt: pending.expiresAt ?? new Date() };
    }

    const { active } = await this.mine(userId);
    const base = active?.expiresAt && active.expiresAt > new Date() ? active.expiresAt : new Date();
    const startsAt = new Date();
    const expiresAt = addMonths(base, MONTHS[pending.plan.interval]);

    const result = await prisma.$transaction(async (tx) => {
      const sub = await tx.userSubscription.update({
        where: { id: pending.id },
        data: { status: SubscriptionStatus.ACTIVE, startsAt, expiresAt },
      });
      await tx.subscriptionInvoice.create({
        data: {
          subscriptionId: sub.id,
          userId,
          amount: pending.plan!.price,
          status: "paid",
          invoiceNumber: subInvoiceNumber(),
          razorpayOrderId,
          razorpayPaymentId,
          periodStart: startsAt,
          periodEnd: expiresAt,
        },
      });
      await tx.userSubscription.updateMany({
        where: { userId, status: SubscriptionStatus.ACTIVE, id: { not: sub.id } },
        data: { status: SubscriptionStatus.EXPIRED },
      });
      return sub;
    });
    return { id: result.id, expiresAt };
  }

  /** Cancel auto-renew. Access is retained until the paid term ends. */
  async cancel(userId: string): Promise<boolean> {
    const { active } = await this.mine(userId);
    if (!active) return false;
    await prisma.userSubscription.update({
      where: { id: active.id },
      data: { autoRenew: false, cancelledAt: new Date() },
    });
    return true;
  }

  async invoices(userId: string) {
    return prisma.subscriptionInvoice.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });
  }

  // ===== Admin =====
  async adminListPlans() {
    return prisma.membershipPlan.findMany({
      include: { benefits: { orderBy: { sortOrder: "asc" } }, _count: { select: { subscriptions: true } } },
      orderBy: { sortOrder: "asc" },
    });
  }

  async adminCreatePlan(data: {
    name: string;
    interval: SubscriptionInterval;
    price: number;
    tier?: string;
    description?: string;
    benefits?: BenefitInput[];
    sortOrder?: number;
  }) {
    return prisma.membershipPlan.create({
      data: {
        name: data.name,
        interval: data.interval,
        price: data.price,
        tier: data.tier ?? "premium",
        description: data.description,
        sortOrder: data.sortOrder ?? 0,
        benefits: { create: normalizeBenefits(data.benefits) },
      },
      include: { benefits: true },
    });
  }

  async adminUpdatePlan(
    id: string,
    data: { name?: string; price?: number; tier?: string; description?: string; isActive?: boolean; benefits?: BenefitInput[] },
  ) {
    const plan = await prisma.membershipPlan.findUnique({ where: { id } });
    if (!plan) return null;
    return prisma.$transaction(async (tx) => {
      if (data.benefits) {
        await tx.subscriptionBenefit.deleteMany({ where: { planId: id } });
        await tx.subscriptionBenefit.createMany({
          data: normalizeBenefits(data.benefits).map((b) => ({ ...b, planId: id })),
        });
      }
      return tx.membershipPlan.update({
        where: { id },
        data: {
          name: data.name,
          price: data.price,
          tier: data.tier,
          description: data.description,
          isActive: data.isActive,
        },
        include: { benefits: { orderBy: { sortOrder: "asc" } } },
      });
    });
  }

  async adminSubscribers(query: { page?: string; limit?: string }) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const [rows, total] = await Promise.all([
      prisma.userSubscription.findMany({
        where: { status: { in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.CANCELLED] } },
        include: {
          plan: { select: { name: true, interval: true, price: true } },
          user: { select: { firstName: true, lastName: true, email: true } },
        },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.userSubscription.count({
        where: { status: { in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.CANCELLED] } },
      }),
    ]);
    return { subscribers: rows, pagination: { page, limit, total, hasMore: page * limit < total } };
  }

  async adminRevenue() {
    const invoices = await prisma.subscriptionInvoice.findMany({
      where: { status: "paid" },
      select: { amount: true, createdAt: true },
    });
    const total = invoices.reduce((s, i) => s + i.amount, 0);
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const thisMonth = invoices
      .filter((i) => i.createdAt >= monthStart)
      .reduce((s, i) => s + i.amount, 0);
    const activeCount = await prisma.userSubscription.count({
      where: { status: SubscriptionStatus.ACTIVE, expiresAt: { gt: now } },
    });
    return { totalRevenue: total, monthRevenue: thisMonth, activeSubscribers: activeCount, invoiceCount: invoices.length };
  }
}

export const subscriptionService = new SubscriptionService();
