/**
 * Money-path integrity fixes (Commercial Core Wave 1) on the ISOLATED test DB, offline dev gateway:
 *   D2 — a failed split payment retried keeps the split: the gateway is charged only the remainder;
 *   D3 — a capture on an order a retry replaced is settled (never dropped), or alerted if it is a
 *        second payment / wrong amount (never settled twice);
 *   D4 — refund webhooks count each gateway refund exactly once (replays, out-of-order, concurrent);
 *   dedup — concurrent webhook deliveries: one processor per event, no 500.
 * Every payment goes through the real checkouts; nothing is written into `payments` by hand.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import "../load-env";
import prisma from "../lib/prisma";
import { walletService } from "../services/wallet.service";
import { walletCheckoutService } from "../services/wallet-checkout.service";
import { paymentService } from "../services/payment.service";
import { refundLedgerSyncService } from "../services/refund-ledger-sync.service";
import { webhookDedupService } from "../services/webhook-dedup.service";
import { cleanupAdversarialFixtures, dbReachable, seedAdversarialFixtures } from "./helpers/adversarial-fixtures";
import { refuseIfNotIsolatedTestDb } from "./helpers/isolated-test-db";

const RUN = `prw-${Date.now().toString(36)}`;
let seq = 0;
let dbOk = false;
const made = { users: [] as string[], services: [] as string[], events: [] as string[] };

beforeAll(async () => {
  dbOk = await dbReachable();
  if (!dbOk) return;
  const [{ db }] = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
  refuseIfNotIsolatedTestDb(db);
  await seedAdversarialFixtures(RUN);
}, 90_000);
afterAll(async () => {
  if (!dbOk) return;
  await prisma.webhookEventDedup.deleteMany({ where: { eventId: { in: made.events } } }).catch(() => {});
  await prisma.opsAlert.deleteMany({ where: { alertType: "payment_orphan_capture", message: { contains: RUN } } }).catch(() => {});
  await cleanupAdversarialFixtures(RUN);
}, 60_000);

async function customer(walletFunding = 0) {
  seq++;
  const u = await prisma.user.create({
    data: { email: `${RUN}-${seq}@test.test`, phoneNumber: `+9178${Math.floor(1e7 + Math.random() * 8.9e7)}`, firstName: "Prw", lastName: `T${seq}`, password: "x".repeat(20), role: "CUSTOMER", walletBalance: 0 },
  });
  made.users.push(u.id);
  if (walletFunding > 0) {
    const t = await walletService.addMoney(u.id, walletFunding);
    if ("error" in t) throw new Error(t.error);
    await walletService.verifyTopUp(u.id, { razorpayOrderId: t.razorpayOrderId, razorpayPaymentId: `pay_${RUN}_topup_${seq}`, razorpaySignature: "sig" });
  }
  const s = await prisma.service.create({ data: { name: `${RUN}-${seq}`, slug: `${RUN}-${seq}`, description: "x", category: "cleaning", basePrice: 1000, estimatedDuration: 60 } });
  made.services.push(s.id);
  const a = await prisma.address.create({ data: { userId: u.id, label: "H", addressLine1: "1 St", city: "Mumbai", state: "MH", zipCode: "400001", latitude: 19.076, longitude: 72.8777 } });
  const b = await prisma.booking.create({
    data: { bookingNumber: `PRW-${RUN}-${seq}`, userId: u.id, serviceId: s.id, addressId: a.id, status: "PENDING", scheduledDate: new Date(Date.now() + 72 * 3_600_000), baseAmount: 1000, finalAmount: 1000, totalAmount: 1000, paymentStatus: "PENDING" },
  });
  return { userId: u.id, bookingId: b.id };
}
const pid = (tag: string) => `pay_${RUN}_${seq}_${tag}`;
const capture = (orderId: string, paymentId: string, amountPaise?: number) =>
  paymentService.reconcileFromWebhook({ event: "payment.captured", payload: { payment: { entity: { id: paymentId, order_id: orderId, ...(amountPaise != null ? { amount: amountPaise } : {}) } } } });
const fail = (orderId: string, paymentId: string) => paymentService.reconcileFromWebhook({ event: "payment.failed", payload: { payment: { entity: { id: paymentId, order_id: orderId } } } });
const walletOf = async (userId: string) => (await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { walletBalance: true } })).walletBalance;
const walletDebits = (userId: string, bookingId: string) => prisma.walletTransaction.findMany({ where: { userId, referenceId: bookingId, referenceType: "booking_wallet_payment", status: "COMPLETED" } });

describe.serial("D2 — a failed split retried stays a split", () => {
  test("split → gateway leg fails → initiateSplit again → NEW order for the remainder only; capture debits the wallet share once", async () => {
    if (!dbOk) return;
    const c = await customer(400);
    const first = await walletCheckoutService.initiateSplit(c.userId, c.bookingId, 400);
    if ("error" in first || first.mode !== "split") throw new Error(JSON.stringify(first));
    expect(first.razorpayAmount).toBe(600);
    expect((await fail(first.razorpayOrderId, pid("f1"))).handled).toBe(true);

    const retried = await walletCheckoutService.initiateSplit(c.userId, c.bookingId, 400);
    if ("error" in retried || retried.mode !== "split") throw new Error(JSON.stringify(retried));
    expect(retried.razorpayOrderId).not.toBe(first.razorpayOrderId);
    expect([retried.razorpayAmount, retried.walletAmount]).toEqual([600, 400]);
    const row = await prisma.payment.findUniqueOrThrow({ where: { bookingId: c.bookingId } });
    expect([row.amount, Number(row.amountPaise), row.status]).toEqual([600, 60000, "INITIATED"]);

    expect((await capture(retried.razorpayOrderId, pid("ok"))).handled).toBe(true);
    const paid = await prisma.payment.findUniqueOrThrow({ where: { bookingId: c.bookingId } });
    const debits = await walletDebits(c.userId, c.bookingId);
    expect(debits.map((d) => d.amount)).toEqual([400]);
    expect(paid.amountPaid).toBe(600);
    expect(paid.amountPaid + debits[0]!.amount).toBe(1000); // never total + wallet share
    expect(await walletOf(c.userId)).toBe(0);
  });

  test("the generic create-order retry of a failed split also charges only the remainder", async () => {
    if (!dbOk) return;
    const c = await customer(250);
    const first = await walletCheckoutService.initiateSplit(c.userId, c.bookingId, 250);
    if ("error" in first || first.mode !== "split") throw new Error(JSON.stringify(first));
    await fail(first.razorpayOrderId, pid("f1"));
    const o = await paymentService.createOrder(c.userId, c.bookingId);
    if (!o || "error" in o) throw new Error(JSON.stringify(o));
    const row = await prisma.payment.findUniqueOrThrow({ where: { bookingId: c.bookingId } });
    expect([row.amount, row.paymentMethod]).toEqual([750, "wallet_razorpay_split"]);
  });
});

describe.serial("D3 — capture on a replaced order", () => {
  test("late capture on the OLD order of an unsettled payment is settled (rebound to the order actually paid)", async () => {
    if (!dbOk) return;
    const c = await customer();
    const o1 = await paymentService.createOrder(c.userId, c.bookingId);
    if (!o1 || "error" in o1) throw new Error(JSON.stringify(o1));
    await fail(o1.razorpayOrderId, pid("f1"));
    const o2 = await paymentService.createOrder(c.userId, c.bookingId);
    if (!o2 || "error" in o2) throw new Error(JSON.stringify(o2));
    expect(o2.razorpayOrderId).not.toBe(o1.razorpayOrderId);

    const r = await capture(o1.razorpayOrderId, pid("late"), 100000);
    expect(r).toEqual({ handled: true, reason: "RECONCILED" });
    const row = await prisma.payment.findUniqueOrThrow({ where: { bookingId: c.bookingId } });
    expect([row.status, row.razorpayOrderId, row.razorpayPaymentId]).toEqual(["SUCCESS", o1.razorpayOrderId, pid("late")]);
    expect(JSON.parse(row.metadata ?? "{}").previousRazorpayOrderIds).toContain(o2.razorpayOrderId);
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: c.bookingId } })).paymentStatus).toBe("SUCCESS");
  });

  test("a SECOND capture (customer paid both orders) is never settled — it raises a CRITICAL orphan alert", async () => {
    if (!dbOk) return;
    const c = await customer();
    const o1 = await paymentService.createOrder(c.userId, c.bookingId);
    if (!o1 || "error" in o1) throw new Error(JSON.stringify(o1));
    await fail(o1.razorpayOrderId, pid("f1"));
    const o2 = await paymentService.createOrder(c.userId, c.bookingId);
    if (!o2 || "error" in o2) throw new Error(JSON.stringify(o2));
    expect((await capture(o2.razorpayOrderId, pid("new"), 100000)).handled).toBe(true);
    const settled = await prisma.payment.findUniqueOrThrow({ where: { bookingId: c.bookingId } });

    const r = await capture(o1.razorpayOrderId, pid("dup"), 100000);
    expect(r).toEqual({ handled: true, reason: "ORPHAN_CAPTURE_ALERTED:ALREADY_SETTLED_BY_OTHER_CAPTURE" });
    const after = await prisma.payment.findUniqueOrThrow({ where: { bookingId: c.bookingId } });
    expect([after.razorpayPaymentId, after.amountPaid, after.razorpayOrderId]).toEqual([settled.razorpayPaymentId, settled.amountPaid, settled.razorpayOrderId]);
    const alert = await prisma.opsAlert.findFirst({ where: { alertType: "payment_orphan_capture", message: { contains: pid("dup") } } });
    expect(alert?.severity).toBe("CRITICAL");
  });

  test("a capture on a replaced order with a different amount is not settled; it is alerted", async () => {
    if (!dbOk) return;
    const c = await customer();
    const o1 = await paymentService.createOrder(c.userId, c.bookingId);
    if (!o1 || "error" in o1) throw new Error(JSON.stringify(o1));
    await fail(o1.razorpayOrderId, pid("f1"));
    await paymentService.createOrder(c.userId, c.bookingId);
    const r = await capture(o1.razorpayOrderId, pid("odd"), 99900);
    expect(r).toEqual({ handled: true, reason: "ORPHAN_CAPTURE_ALERTED:AMOUNT_MISMATCH" });
    expect((await prisma.payment.findUniqueOrThrow({ where: { bookingId: c.bookingId } })).status).toBe("INITIATED");
  });
});

describe.serial("D4 — each gateway refund is counted exactly once", () => {
  async function paidPayment() {
    const c = await customer();
    const o = await paymentService.createOrder(c.userId, c.bookingId);
    if (!o || "error" in o) throw new Error(JSON.stringify(o));
    await capture(o.razorpayOrderId, pid("paid"));
    return prisma.payment.findUniqueOrThrow({ where: { bookingId: c.bookingId } });
  }
  const refund = (paymentId: string, refundId: string, paise: number) => refundLedgerSyncService.syncFromWebhook({ razorpayPaymentId: paymentId, refundId, refundStatus: "processed", refundAmountPaise: paise });

  test("refund A, refund B, then a replay of A → refunded 500, not 800; status PARTIALLY_REFUNDED", async () => {
    if (!dbOk) return;
    const p = await paidPayment();
    expect((await refund(p.razorpayPaymentId!, `rfnd_${RUN}_${seq}_A`, 30000)).reason).toBe("REFUND_LEDGER_SYNCED");
    expect((await refund(p.razorpayPaymentId!, `rfnd_${RUN}_${seq}_B`, 20000)).reason).toBe("REFUND_LEDGER_SYNCED");
    expect((await refund(p.razorpayPaymentId!, `rfnd_${RUN}_${seq}_A`, 30000)).reason).toBe("ALREADY_SYNCED");
    const after = await prisma.payment.findUniqueOrThrow({ where: { id: p.id } });
    expect([after.refundedAmount, Number(after.refundedAmountPaise), after.status]).toEqual([500, 50000, "PARTIALLY_REFUNDED"]);
  });

  test("six concurrent deliveries of one refund are counted once", async () => {
    if (!dbOk) return;
    const p = await paidPayment();
    const id = `rfnd_${RUN}_${seq}_C`;
    await Promise.all(Array.from({ length: 6 }, () => refund(p.razorpayPaymentId!, id, 25000)));
    const after = await prisma.payment.findUniqueOrThrow({ where: { id: p.id } });
    expect(after.refundedAmount).toBe(250);
    expect(await prisma.journalEntry.count({ where: { idempotencyKey: `refund:${id}` } })).toBe(1);
  });
});

describe.serial("webhook dedup — one processor per event", () => {
  test("concurrent first deliveries: exactly one PROCESS, the rest SKIP, none throw", async () => {
    if (!dbOk) return;
    const eventId = `evt_${RUN}_new`;
    made.events.push(eventId);
    const results = await Promise.all(Array.from({ length: 8 }, () => webhookDedupService.beginProcessing(eventId, "payment.captured")));
    expect(results.filter((r) => r === "PROCESS").length).toBe(1);
    expect(results.filter((r) => r === "SKIP").length).toBe(7);
  });

  test("concurrent retries of a FAILED event: exactly one RETRY", async () => {
    if (!dbOk) return;
    const eventId = `evt_${RUN}_failed`;
    made.events.push(eventId);
    expect(await webhookDedupService.beginProcessing(eventId, "payment.captured")).toBe("PROCESS");
    await webhookDedupService.markFailed(eventId, "boom");
    const results = await Promise.all(Array.from({ length: 8 }, () => webhookDedupService.beginProcessing(eventId, "payment.captured")));
    expect(results.filter((r) => r === "RETRY").length).toBe(1);
    expect(results.filter((r) => r === "SKIP").length).toBe(7);
  });
});
