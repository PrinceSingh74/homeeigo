import prisma from "../lib/prisma";
import { recordFinancialMetric } from "../lib/financial-metrics";

type SettlementWebhookPayload = {
  settlementId?: string;
  amount?: number;
  fee?: number;
  tax?: number;
  status?: string;
  settledAt?: Date;
  gatewayReference?: string;
  raw?: unknown;
};

type GatewayPaymentRef = { id: string; amount: number; fee?: number; tax?: number };

/**
 * Per-payment settlement linking — never bulk-tags all SUCCESS payments.
 */
export class SettlementService {
  async recordFromWebhook(payload: SettlementWebhookPayload) {
    if (!payload.settlementId) return { handled: false, reason: "NO_SETTLEMENT_ID", linked: 0 };

    const netAmount = round2((payload.amount ?? 0) - (payload.fee ?? 0) - (payload.tax ?? 0));
    const settledAt = payload.settledAt ?? new Date();

    const batch = await prisma.settlementBatch.upsert({
      where: { settlementId: payload.settlementId },
      create: {
        settlementId: payload.settlementId,
        amount: payload.amount ?? 0,
        fee: payload.fee ?? 0,
        tax: payload.tax ?? 0,
        netAmount,
        gatewayReference: payload.gatewayReference ?? payload.settlementId,
        status: payload.status ?? "settled",
        settledAt,
        metadata: payload.raw ? JSON.stringify(payload.raw) : undefined,
      },
      update: {
        amount: payload.amount ?? 0,
        fee: payload.fee ?? 0,
        tax: payload.tax ?? 0,
        netAmount,
        gatewayReference: payload.gatewayReference ?? payload.settlementId,
        status: payload.status ?? "settled",
        settledAt,
        metadata: payload.raw ? JSON.stringify(payload.raw) : undefined,
      },
    });

    const linked = await this.linkPaymentsToBatch(batch.id, payload.settlementId, {
      targetAmount: payload.amount ?? batch.amount,
      settledAt,
      gatewayReference: batch.gatewayReference ?? payload.settlementId,
      raw: payload.raw,
    });

    recordFinancialMetric("settlement_total", 1);
    if (settledAt) {
      const delayHours = (Date.now() - settledAt.getTime()) / (1000 * 60 * 60);
      recordFinancialMetric("settlement_delay_hours", Math.max(0, delayHours));
    }

    return { handled: true, reason: "SETTLEMENT_RECORDED", linked, batchId: batch.id };
  }

  async linkPaymentsToBatch(
    batchId: string,
    settlementId: string,
    opts: { targetAmount: number; settledAt: Date; gatewayReference: string; raw?: unknown },
  ): Promise<number> {
    const refs = extractGatewayPaymentRefs(opts.raw);
    let linked = 0;

    if (refs.length > 0) {
      for (const ref of refs) {
        const ok = await this.linkSinglePayment(batchId, settlementId, ref, opts.settledAt, opts.gatewayReference);
        if (ok) linked += 1;
      }
      return linked;
    }

    // FIFO fallback: link unsettled SUCCESS payments up to settlement amount only.
    let remaining = round2(opts.targetAmount);
    const candidates = await prisma.payment.findMany({
      where: { settlementId: null, status: "SUCCESS", razorpayPaymentId: { not: null } },
      orderBy: { completedAt: "asc" },
      take: 200,
    });

    for (const payment of candidates) {
      if (remaining <= 0) break;
      const settledAmount = round2(Math.min(payment.amountPaid, remaining));
      if (settledAmount <= 0) continue;

      const ok = await this.linkSinglePayment(
        batchId,
        settlementId,
        { id: payment.razorpayPaymentId!, amount: settledAmount },
        opts.settledAt,
        opts.gatewayReference,
        payment.id,
      );
      if (ok) {
        linked += 1;
        remaining = round2(remaining - settledAmount);
      }
    }

    return linked;
  }

  private async linkSinglePayment(
    batchId: string,
    settlementId: string,
    ref: GatewayPaymentRef,
    settledAt: Date,
    gatewayReference: string,
    knownPaymentId?: string,
  ): Promise<boolean> {
    const payment =
      knownPaymentId != null
        ? await prisma.payment.findUnique({ where: { id: knownPaymentId } })
        : await prisma.payment.findFirst({ where: { razorpayPaymentId: ref.id } });

    if (!payment || payment.settlementId) return false;

    const settledAmount = round2(ref.amount || payment.amountPaid);
    const fee = round2(ref.fee ?? 0);
    const tax = round2(ref.tax ?? 0);
    const netAmount = round2(settledAmount - fee - tax);

    const existing = await prisma.paymentSettlement.findUnique({
      where: { paymentId_settlementId: { paymentId: payment.id, settlementId } },
    });
    if (existing) return false;

    await prisma.$transaction([
      prisma.payment.update({
        where: { id: payment.id },
        data: { settlementId, settledAt, settledAmount },
      }),
      prisma.paymentSettlement.create({
        data: {
          paymentId: payment.id,
          settlementBatchId: batchId,
          razorpayPaymentId: ref.id,
          settlementId,
          settledAmount,
          settledAt,
          gatewayReference,
        },
      }),
      prisma.settlementLineItem.create({
        data: {
          settlementBatchId: batchId,
          paymentId: payment.id,
          razorpayPaymentId: ref.id,
          amount: settledAmount,
          fee,
          tax,
          netAmount,
        },
      }),
    ]);

    return true;
  }

  async getBatchDetail(batchId: string) {
    return prisma.settlementBatch.findUnique({
      where: { id: batchId },
      include: {
        lineItems: true,
        paymentSettlements: { include: { payment: { select: { id: true, bookingId: true, amountPaid: true } } } },
      },
    });
  }

  async listBatches(limit = 50) {
    return prisma.settlementBatch.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
      include: { _count: { select: { paymentSettlements: true, lineItems: true } } },
    });
  }

  async exportBatchCsv(batchId: string): Promise<string> {
    const batch = await this.getBatchDetail(batchId);
    if (!batch) return "";
    const header = "payment_id,razorpay_payment_id,settled_amount,fee,tax,net_amount,settled_at";
    const rows = batch.lineItems.map(
      (li) =>
        `${li.paymentId ?? ""},${li.razorpayPaymentId ?? ""},${li.amount},${li.fee},${li.tax},${li.netAmount},${batch.settledAt?.toISOString() ?? ""}`,
    );
    return [header, ...rows].join("\n");
  }
}

export const settlementService = new SettlementService();

/** @internal exported for unit tests */
export function extractGatewayPaymentRefs(raw: unknown): GatewayPaymentRef[] {
  if (!raw || typeof raw !== "object") return [];
  const obj = raw as Record<string, unknown>;
  const refs: GatewayPaymentRef[] = [];

  const pushRef = (item: unknown) => {
    if (!item || typeof item !== "object") return;
    const p = item as Record<string, unknown>;
    const id = p.id ?? p.payment_id;
    if (typeof id !== "string") return;
    const amountRaw = typeof p.amount === "number" ? p.amount : typeof p.settled_amount === "number" ? p.settled_amount : 0;
    const amount = amountRaw > 1000 ? amountRaw / 100 : amountRaw;
    refs.push({
      id,
      amount,
      fee: typeof p.fee === "number" ? p.fee / 100 : undefined,
      tax: typeof p.tax === "number" ? p.tax / 100 : undefined,
    });
  };

  if (Array.isArray(obj.payments)) obj.payments.forEach(pushRef);
  if (Array.isArray(obj.entities)) obj.entities.forEach(pushRef);

  const details = obj.settlement_details ?? obj.details;
  if (Array.isArray(details)) details.forEach(pushRef);

  return refs;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
