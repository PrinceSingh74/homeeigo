/**
 * When Razorpay says a refund is PROCESSED, the booking and the payment say so too.
 *
 * Found by the coding-phase operational certification (2026-09-27), through the real customer web
 * build and the real Razorpay TEST API: a gateway refund is accepted with status `pending`, which
 * sets `bookings.refund_status = processing` and `payments.refund_status = pending`. The
 * `refund.processed` webhook then answered ALREADY_SYNCED — the journal already existed — and changed
 * nothing else. Only the stale-refund recovery sweep ever moved a booking to `processed`, and it looks
 * at REFUNDING / INDETERMINATE requests, never COMPLETED ones. So every such customer saw "refund in
 * progress" for a refund the gateway had finished. The test database held 1,124 bookings in that state.
 *
 * The convergence is status-only: no journal, no amount, no wallet. It must be idempotent and must
 * touch only the booking whose cancellation refund this is.
 *
 *   cd apps/backend
 *   bun test "D:/homigo/apps/backend/src/__tests__/refund-processed-convergence.integration.test.ts" --timeout 120000
 */
import "../load-env";
import { describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import prisma from "../lib/prisma";
import app from "../index";
import { provenanceForNewUser } from "../lib/data-provenance";
import { bookingService } from "../services/booking.service";
import { bookingRefundService } from "../services/booking-refund.service";
import { paymentService } from "../services/payment.service";
import { razorpayService } from "../services/razorpay.service";
import { LIVE_FIXTURE_SERVICE } from "./helpers/live-fixture-service";

const rnd = () => Math.random().toString(36).slice(2, 8);

async function user(tag: string, role: "CUSTOMER" | "ADMIN" = "CUSTOMER") {
  const email = `rpc-${tag}-${Date.now()}-${rnd()}@test.test`;
  return prisma.user.create({
    data: {
      ...provenanceForNewUser(email),
      email,
      phoneNumber: `+9173${Math.floor(1e7 + Math.random() * 8e7)}`,
      firstName: "Rpc",
      lastName: tag,
      password: "x".repeat(20),
      role,
      walletBalance: 0,
    } as never,
  });
}

/** A booking paid through the gateway by the application's own createOrder + verify. */
async function gatewayPaid() {
  const u = await user("gw");
  const s = await prisma.service.create({
    data: { ...LIVE_FIXTURE_SERVICE, name: `rpc-${rnd()}-${Date.now()}`, slug: `rpc-${rnd()}-${Date.now()}`, description: "x", category: "cleaning", basePrice: 500, estimatedDuration: 60 },
  });
  const a = await prisma.address.create({
    data: { userId: u.id, label: "H", addressLine1: "1 St", city: "Mumbai", state: "MH", zipCode: "400001", latitude: 19.076, longitude: 72.8777 },
  });
  const b = await prisma.booking.create({
    data: {
      bookingNumber: `RPC-${Date.now()}-${rnd()}`,
      userId: u.id, serviceId: s.id, addressId: a.id,
      scheduledDate: new Date(Date.now() + 72 * 3_600_000),
      baseAmount: 500, finalAmount: 500, totalAmount: 500,
      status: "PENDING", paymentStatus: "PENDING", paymentMethod: "razorpay",
    } as never,
  });
  const order = await paymentService.createOrder(u.id, b.id);
  if (!order || "error" in order) throw new Error(`createOrder: ${JSON.stringify(order)}`);
  const payId = `pay_Trpc${rnd()}${rnd()}`;
  const v = await paymentService.verify(u.id, {
    razorpayOrderId: order.razorpayOrderId,
    razorpayPaymentId: payId,
    razorpaySignature: razorpayService.computePaymentSignature(order.razorpayOrderId, payId),
  });
  if (!v || "error" in v) throw new Error(`verify: ${JSON.stringify(v)}`);
  return { userId: u.id, bookingId: b.id, payId };
}

async function settle(bookingId: string) {
  for (let i = 0; i < 100; i++) {
    const b = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId }, select: { refundStatus: true } });
    if (b.refundStatus !== "pending") return b.refundStatus;
    await new Promise((r) => setTimeout(r, 100));
  }
  return "pending";
}

/** Exactly what Razorpay sends, signed with the configured webhook secret, through the real route. */
async function refundWebhook(event: "refund.processed" | "refund.failed", r: { id: string; payId: string; paise: number; op?: string }, eventId: string) {
  const body = JSON.stringify({
    entity: "event",
    event,
    contains: ["refund"],
    payload: { refund: { entity: { id: r.id, entity: "refund", amount: r.paise, currency: "INR", payment_id: r.payId, notes: r.op ? { homigo_operation: r.op } : {}, status: event === "refund.processed" ? "processed" : "failed" } } },
    created_at: Math.floor(Date.now() / 1000),
  });
  const sig = createHmac("sha256", process.env.RAZORPAY_WEBHOOK_SECRET ?? "").update(body).digest("hex");
  const res = await app.handle(
    new Request("http://localhost/api/payments/webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Razorpay-Signature": sig, "X-Razorpay-Event-Id": eventId },
      body,
    }),
  );
  return { status: res.status, json: (await res.json()) as { success?: boolean; reason?: string } };
}

const state = async (bookingId: string) => {
  const b = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId }, select: { refundStatus: true } });
  const p = await prisma.payment.findUniqueOrThrow({ where: { bookingId }, select: { id: true, refundStatus: true, refundedAmountPaise: true, status: true } });
  const rr = await prisma.refundRequest.findMany({ where: { paymentId: p.id }, orderBy: { createdAt: "asc" } });
  return { booking: b.refundStatus, payment: p, rr };
};

describe("a processed gateway refund converges on the booking and the payment", () => {
  test("premise: webhooks are configured in this runtime", () => {
    expect(razorpayService.isWebhookConfigured).toBe(true);
  });

  test("cancellation refund: refund.processed moves the booking and payment to processed — once, with no money effect", async () => {
    const f = await gatewayPaid();
    await bookingService.cancel({ userId: f.userId }, f.bookingId, "rpc cancel");
    await settle(f.bookingId);
    const before = await state(f.bookingId);
    expect(before.rr.length).toBe(1);
    const rr = before.rr[0];
    expect(rr.status).toBe("COMPLETED");
    // The gateway accepted the refund but has not finished it: the customer-visible state is "processing".
    expect(before.booking).toBe("processing");
    const journalsBefore = await prisma.journalEntry.count({ where: { idempotencyKey: `refund:${rr.gatewayRefundId}` } });
    expect(journalsBefore).toBe(1);

    const w1 = await refundWebhook("refund.processed", { id: rr.gatewayRefundId!, payId: f.payId, paise: Math.round(rr.amount * 100), op: rr.idempotencyKey }, `evt_rpc_${rnd()}`);
    expect(w1.status).toBe(200);
    const after = await state(f.bookingId);
    expect(after.booking).toBe("processed");
    expect(after.payment.refundStatus).toBe("processed");
    // Status only: the refunded amount and the ledger are exactly as they were.
    expect(after.payment.refundedAmountPaise).toBe(before.payment.refundedAmountPaise);
    expect(await prisma.journalEntry.count({ where: { idempotencyKey: `refund:${rr.gatewayRefundId}` } })).toBe(1);

    // A second delivery (Razorpay retries with a new event id) changes nothing.
    const w2 = await refundWebhook("refund.processed", { id: rr.gatewayRefundId!, payId: f.payId, paise: Math.round(rr.amount * 100), op: rr.idempotencyKey }, `evt_rpc_${rnd()}`);
    expect(w2.status).toBe(200);
    const again = await state(f.bookingId);
    expect(again.booking).toBe("processed");
    expect(again.payment.refundedAmountPaise).toBe(before.payment.refundedAmountPaise);
    expect(await prisma.journalEntry.count({ where: { idempotencyKey: `refund:${rr.gatewayRefundId}` } })).toBe(1);
  }, 60_000);

  test("control: a processed ADMIN partial refund does not claim the booking was refunded", async () => {
    const f = await gatewayPaid();
    const admin = await user("adm", "ADMIN");
    const res = await bookingRefundService.processAdminRefund({ bookingId: f.bookingId, userId: f.userId, adminId: admin.id, amount: 100, reason: "rpc partial" });
    expect("error" in res).toBe(false);
    const before = await state(f.bookingId);
    const partial = before.rr.find((r) => !r.idempotencyKey.startsWith("cancel-refund:"))!;
    expect(partial).toBeDefined();
    const w = await refundWebhook("refund.processed", { id: partial.gatewayRefundId!, payId: f.payId, paise: 10_000, op: partial.idempotencyKey }, `evt_rpc_${rnd()}`);
    expect(w.status).toBe(200);
    const after = await state(f.bookingId);
    // The booking was not cancelled and owes no cancellation refund: its refund status is untouched.
    expect(after.booking).toBe(before.booking);
    expect(after.payment.refundedAmountPaise).toBe(before.payment.refundedAmountPaise);
  }, 60_000);
});
