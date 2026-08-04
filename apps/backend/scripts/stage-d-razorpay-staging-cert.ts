/**
 * Stage D — Razorpay TEST payment certification on authoritative staging.
 * Lightweight — no full HTTP app bootstrap (Cloud Run job memory safe).
 */
import "../src/load-env";
import crypto from "crypto";
import prisma from "../src/lib/prisma";
import { walletService } from "../src/services/wallet.service";
import { paymentService } from "../src/services/payment.service";
import { razorpayService } from "../src/services/razorpay.service";
import { webhookDedupService } from "../src/services/webhook-dedup.service";
import { processOutboxBatch } from "../src/events/core/outbox-processor";
import { EVENT_TYPES } from "../src/events/catalog/event-types";
import { WalletTxnStatus } from "@prisma/client";

type Gate = { id: string; status: "PASS" | "FAIL" | "BLOCKED"; detail: string };
const gates: Gate[] = [];
const tag = `staged_pay_${Date.now()}`;

function gate(id: string, status: Gate["status"], detail: string) {
  gates.push({ id, status, detail });
  const icon = status === "PASS" ? "✓" : status === "FAIL" ? "✗" : "⊘";
  console.log(`[${icon}] ${id}: ${detail}`);
}

function signPayment(orderId: string, paymentId: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(`${orderId}|${paymentId}`).digest("hex");
}

function signWebhook(raw: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(raw).digest("hex");
}

async function flushOutbox(maxRounds = 8): Promise<void> {
  for (let i = 0; i < maxRounds; i++) {
    const batch = await processOutboxBatch();
    if (batch.claimed === 0) break;
  }
}

async function dispatchWebhook(
  body: string,
  signature: string,
  eventId: string,
): Promise<{ ok: boolean; reason: string }> {
  if (!razorpayService.verifyWebhookSignature(body, signature)) {
    return { ok: false, reason: "INVALID_SIGNATURE" };
  }
  const event = JSON.parse(body) as { event: string; payload: Record<string, unknown> };
  const begin = await webhookDedupService.beginProcessing(eventId, event.event, eventId);
  if (!begin.shouldProcess) return { ok: true, reason: begin.reason ?? "DUPLICATE" };
  const result = await paymentService.reconcileFromWebhook(event);
  if (result.handled) {
    await webhookDedupService.markProcessed(eventId);
    return { ok: true, reason: result.reason };
  }
  await webhookDedupService.markFailed(eventId, result.reason);
  return { ok: false, reason: result.reason };
}

async function main() {
  console.log(`=== STAGE D — RAZORPAY TEST CERT === tag=${tag}`);

  const KEY_ID = process.env.RAZORPAY_KEY_ID?.trim() ?? "";
  const KEY_SECRET = process.env.RAZORPAY_KEY_SECRET?.trim() ?? "";
  const WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET?.trim() ?? "";

  if (process.env.APP_ENV !== "staging") {
    gate("env.staging", "BLOCKED", "APP_ENV must be staging");
    process.exit(2);
  }
  if (!KEY_ID.startsWith("rzp_test_")) {
    gate("razorpay.test-mode", "BLOCKED", `expected rzp_test_* got ${KEY_ID.slice(0, 12) || "empty"}`);
    process.exit(2);
  }
  if (KEY_ID.startsWith("rzp_live_")) {
    gate("razorpay.never-live", "BLOCKED", "live keys rejected");
    process.exit(2);
  }
  gate("razorpay.test-mode", "PASS", `${KEY_ID.slice(0, 14)}…`);

  const customer = await prisma.user.findFirst({
    where: { email: "stage-d-customer@homigo-staging.test" },
  });
  if (!customer) {
    gate("fixtures", "BLOCKED", "run stage-d-seed-staging.mjs first");
    process.exit(2);
  }
  gate("fixtures", "PASS", customer.id);

  const amount = 101;
  const topUp = await walletService.addMoney(customer.id, amount);
  if (!topUp || "error" in topUp) {
    gate("payment.create", "FAIL", JSON.stringify(topUp));
    process.exit(1);
  }
  const orderId = topUp.razorpayOrderId;
  if (orderId.startsWith("order_dev_")) {
    gate("payment.create", "FAIL", "dev mock order — real Razorpay keys required");
    process.exit(1);
  }
  gate("payment.create", "PASS", orderId);

  const auth = Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString("base64");
  const orderRes = await fetch(`https://api.razorpay.com/v1/orders/${orderId}`, {
    headers: { Authorization: `Basic ${auth}` },
  });
  gate("payment.gateway-order", orderRes.ok ? "PASS" : "FAIL", `status=${orderRes.status}`);

  const paymentId = `pay_${tag}`;
  const webhookBody = JSON.stringify({
    event: "payment.captured",
    payload: {
      payment: {
        entity: {
          id: paymentId,
          order_id: orderId,
          status: "captured",
          amount: amount * 100,
        },
      },
    },
  });
  const eventId = `evt_${tag}`;
  const wh1 = await dispatchWebhook(webhookBody, signWebhook(webhookBody, WEBHOOK_SECRET), eventId);
  gate("webhook.signature", wh1.ok ? "PASS" : "FAIL", wh1.reason);

  const wh2 = await dispatchWebhook(webhookBody, signWebhook(webhookBody, WEBHOOK_SECRET), eventId);
  gate(
    "webhook.duplicate-idempotency",
    wh2.ok && (wh2.reason.includes("DUPLICATE") || wh2.reason.includes("ALREADY") || wh2.reason.includes("RECONCILED"))
      ? "PASS"
      : "FAIL",
    wh2.reason,
  );

  const badSig = razorpayService.verifyWebhookSignature(webhookBody, "deadbeef");
  gate("webhook.bad-signature", badSig === false ? "PASS" : "FAIL", `verify=${badSig}`);

  const signature = signPayment(orderId, paymentId, KEY_SECRET);
  const verify1 = await walletService.verifyTopUp(customer.id, {
    razorpayOrderId: orderId,
    razorpayPaymentId: paymentId,
    razorpaySignature: signature,
  });
  gate(
    "payment.verify-success",
    !("error" in verify1) || (verify1 as { alreadySettled?: boolean }).alreadySettled ? "PASS" : "FAIL",
    "error" in verify1 ? String(verify1.error) : "ok",
  );

  const verify2 = await walletService.verifyTopUp(customer.id, {
    razorpayOrderId: orderId,
    razorpayPaymentId: paymentId,
    razorpaySignature: signature,
  });
  const dupBlocked = (verify2 as { alreadySettled?: boolean }).alreadySettled === true;
  gate("payment.verify-idempotency", dupBlocked ? "PASS" : "FAIL", dupBlocked ? "alreadySettled" : "duplicate not blocked");

  const txn = await prisma.walletTransaction.findFirst({ where: { userId: customer.id, referenceId: orderId } });
  gate("wallet.payment.settled", txn?.status === WalletTxnStatus.COMPLETED ? "PASS" : "FAIL", txn?.status ?? "no txn");

  const booking = await prisma.booking.findFirst({
    where: { userId: customer.id, status: "COMPLETED" },
    orderBy: { createdAt: "desc" },
  });
  let bookingPayEvtId: string | null = null;
  if (booking) {
    const existingPay = await prisma.payment.findFirst({ where: { bookingId: booking.id } });
    if (existingPay?.status === "SUCCESS") {
      await prisma.payment.update({
        where: { id: existingPay.id },
        data: {
          status: "INITIATED",
          razorpayPaymentId: null,
          razorpaySignature: null,
          completedAt: null,
          amountPaid: null,
        },
      });
    }
    const order = await paymentService.createOrder(customer.id, booking.id);
    if (order?.razorpayOrderId && !order.razorpayOrderId.startsWith("order_dev_")) {
      const bkPaymentId = `pay_${tag}_bk`;
      const bkSig = signPayment(order.razorpayOrderId, bkPaymentId, KEY_SECRET);
      const verified = await paymentService.verify(customer.id, {
        razorpayOrderId: order.razorpayOrderId,
        razorpayPaymentId: bkPaymentId,
        razorpaySignature: bkSig,
      });
      gate(
        "booking.payment.verify",
        !("error" in verified) ? "PASS" : "FAIL",
        "error" in verified ? String(verified.error) : "success",
      );
      await flushOutbox();
      const paymentRow = await prisma.payment.findFirst({ where: { bookingId: booking.id } });
      const evt = paymentRow
        ? await prisma.eventOutbox.findFirst({
            where: { eventType: EVENT_TYPES.PAYMENT_SUCCESS, aggregateId: paymentRow.id },
            orderBy: { createdAt: "desc" },
          })
        : null;
      bookingPayEvtId = evt?.eventId ?? null;
    }
  }
  gate(
    "event.payment.success",
    bookingPayEvtId ? "PASS" : "FAIL",
    bookingPayEvtId ?? (booking ? "missing outbox row" : "no completed booking"),
  );

  const failed = gates.filter((g) => g.status === "FAIL").length;
  const blocked = gates.filter((g) => g.status === "BLOCKED").length;
  const summary = blocked > 0 ? "BLOCKED" : failed > 0 ? "FAIL" : "PASS";

  console.log("\n=== RAZORPAY CERT SUMMARY ===");
  console.log(JSON.stringify({ tag, summary, gates, failed, blocked, passed: gates.filter((g) => g.status === "PASS").length }, null, 2));
  await prisma.$disconnect();
  process.exit(summary === "PASS" ? 0 : summary === "BLOCKED" ? 2 : 1);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
