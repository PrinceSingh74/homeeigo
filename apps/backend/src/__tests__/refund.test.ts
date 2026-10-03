import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { BookingStatus, PaymentStatus } from "@prisma/client";
import { validateAdminRefundAmount } from "../lib/payment-refund-rules";
import { RefundOrchestratorService } from "../services/refund-orchestrator.service";
import { bookingService } from "../services/booking.service";
import { bookingLiveService } from "../services/booking-live.service";
import { recordFinancialMetric, renderFinancialMetrics } from "../lib/financial-metrics";
import {
  cleanupAdversarialFixtures,
  dbReachable,
  prisma,
  seedAdversarialFixtures,
  type AdvCtx,
  payWithRealWallet,
} from "./helpers/adversarial-fixtures";

/**
 * Every case here drives production code. The previous version of this file asserted arithmetic
 * on literals defined three lines above (`expect(kind === kind)`, `expect(true).toBe(true)`) and
 * never imported the refund path at all. Idempotent replay of an admin refund (no second credit)
 * is proven with real rows in admin-partial-refund.integration.test.ts.
 */
const orchestrator = new RefundOrchestratorService();
const RUN = `refund-${Date.now().toString(36)}`;
let ctx: AdvCtx | null = null;

beforeAll(async () => {
  if (!(await dbReachable())) return;
  ctx = await seedAdversarialFixtures(RUN);
}, 60_000);
afterAll(async () => {
  if (ctx) await cleanupAdversarialFixtures(RUN);
}, 60_000);

describe("Refund — single source of truth", () => {
  test("WS cancel delegates to bookingService.cancel with the customer as actor", async () => {
    if (!ctx) return;
    const booking = await prisma.booking.create({
      data: {
        bookingNumber: `RF-${RUN}-c`,
        userId: ctx.customerA.id,
        providerId: null,
        serviceId: ctx.serviceId,
        addressId: ctx.addressAId,
        status: BookingStatus.PENDING,
        scheduledDate: new Date(Date.now() + 3 * 86_400_000),
        baseAmount: 500,
        finalAmount: 500,
        totalAmount: 500,
        paymentStatus: PaymentStatus.PENDING,
      },
    });
    // Paid through the real wallet checkout, not a hand-set "wallet" payment status.
    await payWithRealWallet(booking.id, ctx.customerA.id);
    const cancel = spyOn(bookingService, "cancel").mockResolvedValue({
      booking: { id: booking.id, status: "CANCELLED" },
      refund: { amount: 500, status: "processed" },
    } as never);
    try {
      await bookingLiveService.cancelBooking(booking.id, ctx.customerA.id, "changed plans");
      expect(cancel).toHaveBeenCalledTimes(1);
      expect(cancel.mock.calls[0]?.[0]).toEqual({ userId: ctx.customerA.id });
      expect(cancel.mock.calls[0]?.[1]).toBe(booking.id);
      expect(cancel.mock.calls[0]?.[2]).toBe("changed plans");
    } finally {
      cancel.mockRestore();
    }
  });

  test("admin refund idempotency key is deterministic per (payment, amount, source, actor) and differs otherwise", () => {
    const a = orchestrator.buildIdempotencyKey("pay_1", 500, "admin", "admin_1");
    const b = orchestrator.buildIdempotencyKey("pay_1", 500, "admin", "admin_1");
    expect(a).toBe(b);
    expect(orchestrator.buildIdempotencyKey("pay_1", 250, "admin", "admin_1")).not.toBe(a);
    expect(orchestrator.buildIdempotencyKey("pay_1", 500, "admin", "admin_2")).not.toBe(a);
    expect(orchestrator.buildIdempotencyKey("pay_2", 500, "admin", "admin_1")).not.toBe(a);
  });
});

describe("Admin refund amount validation (server-authoritative)", () => {
  const paid = { amount: 500, amountPaid: 500, refundedAmount: 0, status: PaymentStatus.SUCCESS };
  test("accepts a partial and a full refund of a settled payment", () => {
    expect(validateAdminRefundAmount(200, paid)).toEqual({ ok: true });
    expect(validateAdminRefundAmount(500, paid)).toEqual({ ok: true });
  });
  test("refuses more than what remains after earlier partial refunds", () => {
    const partly = { ...paid, refundedAmount: 450, status: PaymentStatus.PARTIALLY_REFUNDED };
    expect(validateAdminRefundAmount(50, partly)).toEqual({ ok: true });
    expect(validateAdminRefundAmount(51, partly).ok).toBe(false);
  });
  test("refuses zero, negative, NaN and non-refundable states", () => {
    expect(validateAdminRefundAmount(0, paid)).toEqual({ ok: false, reason: "INVALID_AMOUNT" });
    expect(validateAdminRefundAmount(-1, paid)).toEqual({ ok: false, reason: "INVALID_AMOUNT" });
    expect(validateAdminRefundAmount(Number.NaN, paid)).toEqual({ ok: false, reason: "INVALID_AMOUNT" });
    expect(validateAdminRefundAmount(10, { ...paid, status: PaymentStatus.PENDING })).toEqual({ ok: false, reason: "NOT_REFUNDABLE" });
    expect(validateAdminRefundAmount(10, { ...paid, status: PaymentStatus.REFUNDED })).toEqual({ ok: false, reason: "NOT_REFUNDABLE" });
  });
});

describe("Refund metrics reach the /metrics exposition", () => {
  test("refund_success_total and refund_failure_total increment and render", () => {
    const read = (text: string, name: string) =>
      Number(text.match(new RegExp(`^${name}(?:\\{[^}]*\\})? (\\d+(?:\\.\\d+)?)`, "m"))?.[1] ?? 0);
    const before = renderFinancialMetrics();
    const s0 = read(before, "refund_success_total");
    const f0 = read(before, "refund_failure_total");
    recordFinancialMetric("refund_success_total", 1);
    recordFinancialMetric("refund_failure_total", 2);
    const after = renderFinancialMetrics();
    expect(read(after, "refund_success_total")).toBe(s0 + 1);
    expect(read(after, "refund_failure_total")).toBe(f0 + 2);
  });
});
