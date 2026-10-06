/**
 * REAL Razorpay TEST-MODE integration — the refund tender and unpaid-cancel fixes, proven against the
 * actual Razorpay TEST API instead of the application's dev-mock gateway.
 *
 * Skipped unless HOMIGO_RAZORPAY_TEST_MODE=1. Run it only like this (from apps/backend, absolute path):
 *
 *   HOMIGO_RAZORPAY_TEST_MODE=1 bun test --preload ./src/__tests__/helpers/razorpay-test-mode.ts \
 *     "D:/homigo/apps/backend/src/__tests__/razorpay-test-mode.real.test.ts" --timeout 900000
 *
 * The preload refuses unless the DB is a test DB and the key is `rzp_test_`, and narrows egress to
 * api.razorpay.com. Payments are made in a headless browser through Razorpay's own checkout.js and its
 * TEST demo bank (scripts/razorpay-test-checkout.cjs); Razorpay computes the signature and the
 * application verifies it with the real secret. Every client step goes through `app.handle` — the
 * HTTP routes the customer web app calls — with the application's own `razorpayService`.
 *
 * The only interference with the provider path is TRANSPORT fault injection for the ambiguity tests:
 * a request is really delivered and its response dropped, or dropped before delivery. The provider is
 * never replaced; what Razorpay holds is always read back from Razorpay.
 *
 * No `expect(promise).resolves` — see bun-expect-resolves-pending-hang.
 */
import "../load-env";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import prisma from "../lib/prisma";
import app from "../index";
import {
  bearer,
  cleanupAdversarialFixtures,
  dbReachable,
  heartbeatFresh,
  seedAdversarialFixtures,
  type AdvCtx,
} from "./helpers/adversarial-fixtures";
import { refuseIfNotIsolatedTestDb } from "./helpers/isolated-test-db";
import { freshLoopClock } from "./helpers/fresh-loop-clock";
import { BOOKING_CREATE_PATH, withQuoteToken } from "./helpers/quote-token";
import { razorpayService } from "../services/razorpay.service";
import { refundLedgerSyncService } from "../services/refund-ledger-sync.service";
import { bookingRefundService } from "../services/booking-refund.service";

const REAL = process.env.HOMIGO_RAZORPAY_TEST_MODE === "1";
const RUN = `rzptest-${Date.now().toString(36)}`;
const DRIVER = "D:/homigo/apps/backend/scripts/razorpay-test-checkout.cjs";
const evidence: Record<string, unknown> = { run: RUN, startedAt: new Date().toISOString() };

let ctx: AdvCtx;
let day = 4; // > 24 h ahead: the customer policy's free tier, so a cancellation refunds in full.

type User = AdvCtx["customerA"];
type Res = { status: number; json: any };

function istSlot(daysAhead: number, hhmm = "11:00"): Date {
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" })
    .format(new Date(Date.now() + daysAhead * 86_400_000));
  return new Date(`${ymd}T${hhmm}:00+05:30`);
}

async function call(user: User, method: string, path: string, body?: unknown): Promise<Res> {
  // Booking create requires a price quote (QUOTE_REQUIRED otherwise) — quote first, as a client does.
  if (method === "POST" && path === BOOKING_CREATE_PATH) body = await withQuoteToken(app, bearer(user), body);
  const res = await app.handle(
    new Request(`http://localhost${path}`, {
      method,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${bearer(user)}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    /* empty body */
  }
  return { status: res.status, json };
}

/** A booking created the way the customer app creates one, carrying whatever label the client sent. */
async function createBooking(label?: string): Promise<{ id: string; finalAmount: number }> {
  await heartbeatFresh(ctx);
  const body: Record<string, unknown> = {
    serviceId: ctx.serviceId,
    providerId: ctx.providerId,
    addressId: ctx.addressAId,
    scheduledDate: istSlot((day += 1)).toISOString(),
  };
  if (label !== undefined) body.paymentMethod = label;
  const r = await call(ctx.customerA, "POST", "/api/bookings", body);
  if (r.status !== 201) throw new Error(`booking create ${r.status}: ${JSON.stringify(r.json)}`);
  const id = r.json.data.booking.id as string;
  const b = await prisma.booking.findUniqueOrThrow({ where: { id }, select: { finalAmount: true, paymentMethod: true } });
  if (label !== undefined) expect(b.paymentMethod).toBe(label);
  return { id, finalAmount: b.finalAmount };
}

type CheckoutResult = { ok: boolean; razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string; demoBank: string };

/** Pays a REAL Razorpay TEST order in Razorpay's own checkout. */
async function checkout(orderId: string): Promise<CheckoutResult> {
  expect(orderId.startsWith("order_")).toBe(true);
  expect(orderId.startsWith("order_dev_")).toBe(false);
  await freshLoopClock(); // Bun measures the spawn timeout from the loop's cached clock (helpers/fresh-loop-clock)
  const r = Bun.spawnSync(["node", DRIVER, razorpayService.keyId, orderId], { timeout: 180_000 });
  const out = r.stdout.toString().trim();
  if (r.exitCode !== 0 || !out) throw new Error(`checkout failed (${r.exitCode}): ${r.stderr.toString().slice(-400)}`);
  const pay = JSON.parse(out.split("\n").pop()!) as CheckoutResult;
  expect(pay.ok).toBe(true);
  expect(pay.razorpay_order_id).toBe(orderId);
  expect(pay.razorpay_payment_id.startsWith("pay_")).toBe(true);
  expect(pay.demoBank).toContain("/gateway/mocksharp/");
  return pay;
}

const verifyBody = (p: CheckoutResult) => ({
  razorpayOrderId: p.razorpay_order_id,
  razorpayPaymentId: p.razorpay_payment_id,
  razorpaySignature: p.razorpay_signature,
});

const walletOf = async () =>
  (await prisma.user.findUniqueOrThrow({ where: { id: ctx.customerA.id }, select: { walletBalance: true } })).walletBalance;

async function settle(bookingId: string) {
  for (let i = 0; i < 300; i++) {
    const b = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId }, select: { refundStatus: true } });
    if (b.refundStatus !== "pending") return b.refundStatus;
    await new Promise((r) => setTimeout(r, 200));
  }
  return "pending";
}

/** Everything the application recorded about money for one booking. */
async function appView(bookingId: string) {
  const payment = await prisma.payment.findUnique({ where: { bookingId } });
  const rr = payment ? await prisma.refundRequest.findMany({ where: { paymentId: payment.id }, orderBy: { createdAt: "asc" } }) : [];
  const walletTxns = await prisma.walletTransaction.findMany({ where: { referenceId: bookingId }, orderBy: { createdAt: "asc" } });
  const booking = await prisma.booking.findUniqueOrThrow({
    where: { id: bookingId },
    select: { status: true, paymentStatus: true, paymentMethod: true, refundStatus: true, refundAmount: true, finalAmount: true },
  });
  const gatewayIds = rr.map((r) => r.gatewayRefundId).filter((x): x is string => Boolean(x));
  const journals = await prisma.journalEntry.findMany({
    where: {
      OR: [
        { idempotencyKey: { contains: bookingId } },
        ...(gatewayIds.length ? [{ idempotencyKey: { in: gatewayIds.map((g) => `refund:${g}`) } }] : []),
        ...(payment ? [{ idempotencyKey: { contains: payment.id } }] : []),
      ],
    },
    select: { idempotencyKey: true },
  });
  return { payment, rr, walletTxns, booking, journals: journals.map((j) => j.idempotencyKey).filter((k): k is string => k !== null).sort() };
}

async function notificationsFor(bookingId: string) {
  await new Promise((r) => setTimeout(r, 1500)); // detached notification writes
  return prisma.notification.findMany({ where: { referenceId: bookingId }, select: { type: true, message: true } });
}

const paise = (inr: number) => Math.round(inr * 100);

/** What Razorpay itself holds for a payment — the provider side of every comparison. */
async function providerRefunds(payId: string) {
  const items = await razorpayService.fetchRefundsForPayment(payId);
  if (items === null) throw new Error(`Razorpay refund lookup failed for ${payId}`);
  return items.map((i) => ({ id: i.id, amount: i.amount ?? 0, status: i.status, op: i.notes?.homigo_operation }));
}

/** Transport fault injection for the next refund POST to one payment. The provider is never faked. */
function faultNextRefund(payId: string, mode: "lose_response" | "never_delivered") {
  const inner = globalThis.fetch;
  let used = false;
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
    if (!used && url.includes(`/v1/payments/${payId}/refund`) && (init?.method ?? "GET").toUpperCase() === "POST") {
      used = true;
      globalThis.fetch = inner;
      if (mode === "lose_response") {
        const res = await inner(input, init); // really delivered; Razorpay really acts on it
        await res.text().catch(() => "");
        throw Object.assign(new Error("socket hang up"), { code: "ECONNRESET" });
      }
      throw Object.assign(new Error("The operation was aborted"), { name: "AbortError" });
    }
    return inner(input, init);
  }) as typeof fetch;
  return () => {
    globalThis.fetch = inner;
  };
}

/**
 * Transport fault injection for the next refund LOOKUP of one payment: the gateway answers 503 (an
 * upstream/proxy failure). Nothing is sent to Razorpay for that one read; every other call is real.
 */
function faultNextLookup(payId: string, mode: "http_503" | "throw" = "http_503") {
  const inner = globalThis.fetch;
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
    if (url.includes(`/v1/payments/${payId}/refunds`) && (init?.method ?? "GET").toUpperCase() === "GET") {
      globalThis.fetch = inner;
      if (mode === "throw") throw Object.assign(new Error("socket hang up"), { code: "ECONNRESET" });
      return new Response('{"error":{"code":"SERVER_ERROR"}}', { status: 503, headers: { "Content-Type": "application/json" } });
    }
    return inner(input, init);
  }) as typeof fetch;
  return () => {
    globalThis.fetch = inner;
  };
}

async function payThroughGateway(bookingId: string) {
  const order = await call(ctx.customerA, "POST", "/api/payments/create-order", { bookingId });
  expect(order.status).toBe(200);
  const orderId = order.json.data.razorpayOrderId as string;
  const pay = (await checkout(orderId));
  const v = await call(ctx.customerA, "POST", "/api/payments/verify", verifyBody(pay));
  expect(v.status).toBe(200);
  const p = await prisma.payment.findUniqueOrThrow({ where: { bookingId } });
  expect(p.status).toBe("SUCCESS");
  expect(p.razorpayPaymentId).toBe(pay.razorpay_payment_id);
  const atProvider = (await razorpayService.fetchOrderPayments(orderId)).filter((x) => x.status === "captured");
  expect(atProvider.length).toBe(1);
  expect(atProvider[0].amount).toBe(paise(p.amountPaid || p.amount));
  return { orderId, payId: pay.razorpay_payment_id, paymentRowId: p.id, paid: p.amountPaid || p.amount, label: p.paymentMethod, capturedPaise: atProvider[0].amount ?? -1 };
}

describe.skipIf(!REAL)("REAL Razorpay TEST mode", () => {
  beforeAll(async () => {
    if (!(await dbReachable())) throw new Error("test DB unreachable");
    const [{ db }] = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
    refuseIfNotIsolatedTestDb(db);
    const env = razorpayService.paymentEnvironment;
    if (!razorpayService.isConfigured) throw new Error("razorpayService is not configured — run with the razorpay-test-mode preload");
    if (env.environment !== "TEST" || !razorpayService.keyId.startsWith("rzp_test_")) throw new Error(`REFUSING: provider environment ${env.environment}`);
    evidence.environment = { database: db, provider: env.environment, keyPrefix: env.keyPrefix };
    ctx = await seedAdversarialFixtures(RUN);
    await prisma.user.update({ where: { id: ctx.customerA.id }, data: { walletBalance: 0 } });
  }, 180_000);

  afterAll(async () => {
    evidence.finishedAt = new Date().toISOString();
    if (process.env.RAZORPAY_TEST_EVIDENCE) writeFileSync(process.env.RAZORPAY_TEST_EVIDENCE, JSON.stringify(evidence, null, 2));
    // Payments and bookings are removed by the suites' own fixture cleanup. Ledger journals are
    // history and are not deleted; Razorpay keeps its TEST objects, tagged by the TEST key.
    if (process.env.RAZORPAY_TEST_KEEP_FIXTURES !== "1") await cleanupAdversarialFixtures(RUN);
  }, 120_000);

  describe.serial("gateway payments", () => {
    test("A — actual Razorpay, label 'wallet': the refund goes back through Razorpay, never to the wallet", async () => {
      const b = await createBooking("wallet");

      // Signature verification is not bypassed: a forged payment is refused before the real one.
      const order = await call(ctx.customerA, "POST", "/api/payments/create-order", { bookingId: b.id });
      expect(order.status).toBe(200);
      const orderId = order.json.data.razorpayOrderId as string;
      const forged = await call(ctx.customerA, "POST", "/api/payments/verify", {
        razorpayOrderId: orderId,
        razorpayPaymentId: "pay_Forged00000001",
        razorpaySignature: "0".repeat(64),
      });
      expect(forged.status).toBe(400);
      expect(forged.json.code).toBe("INVALID_SIGNATURE");

      const pay = (await checkout(orderId));
      const v = await call(ctx.customerA, "POST", "/api/payments/verify", verifyBody(pay));
      expect(v.status).toBe(200);

      const before = await appView(b.id);
      expect(before.payment!.status).toBe("SUCCESS");
      expect(before.payment!.paymentMethod).toBe("wallet"); // the label, copied from the client
      expect(before.payment!.razorpayPaymentId).toBe(pay.razorpay_payment_id);
      const paid = before.payment!.amountPaid || before.payment!.amount;
      const captured = (await razorpayService.fetchOrderPayments(orderId)).filter((x) => x.status === "captured");
      expect(captured.map((c) => c.amount)).toEqual([paise(paid)]);
      const walletBefore = await walletOf();

      const quote = await call(ctx.customerA, "GET", `/api/bookings/${b.id}/cancellation-quote`);
      const cancel = await call(ctx.customerA, "POST", `/api/bookings/${b.id}/cancel`, { reason: "rzp test A" });
      expect(cancel.status).toBe(200);
      expect(cancel.json.data.booking.refundStatus).toBe("pending");
      expect(cancel.json.data.booking.refundAmount).toBe(paid);
      expect(await settle(b.id)).not.toBe("pending");

      const after = await appView(b.id);
      const provider = await providerRefunds(pay.razorpay_payment_id);
      // Wallet side: nothing.
      expect(await walletOf()).toBe(walletBefore);
      expect(after.walletTxns.filter((t) => t.type === "REFUND").length).toBe(0);
      expect(after.journals.some((k) => k.startsWith("wallet_booking_refund:"))).toBe(false);
      // Gateway side: one request, completed with a REAL Razorpay refund id.
      expect(after.rr.length).toBe(1);
      expect(after.rr[0].status).toBe("COMPLETED");
      expect(after.rr[0].gatewayRefundId?.startsWith("rfnd_")).toBe(true);
      expect(after.rr[0].gatewayRefundId?.startsWith("rfnd_dev_")).toBe(false);
      expect(after.journals).toContain(`refund:${after.rr[0].gatewayRefundId}`);
      // Provider side: exactly one refund, the same id and the same amount.
      expect(provider.length).toBe(1);
      expect(provider[0].id).toBe(after.rr[0].gatewayRefundId!);
      expect(provider[0].amount).toBe(paise(paid));
      expect(provider[0].op).toBe(after.rr[0].idempotencyKey);
      expect(after.payment!.status).toBe("REFUNDED");
      expect(paise(after.payment!.refundedAmount ?? 0)).toBe(paise(paid));

      // Idempotency: a second cancel, the retry sweep and an admin refund add nothing anywhere.
      const again = await call(ctx.customerA, "POST", `/api/bookings/${b.id}/cancel`, { reason: "rzp test A again" });
      const sweep = await bookingRefundService.retryFailedRefunds();
      const extra = await call(ctx.superAdmin, "POST", `/api/payments/${after.payment!.id}/refund`, { amount: 1, reason: "rzp test A extra" });
      const provider2 = await providerRefunds(pay.razorpay_payment_id);
      expect(again.status).toBe(400);
      expect(extra.json.success).toBe(false);
      expect(provider2.length).toBe(1);
      expect((await appView(b.id)).rr.length).toBe(1);
      expect(await walletOf()).toBe(walletBefore);

      evidence.A = {
        bookingId: b.id, label: "wallet", orderId, payId: pay.razorpay_payment_id, paid, capturedPaise: captured[0].amount,
        forgedVerify: forged.status, quoteHint: quote.json?.data?.refundMethodHint ?? quote.json?.data?.quote?.refundMethodHint ?? null,
        cancel: cancel.json.data.booking, refundRequest: { status: after.rr[0].status, gatewayRefundId: after.rr[0].gatewayRefundId, key: after.rr[0].idempotencyKey },
        provider, journals: after.journals, walletDelta: (await walletOf()) - walletBefore,
        idempotency: { secondCancel: again.status, sweep, adminExtra: extra.json?.code ?? extra.status, providerCountAfter: provider2.length },
        notifications: await notificationsFor(b.id),
      };
    }, 600_000);

    test("C + partial + ambiguity — actual Razorpay, correct label: partial, repeated, lost-response, undelivered and final refunds all agree with Razorpay", async () => {
      const b = await createBooking("razorpay");
      const g = await payThroughGateway(b.id);
      const admin = ctx.superAdmin;
      const refund = (amount: number, reason: string) => call(admin, "POST", `/api/payments/${g.paymentRowId}/refund`, { amount, reason });

      // 1. Partial ₹100.
      const p1 = await refund(100, "rzp test partial 1");
      expect(p1.status).toBe(200);
      let prov = await providerRefunds(g.payId);
      expect(prov.map((p) => p.amount)).toEqual([10_000]);

      // 2. The same request repeated: idempotent, no second provider refund.
      const p1again = await refund(100, "rzp test partial 1");
      expect(p1again.status).toBe(200);
      expect(p1again.json.data.refundId).toBe(p1.json.data.refundId);
      expect((await providerRefunds(g.payId)).length).toBe(1);

      // 3. ₹50 whose response is LOST after Razorpay acted: INDETERMINATE, payment held, then settled
      //    by reading Razorpay — and a direct replay under the same key does not create a second one.
      const restore1 = faultNextRefund(g.payId, "lose_response");
      const p2 = await refund(50, "rzp test lost response");
      restore1();
      expect(p2.json.success).toBe(false);
      expect(p2.json.code).toBe("REFUND_OUTCOME_UNKNOWN");
      let view = await appView(b.id);
      const lost = view.rr.find((r) => r.amount === 50)!;
      expect(lost.status).toBe("INDETERMINATE");
      expect(view.payment!.status).toBe("REFUNDING");
      const blocked = await refund(10, "rzp test while unknown");
      expect(blocked.json.success).toBe(false);
      const replay = await razorpayService.executeGatewayRefund({ paymentId: g.payId, amountInr: 50, operationKey: lost.idempotencyKey });
      prov = await providerRefunds(g.payId);
      expect(prov.length).toBe(2); // the lost-response refund exists at Razorpay, exactly once
      // A lookup that FAILS is not a lookup that found nothing. Found by this suite (2026-09-27): a
      // burst of real lookups returned [] for a payment holding a processed refund, and reconciliation
      // reads [] as "never existed" — FAILED, payment released for another refund.
      const restoreLookup = faultNextLookup(g.payId);
      const recFailed = await refundLedgerSyncService.reconcileIndeterminateRefund(lost.id);
      restoreLookup();
      expect(recFailed.resolved).toBe(false);
      expect(recFailed.outcome).toBe("LOOKUP_FAILED");
      expect((await prisma.refundRequest.findUniqueOrThrow({ where: { id: lost.id } })).status).toBe("INDETERMINATE");
      expect((await prisma.payment.findUniqueOrThrow({ where: { id: g.paymentRowId } })).status).toBe("REFUNDING");
      // A transport failure on the read (nothing answered at all) is the same unknown, not "none".
      const restoreThrow = faultNextLookup(g.payId, "throw");
      const recThrown = await refundLedgerSyncService.reconcileIndeterminateRefund(lost.id);
      restoreThrow();
      expect(recThrown.outcome).toBe("LOOKUP_FAILED");
      // And while it is unresolved, no second refund can start: the payment is still held.
      const blockedAfterFailedLookup = await refund(10, "rzp test after failed lookup");
      expect(blockedAfterFailedLookup.json.success).toBe(false);
      expect(blockedAfterFailedLookup.json.code).toBe("REFUND_IN_PROGRESS");
      expect((await providerRefunds(g.payId)).length).toBe(2);
      const rec1 = await refundLedgerSyncService.reconcileIndeterminateRefund(lost.id);
      expect(rec1.outcome).toBe("CONFIRMED");

      // 4. ₹25 that never reached Razorpay: INDETERMINATE, reconciled to FAILED, retried for real.
      const restore2 = faultNextRefund(g.payId, "never_delivered");
      const p3 = await refund(25, "rzp test undelivered");
      restore2();
      expect(p3.json.code).toBe("REFUND_OUTCOME_UNKNOWN");
      view = await appView(b.id);
      const undelivered = view.rr.find((r) => r.amount === 25)!;
      const rec2 = await refundLedgerSyncService.reconcileIndeterminateRefund(undelivered.id);
      expect(rec2.outcome).toBe("NOT_AT_GATEWAY");
      expect((await providerRefunds(g.payId)).length).toBe(2);
      const p3retry = await refund(25, "rzp test undelivered");
      expect(p3retry.status).toBe(200);
      expect((await providerRefunds(g.payId)).length).toBe(3);

      // 5. Customer cancels: the remainder, not the whole amount again.
      const cancel = await call(ctx.customerA, "POST", `/api/bookings/${b.id}/cancel`, { reason: "rzp test C" });
      expect(cancel.status).toBe(200);
      await settle(b.id);
      view = await appView(b.id);
      prov = await providerRefunds(g.payId);
      const appRefunded = view.rr.filter((r) => r.status === "COMPLETED").reduce((s, r) => s + paise(r.amount), 0);
      const providerRefunded = prov.reduce((s, p) => s + p.amount, 0);
      expect(providerRefunded).toBe(appRefunded);
      expect(paise(view.payment!.refundedAmount ?? 0)).toBe(appRefunded);
      expect(providerRefunded).toBeLessThanOrEqual(g.capturedPaise);
      expect(prov.length).toBe(view.rr.filter((r) => r.status === "COMPLETED").length);
      expect(new Set(prov.map((p) => p.id)).size).toBe(prov.length);
      for (const r of view.rr.filter((x) => x.status === "COMPLETED")) expect(prov.map((p) => p.id)).toContain(r.gatewayRefundId!);
      expect(view.walletTxns.filter((t) => t.type === "REFUND").length).toBe(0);

      evidence.C = {
        bookingId: b.id, label: "razorpay", payId: g.payId, paid: g.paid, capturedPaise: g.capturedPaise,
        partial1: p1.json.data, repeat: p1again.json.data,
        lostResponse: { app: p2.json.code, statusBeforeReconcile: lost.status, blockedWhileUnknown: blocked.json.code, directReplay: replay.kind, failedLookup: recFailed.outcome, thrownLookup: recThrown.outcome, refundAfterFailedLookup: blockedAfterFailedLookup.json.code, reconcile: rec1.outcome },
        undelivered: { app: p3.json.code, reconcile: rec2.outcome, retry: p3retry.json.data },
        cancel: cancel.json.data.booking,
        refundRequests: view.rr.map((r) => ({ amount: r.amount, status: r.status, gatewayRefundId: r.gatewayRefundId })),
        provider: prov, appRefundedPaise: appRefunded, providerRefundedPaise: providerRefunded,
        payment: { status: view.payment!.status, refundedAmount: view.payment!.refundedAmount }, journals: view.journals,
      };
    }, 900_000);
  });

  describe.serial("wallet tender", () => {
    test("wallet top-up paid through REAL Razorpay TEST checkout credits the wallet", async () => {
      const before = await walletOf();
      const t = await call(ctx.customerA, "POST", "/api/wallet/add-money", { amount: 1500, idempotencyKey: `${RUN}-topup` });
      expect(t.status).toBe(200);
      const pay = (await checkout(t.json.data.razorpayOrderId));
      const v = await call(ctx.customerA, "POST", "/api/payments/verify", verifyBody(pay));
      expect(v.status).toBe(200);
      expect(await walletOf()).toBe(before + 1500);
      evidence.topUp = { orderId: t.json.data.razorpayOrderId, payId: pay.razorpay_payment_id, amount: 1500, walletAfter: await walletOf() };
    }, 300_000);

    for (const [name, label] of [["B — actual wallet, label 'razorpay'", "razorpay"], ["D — actual wallet, label 'wallet'", "wallet"]] as const) {
      test(`${name}: refunded to the wallet, nothing sent to Razorpay`, async () => {
        const b = await createBooking(label);
        const walletBefore = await walletOf();
        const paid = await call(ctx.customerA, "POST", "/api/wallet/checkout/pay", { bookingId: b.id });
        expect(paid.status).toBe(200);
        expect(await walletOf()).toBe(walletBefore - b.finalAmount);

        const cancel = await call(ctx.customerA, "POST", `/api/bookings/${b.id}/cancel`, { reason: `rzp test ${label}` });
        expect(cancel.status).toBe(200);
        expect(cancel.json.data.booking.refundAmount).toBe(b.finalAmount);
        expect(await settle(b.id)).toBe("processed");
        const v = await appView(b.id);
        expect(await walletOf()).toBe(walletBefore);
        expect(v.walletTxns.filter((t) => t.type === "REFUND").length).toBe(1);
        expect(v.journals).toContain(`wallet_booking_refund:${b.id}`);
        expect(v.rr.length).toBe(0);
        expect(v.payment?.razorpayPaymentId?.startsWith("pay_") ?? false).toBe(false);

        const again = await call(ctx.customerA, "POST", `/api/bookings/${b.id}/cancel`, { reason: "again" });
        await bookingRefundService.retryFailedRefunds();
        expect(again.status).toBe(400);
        expect((await appView(b.id)).walletTxns.filter((t) => t.type === "REFUND").length).toBe(1);
        expect(await walletOf()).toBe(walletBefore);

        evidence[label === "razorpay" ? "B" : "D"] = {
          bookingId: b.id, label, paid: b.finalAmount, cancel: cancel.json.data.booking,
          walletTxns: v.walletTxns.map((t) => ({ type: t.type, amount: t.amount })), journals: v.journals,
          refundRequests: v.rr.length, paymentRow: v.payment ? { method: v.payment.paymentMethod, razorpayPaymentId: v.payment.razorpayPaymentId } : null,
          notifications: await notificationsFor(b.id),
        };
      }, 300_000);
    }

    test("E — unpaid booking labelled 'wallet': nothing refunded, recorded, sent or announced", async () => {
      const b = await createBooking("wallet");
      const walletBefore = await walletOf();
      expect(await prisma.payment.count({ where: { bookingId: b.id } })).toBe(0);

      const cancel = await call(ctx.customerA, "POST", `/api/bookings/${b.id}/cancel`, { reason: "rzp test E" });
      expect(cancel.status).toBe(200);
      expect(cancel.json.data.booking.refundAmount).toBe(0);
      expect(cancel.json.data.booking.refundStatus).toBe("none");
      // The response must not describe money that does not exist: no tier message promising a
      // refund, and no fee — nothing was paid, so nothing can be kept.
      expect(cancel.json.data.booking.cancellationFee).toBe(0);
      expect(cancel.json.data.booking.refundMessage).not.toMatch(/full refund|refund is on the way|% refund|fee applies/i);
      const v = await appView(b.id);
      const notes = await notificationsFor(b.id);
      expect(v.booking.refundAmount ?? 0).toBe(0);
      expect(v.booking.refundStatus).toBe("none");
      expect(v.payment).toBeNull();
      expect(v.rr.length).toBe(0);
      expect(v.walletTxns.length).toBe(0);
      expect(v.journals.length).toBe(0);
      expect(await walletOf()).toBe(walletBefore);
      for (const n of notes) expect(n.message.toLowerCase()).not.toContain("refund");

      evidence.E = { bookingId: b.id, label: "wallet", cancel: cancel.json.data.booking, booking: v.booking, notifications: notes, journals: v.journals };
    }, 120_000);
  });

  describe.serial("split wallet + Razorpay", () => {
    for (const [name, label] of [["split, correct label", "razorpay"], ["F — split, manipulated label 'wallet'", "wallet"]] as const) {
      test(`${name}: each leg goes back where it came from, in integer paise, and the legs add up`, async () => {
        const b = await createBooking(label);
        const walletBefore = await walletOf();
        const walletPart = 200;

        const init = await call(ctx.customerA, "POST", "/api/wallet/checkout/split/initiate", { bookingId: b.id, walletAmount: walletPart });
        expect(init.status).toBe(200);
        const pay = (await checkout(init.json.data.razorpayOrderId));
        const v = await call(ctx.customerA, "POST", "/api/wallet/checkout/split/verify", verifyBody(pay));
        expect(v.status).toBe(200);

        const paidView = await appView(b.id);
        const gatewayPart = paidView.payment!.amountPaid || paidView.payment!.amount;
        const captured = (await razorpayService.fetchOrderPayments(init.json.data.razorpayOrderId)).filter((x) => x.status === "captured");
        expect(captured.map((c) => c.amount)).toEqual([paise(gatewayPart)]);
        expect(paise(walletBefore - (await walletOf()))).toBe(paise(walletPart));
        expect(paise(walletPart) + paise(gatewayPart)).toBe(paise(b.finalAmount));

        const cancel = await call(ctx.customerA, "POST", `/api/bookings/${b.id}/cancel`, { reason: `rzp test split ${label}` });
        expect(cancel.status).toBe(200);
        await settle(b.id);
        const after = await appView(b.id);
        const prov = await providerRefunds(pay.razorpay_payment_id);
        const walletBack = after.walletTxns.filter((t) => t.type === "REFUND").reduce((s, t) => s + paise(t.amount), 0);
        const gatewayBack = prov.reduce((s, p) => s + p.amount, 0);

        expect(prov.length).toBe(1);
        expect(gatewayBack).toBe(paise(gatewayPart));
        expect(walletBack).toBe(paise(walletPart));
        expect(walletBack + gatewayBack).toBe(paise(b.finalAmount));
        expect(paise(await walletOf())).toBe(paise(walletBefore));
        const completed = after.rr.filter((r) => r.status === "COMPLETED");
        expect(completed.length).toBe(1);
        expect(completed[0].gatewayRefundId).toBe(prov[0].id);
        expect(after.journals).toContain(`refund:${prov[0].id}`);
        expect(after.journals).toContain(`wallet_booking_refund:${b.id}`);

        const again = await call(ctx.customerA, "POST", `/api/bookings/${b.id}/cancel`, { reason: "again" });
        await bookingRefundService.retryFailedRefunds();
        expect(again.status).toBe(400);
        expect((await providerRefunds(pay.razorpay_payment_id)).length).toBe(1);
        expect((await appView(b.id)).walletTxns.filter((t) => t.type === "REFUND").length).toBe(1);

        evidence[label === "razorpay" ? "split" : "F"] = {
          bookingId: b.id, label, total: b.finalAmount, walletPart, gatewayPart, payId: pay.razorpay_payment_id,
          paymentMethodRow: paidView.payment!.paymentMethod, cancel: cancel.json.data.booking,
          walletBackPaise: walletBack, gatewayBackPaise: gatewayBack, provider: prov,
          refundRequests: after.rr.map((r) => ({ amount: r.amount, status: r.status, gatewayRefundId: r.gatewayRefundId })),
          journals: after.journals,
        };
      }, 600_000);
    }
  });
});
