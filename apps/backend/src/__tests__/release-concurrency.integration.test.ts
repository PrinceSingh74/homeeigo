/**
 * Release certification — race matrix gaps (ISOLATED homigo_test DB, offline dev gateway).
 *   cd apps/backend && bun test D:/homigo/apps/backend/src/__tests__/release-concurrency.integration.test.ts
 *
 * Invariants, each asserted in the database after the race settles:
 *   ONE booking → ONE owner · ONE payment → ONE settlement · ONE refund key → ONE refund
 *   ONE wallet debit → ONE ledger effect · no money created, none lost, no impossible state.
 * (booking‖booking, withdrawal‖withdrawal, refund‖refund and cancel‖cancel are covered by
 *  scheduling-contract, money-matrix CASE 8, split-refund D1 and admin-booking-integrity.)
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { provenanceForNewUser } from "../lib/data-provenance";
import "../load-env";
import prisma from "../lib/prisma";
import { razorpayService } from "../services/razorpay.service";
import { walletService } from "../services/wallet.service";
import { walletCheckoutService } from "../services/wallet-checkout.service";
import { paymentService } from "../services/payment.service";
import { bookingService } from "../services/booking.service";
import { bookingRefundService } from "../services/booking-refund.service";
import { assignmentEngine } from "../services/assignment-engine.service";
import { adminBookingOperationsService } from "../services/admin-booking-operations.service";
import {
  cleanupAdversarialFixtures,
  dbReachable,
  keepPresenceFresh,
  seedAdversarialFixtures,
  type AdvCtx,
} from "./helpers/adversarial-fixtures";
import { refuseIfNotIsolatedTestDb } from "./helpers/isolated-test-db";
import { LIVE_FIXTURE_SERVICE } from "./helpers/live-fixture-service";

const RUN = `rcc-${Date.now().toString(36)}`;
let A: AdvCtx;
let B: AdvCtx;
let dbOk = false;
let seq = 0;

beforeAll(async () => {
  dbOk = await dbReachable();
  if (!dbOk) return;
  const [{ db }] = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
  refuseIfNotIsolatedTestDb(db);
  A = await seedAdversarialFixtures(RUN);
  B = await seedAdversarialFixtures(`${RUN}b`);
}, 120_000);

afterAll(async () => {
  if (!dbOk) return;
  await cleanupAdversarialFixtures(RUN);
  await cleanupAdversarialFixtures(`${RUN}b`);
}, 60_000);

async function customer(walletFunding = 0) {
  seq++;
  const u = await prisma.user.create({
    data: {
      ...provenanceForNewUser(`${RUN}-${seq}@test.test`),
      email: `${RUN}-${seq}@test.test`,
      phoneNumber: `+9176${Math.floor(1e7 + Math.random() * 8.9e7)}`,
      firstName: "Rcc",
      lastName: `T${seq}`,
      password: "x".repeat(20),
      role: "CUSTOMER",
      walletBalance: 0,
    },
  });
  if (walletFunding > 0) {
    const t = await walletService.addMoney(u.id, walletFunding);
    if ("error" in t) throw new Error(t.error);
    await walletService.verifyTopUp(u.id, { razorpayOrderId: t.razorpayOrderId, razorpayPaymentId: `pay_${RUN}_t${seq}`, razorpaySignature: "sig" });
  }
  const s = await prisma.service.create({
    data: { ...LIVE_FIXTURE_SERVICE, name: `${RUN}-${seq}`, slug: `${RUN}-${seq}`, description: "x", category: "cleaning", basePrice: 1000, estimatedDuration: 60 },
  });
  const a = await prisma.address.create({
    data: { userId: u.id, label: "H", addressLine1: "1 St", city: "Mumbai", state: "MH", zipCode: "400001", latitude: 19.076, longitude: 72.8777 },
  });
  const mk = async (hours: number) =>
    (
      await prisma.booking.create({
        data: {
          bookingNumber: `RCC-${RUN}-${seq}-${hours}`,
          userId: u.id,
          serviceId: s.id,
          addressId: a.id,
          status: "PENDING",
          scheduledDate: new Date(Date.now() + hours * 3_600_000),
          baseAmount: 1000,
          finalAmount: 1000,
          totalAmount: 1000,
          paymentStatus: "PENDING",
        },
      })
    ).id;
  return { userId: u.id, bookingId: await mk(72), mk };
}

const pid = (tag: string) => `pay_${RUN}_${seq}_${tag}`;
const captured = (orderId: string, paymentId: string) =>
  paymentService.reconcileFromWebhook({ event: "payment.captured", payload: { payment: { entity: { id: paymentId, order_id: orderId } } } });

async function drainRefund(bookingId: string) {
  for (let i = 0; i < 80; i++) {
    const b = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId }, select: { refundStatus: true } });
    if (b.refundStatus !== "pending") return;
    await new Promise((r) => setTimeout(r, 100));
  }
}

/** Every rupee that left for this booking, and every journal that moved it. */
async function money(bookingId: string) {
  const p = await prisma.payment.findUnique({ where: { bookingId } });
  const gw = p ? await prisma.refundRequest.findMany({ where: { paymentId: p.id, status: "COMPLETED" } }) : [];
  return { payment: p, gatewayRefunded: gw.reduce((s, r) => s + r.amount, 0), gatewayRefunds: gw.length };
}

describe.serial("release race matrix", () => {
  test("admin cancel ‖ payment webhook (×5): always cancelled, paid money returned exactly once", async () => {
    if (!dbOk) return;
    for (let i = 0; i < 5; i++) {
      const c = await customer();
      const o = await paymentService.createOrder(c.userId, c.bookingId);
      if (!o || "error" in o) throw new Error("order");
      const p = pid(`ac${i}`);
      const [cancel] = await Promise.allSettled([
        adminBookingOperationsService.cancelBooking(c.bookingId, A.superAdmin.id, "ops race", undefined, "full"),
        captured(o.razorpayOrderId, p),
      ]);
      expect(cancel.status).toBe("fulfilled");
      await drainRefund(c.bookingId);
      const b = await prisma.booking.findUniqueOrThrow({ where: { id: c.bookingId } });
      const m = await money(c.bookingId);
      expect(b.status).toBe("CANCELLED_BY_USER");
      expect(b.cancelledBy).toBe("admin");
      expect(m.gatewayRefunded).toBe(1000);
      expect(m.gatewayRefunds).toBe(1);
      expect(await prisma.assignmentAttempt.count({ where: { job: { bookingId: c.bookingId }, status: "SENT" } })).toBe(0);
    }
  }, 180_000);

  test("admin partial refund ‖ replayed capture ‖ replayed verify: refund stands, payment never reverts to SUCCESS", async () => {
    if (!dbOk) return;
    const c = await customer();
    const o = await paymentService.createOrder(c.userId, c.bookingId);
    if (!o || "error" in o) throw new Error("order");
    const p = pid("rf");
    await paymentService.verify(c.userId, { razorpayOrderId: o.razorpayOrderId, razorpayPaymentId: p, razorpaySignature: razorpayService.computePaymentSignature(o.razorpayOrderId, p) });

    const results = await Promise.allSettled([
      bookingRefundService.processAdminRefund({ bookingId: c.bookingId, userId: c.userId, adminId: A.superAdmin.id, amount: 300, reason: "goodwill" }),
      captured(o.razorpayOrderId, p),
      paymentService.verify(c.userId, { razorpayOrderId: o.razorpayOrderId, razorpayPaymentId: p, razorpaySignature: razorpayService.computePaymentSignature(o.razorpayOrderId, p) }),
    ]);
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
    // Replays after the refund must also be no-ops.
    expect(await captured(o.razorpayOrderId, p)).toEqual({ handled: true, reason: "ALREADY_RECONCILED" });

    const m = await money(c.bookingId);
    expect(m.gatewayRefunded).toBe(300);
    expect(m.payment!.status).not.toBe("SUCCESS");
    expect(["PARTIALLY_REFUNDED", "REFUNDING"]).toContain(m.payment!.status);
    const journals = await prisma.journalEntry.count({ where: { idempotencyKey: `booking_payment:${m.payment!.id}` } });
    expect(journals).toBe(1);
  }, 120_000);

  test("wallet ‖ wallet: two bookings, balance for one — exactly one debit, balance never negative, ledger agrees", async () => {
    if (!dbOk) return;
    const c = await customer(1000);
    const second = await c.mk(100);
    const r = await Promise.all([
      walletCheckoutService.payBookingFromWallet(c.userId, c.bookingId),
      walletCheckoutService.payBookingFromWallet(c.userId, second),
    ]);
    expect(r.filter((x) => "ok" in x).length).toBe(1);
    expect(r.filter((x) => "error" in x && x.error === "INSUFFICIENT_WALLET_BALANCE").length).toBe(1);
    const u = await prisma.user.findUniqueOrThrow({ where: { id: c.userId } });
    expect(u.walletBalance).toBe(0);
    const debits = await prisma.walletTransaction.findMany({ where: { userId: c.userId, type: "DEBIT", status: "COMPLETED" } });
    expect(debits.length).toBe(1);
    const j = await prisma.journalEntry.count({ where: { idempotencyKey: `wallet_debit:${debits[0]!.id}` } });
    expect(j).toBe(1);
  });

  test("cancel ‖ dispatch (×5): a cancelled booking never keeps an open offer", async () => {
    if (!dbOk) return;
    for (let i = 0; i < 5; i++) {
      const c = await customer(1000);
      await walletCheckoutService.payBookingFromWallet(c.userId, c.bookingId);
      await keepPresenceFresh(A);
      await Promise.allSettled([
        assignmentEngine.dispatchBookingNow(c.bookingId),
        bookingService.cancel({ userId: c.userId }, c.bookingId, "race"),
      ]);
      await new Promise((r) => setTimeout(r, 500)); // the payment-settled background dispatch too
      const b = await prisma.booking.findUniqueOrThrow({ where: { id: c.bookingId } });
      expect(b.status).toBe("CANCELLED_BY_USER");
      expect(await prisma.assignmentAttempt.count({ where: { job: { bookingId: c.bookingId }, status: "SENT" } })).toBe(0);
    }
  }, 180_000);

  test("accept ‖ accept by two partners (×4): exactly one owner, the other ALREADY_CLAIMED, no open offers", async () => {
    if (!dbOk) return;
    for (let i = 0; i < 4; i++) {
      seq++;
      const d = new Date(Date.now() + (300 + seq * 3) * 3_600_000);
      d.setMinutes(0, 0, 0);
      const bk = await prisma.booking.create({
        data: {
          bookingNumber: `RCC-${RUN}-acc-${seq}`,
          userId: A.customerA.id,
          serviceId: A.serviceId,
          addressId: A.addressAId,
          status: "PENDING",
          scheduledDate: d,
          baseAmount: 1000,
          finalAmount: 1000,
          totalAmount: 1000,
          paymentStatus: "SUCCESS",
        },
      });
      const job = await prisma.assignmentJob.create({ data: { bookingId: bk.id, status: "DISPATCHED", dispatchAttempts: 1, timeoutAt: new Date(Date.now() + 300_000) } });
      for (const p of [A.providerId, B.providerId]) {
        await prisma.assignmentAttempt.create({ data: { jobId: job.id, providerId: p, status: "SENT", dispatchedAt: new Date() } });
      }
      await keepPresenceFresh(A);
      await keepPresenceFresh(B);
      const [ra, rb] = await Promise.all([bookingService.accept(A.providerId, bk.id), bookingService.accept(B.providerId, bk.id)]);
      const wins = [ra, rb].filter((r) => r.ok);
      expect(wins.length).toBe(1);
      const loser = [ra, rb].find((r) => !r.ok) as { ok: false; error: string };
      expect(["ALREADY_CLAIMED", "INVALID_STATUS"]).toContain(loser.error);
      const after = await prisma.booking.findUniqueOrThrow({ where: { id: bk.id } });
      const j = await prisma.assignmentJob.findUniqueOrThrow({ where: { id: job.id } });
      expect(after.status).toBe("ACCEPTED");
      expect(j.currentProviderId).toBe(after.providerId);
      expect(await prisma.assignmentAttempt.count({ where: { jobId: job.id, status: "SENT" } })).toBe(0);
    }
  }, 180_000);
});
