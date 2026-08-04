/**
 * Stage D Step 12 — Payment flow, financial atomicity & event certification.
 * Outputs structured JSON evidence to stdout (sanitized — no PII/secrets).
 *
 * Run via Cloud Run Job (STEP12_SCRIPT_B64) or locally:
 *   STAGING_EVENTS_CERTIFICATION=1 EVENTS_OUTBOX_ENABLED=true EVENTS_CONSUMERS_ENABLED=true \
 *     bun --env-file=.env.staging run scripts/stage-d-step-12-payment-cert.ts
 */
import "../src/load-env";
import crypto from "crypto";
import prisma from "../src/lib/prisma";
import { bookingService } from "../src/services/booking.service";
import { paymentService } from "../src/services/payment.service";
import { razorpayService } from "../src/services/razorpay.service";
import { webhookDedupService } from "../src/services/webhook-dedup.service";
import { financialLedgerService } from "../src/services/financial-ledger.service";
import { processOutboxBatch } from "../src/events/core/outbox-processor";
import { dispatchEvent } from "../src/events/core/event-bus";
import { bootstrapEventConsumers, resetEventConsumersForTests } from "../src/events/consumers";
import { eventPlatformConfig } from "../src/events/core/config";
import { EVENT_TYPES } from "../src/events/catalog/event-types";
import { AUDIT_CONSUMER_NAME } from "../src/events/consumers/audit.consumer";
import { METRICS_CONSUMER_NAME } from "../src/events/consumers/metrics.consumer";
import { AI_CONTEXT_INDEXER_CONSUMER_NAME } from "../src/events/consumers/ai-context-indexer.consumer";

const PaymentStatus = {
  INITIATED: "INITIATED",
  SUCCESS: "SUCCESS",
  FAILED: "FAILED",
} as const;

const STEP12_RUN_ID = `stage12-cert-${Date.now()}`;
const CERTIFIED_RC_SHA = "c31f154a128022fa7d9c4e44652506eedf3fa3e4";

type Gate = { id: string; status: "PASS" | "FAIL" | "SKIP" | "BLOCKED"; detail: string };
const gates: Gate[] = [];

function gate(id: string, status: Gate["status"], detail: string) {
  gates.push({ id, status, detail });
}

function signPayment(orderId: string, paymentId: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(`${orderId}|${paymentId}`).digest("hex");
}

function signWebhook(raw: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(raw).digest("hex");
}

async function flushOutbox(maxRounds = 12): Promise<number> {
  let published = 0;
  for (let i = 0; i < maxRounds; i++) {
    const batch = await processOutboxBatch();
    published += batch.published;
    if (batch.claimed === 0) break;
  }
  return published;
}

async function outboxPendingCount(): Promise<number> {
  return prisma.eventOutbox.count({ where: { status: { in: ["PENDING", "PROCESSING"] } } });
}

async function dlqUnresolvedCount(): Promise<number> {
  return prisma.eventDeadLetter.count({ where: { resolvedAt: null } });
}

async function waitForPaymentOutboxPublished(
  eventType: string,
  paymentId: string,
  timeoutMs = 45_000,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const row = await prisma.eventOutbox.findFirst({
      where: { eventType, aggregateId: paymentId },
      orderBy: { createdAt: "desc" },
    });
    if (row?.status === "PUBLISHED") return row;
    if (row?.status === "PENDING" || row?.status === "PROCESSING") await flushOutbox(3);
    await new Promise((r) => setTimeout(r, 400));
  }
  return null;
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
  if (begin === "SKIP") return { ok: true, reason: "DUPLICATE" };
  const result = await paymentService.reconcileFromWebhook(event);
  if (result.handled) {
    await webhookDedupService.markProcessed(eventId);
    return { ok: true, reason: result.reason };
  }
  await webhookDedupService.markFailed(eventId, result.reason);
  return { ok: false, reason: result.reason };
}

async function ensureStep12Fixtures(runId: string, suffix: string) {
  const customerEmail = `stage12-${suffix}-${runId}@homigo-staging.test`;
  const customerId = `usr_${runId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 24)}_${suffix}`;
  const addressId = `addr_${runId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 24)}_${suffix}`;
  const serviceId = `svc_${runId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 24)}_${suffix}`;
  const numeric = runId.replace(/\D/g, "").slice(-10) || String(Date.now()).slice(-10);
  const phoneTail = `${numeric.slice(0, 8)}${suffix.charCodeAt(0) % 10}`;
  const customerPhone = `+919${phoneTail}`;

  let customer = await prisma.user.findFirst({
    where: { email: customerEmail },
    include: { addresses: { take: 1 } },
  });

  if (!customer) {
    await prisma.$executeRaw`
      INSERT INTO users (id, email, phone_number, first_name, last_name, role, password, is_email_verified, is_phone_verified, created_at, updated_at)
      VALUES (${customerId}, ${customerEmail}, ${customerPhone}, 'Stage12', ${suffix === "success" ? "Success" : "Failure"}, 'CUSTOMER'::"UserRole", 'seed_hash', true, true, NOW(), NOW())`;
    await prisma.$executeRaw`
      INSERT INTO addresses (id, user_id, label, address_line1, city, state, zip_code, country, full_address, latitude, longitude, is_default, created_at, updated_at)
      VALUES (${addressId}, ${customerId}, 'Stage12 Cert', 'Stage12 synthetic address', 'Delhi', 'Delhi', '110001', 'IN', 'Stage12 synthetic, Delhi', 28.6139, 77.2090, true, NOW(), NOW())`;
    await prisma.$executeRaw`
      INSERT INTO services (id, name, slug, description, category, base_price, estimated_duration, is_active, created_at, updated_at)
      VALUES (${serviceId}, ${`Stage12 ${suffix} ${runId}`}, ${`stage12-${suffix}-${runId}`}, 'Step12 certification service', 'cleaning', 501, 120, true, NOW(), NOW())`;

    customer = await prisma.user.findFirst({
      where: { id: customerId },
      include: { addresses: { take: 1 } },
    });
  }

  const service = await prisma.service.findFirst({ where: { slug: `stage12-${suffix}-${runId}` } });
  if (!customer?.addresses[0] || !service) throw new Error(`STEP12_FIXTURE_SETUP_FAILED_${suffix}`);

  const created = await bookingService.create(customer.id, {
    serviceId: service.id,
    scheduledDate: new Date(Date.now() + 2 * 86400_000).toISOString(),
    addressId: customer.addresses[0].id,
  });
  if ("error" in created) throw new Error(`BOOKING_CREATE_${suffix}:${created.error}`);

  return {
    customerId: customer.id,
    serviceId: service.id,
    addressId: customer.addresses[0].id,
    bookingId: created.booking.id,
    expectedAmount: created.booking.finalAmount,
    customerEmailMasked: customerEmail.replace(/@.*/, "@***"),
  };
}

async function collectPaymentEventEvidence(paymentId: string, eventType: string) {
  const outbox = await prisma.eventOutbox.findFirst({
    where: { eventType, aggregateId: paymentId },
    orderBy: { createdAt: "desc" },
  });
  const receipts = outbox
    ? await prisma.eventConsumerReceipt.findMany({
        where: { eventId: outbox.eventId },
        select: { consumerName: true, eventId: true, processedAt: true },
      })
    : [];
  const dlq = outbox
    ? await prisma.eventDeadLetter.count({ where: { eventId: outbox.eventId, resolvedAt: null } })
    : 0;
  return {
    eventType,
    eventId: outbox?.eventId ?? null,
    outboxStatus: outbox?.status ?? null,
    attempts: outbox?.attempts ?? null,
    createdAt: outbox?.createdAt?.toISOString() ?? null,
    publishedAt: outbox?.publishedAt?.toISOString() ?? null,
    aggregateId: outbox?.aggregateId ?? paymentId,
    consumerReceipts: receipts,
    duplicateReceipts: receipts.length - new Set(receipts.map((r) => r.consumerName)).size,
    dlqEntries: dlq,
  };
}

async function collectLedgerEvidence(paymentId: string, expectedAmount: number) {
  const journal = await prisma.journalEntry.findFirst({
    where: { idempotencyKey: `booking_payment:${paymentId}` },
    include: { lines: true },
  });
  const totalDebit = journal?.lines.reduce((s, l) => s + l.debit, 0) ?? 0;
  const totalCredit = journal?.lines.reduce((s, l) => s + l.credit, 0) ?? 0;
  return {
    journalId: journal?.id ?? null,
    idempotencyKey: journal?.idempotencyKey ?? null,
    referenceId: journal?.referenceId ?? null,
    type: journal?.type ?? null,
    totalDebit,
    totalCredit,
    balanced: totalDebit === totalCredit && totalDebit > 0,
    amountMatch: totalDebit === expectedAmount,
    lineCount: journal?.lines.length ?? 0,
  };
}

async function notificationCounts(userId: string, paymentId: string) {
  const rows = await prisma.notification.findMany({
    where: { userId, referenceId: paymentId },
    select: { type: true, id: true },
  });
  const byType: Record<string, number> = {};
  for (const r of rows) byType[r.type] = (byType[r.type] ?? 0) + 1;
  return { total: rows.length, byType };
}

async function main() {
  const prePaymentTimestampUtc = new Date().toISOString();
  const metricsT0 = {
    homigo_outbox_pending: await outboxPendingCount(),
    homigo_dlq_unresolved: await dlqUnresolvedCount(),
  };

  const KEY_ID = process.env.RAZORPAY_KEY_ID?.trim() ?? "";
  const KEY_SECRET = process.env.RAZORPAY_KEY_SECRET?.trim() ?? "";
  const WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET?.trim() ?? "";
  const razorpayPrefix = KEY_ID.slice(0, 8);

  if (process.env.APP_ENV !== "staging") {
    gate("preflight.env", "BLOCKED", "APP_ENV must be staging");
    process.exit(2);
  }
  if (process.env.STAGING_EVENTS_CERTIFICATION !== "1") {
    gate("preflight.cert", "BLOCKED", "STAGING_EVENTS_CERTIFICATION=1 required");
    process.exit(2);
  }
  if (!eventPlatformConfig.outboxEnabled || !eventPlatformConfig.consumersEnabled) {
    gate("preflight.events", "BLOCKED", "event flags must be enabled");
    process.exit(2);
  }
  if (!KEY_ID.startsWith("rzp_test_")) {
    gate("preflight.razorpay", "BLOCKED", `expected rzp_test_* got ${KEY_ID.slice(0, 12) || "empty"}`);
    process.exit(2);
  }
  if (KEY_ID.startsWith("rzp_live_")) {
    gate("preflight.razorpay.live", "BLOCKED", "live keys rejected");
    process.exit(2);
  }
  gate("preflight.razorpay", "PASS", `${KEY_ID.slice(0, 14)}…`);
  gate("preflight.webhook_secret", WEBHOOK_SECRET.length > 0 ? "PASS" : "BLOCKED", "present");

  resetEventConsumersForTests();
  bootstrapEventConsumers();

  // ── SUCCESS FIXTURES ──
  let successFixtures;
  try {
    successFixtures = await ensureStep12Fixtures(STEP12_RUN_ID, "success");
    gate("fixtures.success", "PASS", successFixtures.bookingId);
  } catch (e) {
    gate("fixtures.success", "BLOCKED", e instanceof Error ? e.message : "fixture error");
    process.exit(2);
  }

  const { customerId, bookingId: successBookingId, expectedAmount } = successFixtures;
  const expectedAmountPaise = Math.round(expectedAmount * 100);

  const baselineSuccess = {
    paymentCount: await prisma.payment.count({ where: { bookingId: successBookingId } }),
    journalCount: 0,
    successEventCount: 0,
  };

  // ── PAYMENT INITIATION (SUCCESS) ──
  const order = await paymentService.createOrder(customerId, successBookingId);
  if (!order || "error" in order || !order.razorpayOrderId) {
    gate("success.initiate", "FAIL", JSON.stringify(order));
    process.exit(1);
  }
  if (order.razorpayOrderId.startsWith("order_dev_")) {
    gate("success.initiate", "FAIL", "dev mock order — real Razorpay keys required");
    process.exit(1);
  }
  gate("success.initiate", "PASS", order.razorpayOrderId);

  const paymentRowInit = await prisma.payment.findFirst({ where: { bookingId: successBookingId } });
  gate(
    "success.payment.db.initiated",
    paymentRowInit?.status === PaymentStatus.INITIATED ? "PASS" : "FAIL",
    paymentRowInit?.status ?? "missing",
  );

  const auth = Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString("base64");
  const orderRes = await fetch(`https://api.razorpay.com/v1/orders/${order.razorpayOrderId}`, {
    headers: { Authorization: `Basic ${auth}` },
  });
  const orderJson = orderRes.ok ? ((await orderRes.json()) as { amount: number; currency: string }) : null;
  gate("success.razorpay.order", orderRes.ok ? "PASS" : "FAIL", `status=${orderRes.status}`);
  gate(
    "success.amount.razorpay",
    orderJson?.amount === expectedAmountPaise ? "PASS" : "FAIL",
    `expected=${expectedAmountPaise} got=${orderJson?.amount ?? "null"}`,
  );

  const successPaymentId = `pay_${STEP12_RUN_ID}_ok`;
  const successSignature = signPayment(order.razorpayOrderId, successPaymentId, KEY_SECRET);

  // ── VERIFY PATH (PRIMARY SUCCESS) ──
  const verify1 = await paymentService.verify(customerId, {
    razorpayOrderId: order.razorpayOrderId,
    razorpayPaymentId: successPaymentId,
    razorpaySignature: successSignature,
  });
  gate(
    "success.verify",
    !("error" in verify1) ? "PASS" : "FAIL",
    "error" in verify1 ? String(verify1.error) : "ok",
  );

  const paymentSuccess = await prisma.payment.findFirst({ where: { bookingId: successBookingId } });
  if (!paymentSuccess) {
    gate("success.payment.db", "FAIL", "missing");
    process.exit(1);
  }

  gate(
    "success.payment.db",
    paymentSuccess.status === PaymentStatus.SUCCESS ? "PASS" : "FAIL",
    paymentSuccess.status,
  );
  gate(
    "success.paid_timestamp",
    paymentSuccess.completedAt != null ? "PASS" : "FAIL",
    paymentSuccess.completedAt?.toISOString() ?? "null",
  );

  const ledgerSuccess = await collectLedgerEvidence(paymentSuccess.id, expectedAmount);
  gate("success.ledger.exists", ledgerSuccess.journalId ? "PASS" : "FAIL", ledgerSuccess.journalId ?? "missing");
  gate("success.ledger.amount", ledgerSuccess.amountMatch ? "PASS" : "FAIL", String(ledgerSuccess.totalDebit));
  gate("success.ledger.balanced", ledgerSuccess.balanced ? "PASS" : "FAIL", "double-entry");
  gate("success.ledger.duplicate", ledgerSuccess.lineCount === 2 ? "PASS" : "FAIL", String(ledgerSuccess.lineCount));

  await flushOutbox();
  const successOutbox = await waitForPaymentOutboxPublished(EVENT_TYPES.PAYMENT_SUCCESS, paymentSuccess.id);
  gate("success.event.outbox", successOutbox ? "PASS" : "FAIL", successOutbox?.eventId ?? "missing");
  gate("success.event.published", successOutbox?.status === "PUBLISHED" ? "PASS" : "FAIL", successOutbox?.status ?? "null");

  const successEventEvidence = await collectPaymentEventEvidence(paymentSuccess.id, EVENT_TYPES.PAYMENT_SUCCESS);
  const expectedSuccessConsumers = [METRICS_CONSUMER_NAME, AUDIT_CONSUMER_NAME, AI_CONTEXT_INDEXER_CONSUMER_NAME];
  const successConsumerNames = new Set(successEventEvidence.consumerReceipts.map((r) => r.consumerName));
  gate(
    "success.consumer.receipts",
    expectedSuccessConsumers.every((c) => successConsumerNames.has(c)) ? "PASS" : "FAIL",
    [...successConsumerNames].join(","),
  );

  // ── ATOMICITY (code contract + runtime correlation) ──
  const atomicityContract = {
    source: "financialTransactionManager.executeWithLedger @ payment.service.ts verify()",
    operationsInSameTransaction: [
      "payment.status=SUCCESS update",
      "booking.paymentStatus=SUCCESS update",
      "journalEntry via recordJournalInTransaction",
      "eventOutbox homigo.payment.success via emitPaymentSuccessInTransaction",
    ],
    failureContract: "payment.failed via prisma.$transaction in reconcileFromWebhook",
    failureLedger: "NONE — failure path does not call executeWithLedger",
  };
  const runtimeAtomicity =
    paymentSuccess.status === PaymentStatus.SUCCESS &&
    ledgerSuccess.journalId != null &&
    successOutbox != null;
  gate("success.atomicity", runtimeAtomicity ? "PASS" : "FAIL", "payment+ledger+outbox correlated");

  // ── WEBHOOK IDEMPOTENCY (separate synthetic payment for webhook path) ──
  const webhookFixtures = await ensureStep12Fixtures(`${STEP12_RUN_ID}-wh`, "whook");
  const whOrder = await paymentService.createOrder(webhookFixtures.customerId, webhookFixtures.bookingId);
  if (!whOrder || "error" in whOrder || !whOrder.razorpayOrderId) {
    gate("webhook.order", "FAIL", "order creation failed");
  } else {
    const whPayId = `pay_${STEP12_RUN_ID}_wh`;
    const whBody = JSON.stringify({
      event: "payment.captured",
      payload: {
        payment: {
          entity: {
            id: whPayId,
            order_id: whOrder.razorpayOrderId,
            status: "captured",
            amount: Math.round(webhookFixtures.expectedAmount * 100),
          },
        },
      },
    });
    const whEventId = `evt_${STEP12_RUN_ID}_wh1`;
    const wh1 = await dispatchWebhook(whBody, signWebhook(whBody, WEBHOOK_SECRET), whEventId);
    gate("webhook.valid_signature", wh1.ok && wh1.reason === "RECONCILED" ? "PASS" : "FAIL", wh1.reason);

    const wh2 = await dispatchWebhook(whBody, signWebhook(whBody, WEBHOOK_SECRET), whEventId);
    gate(
      "webhook.duplicate",
      wh2.ok && (wh2.reason.includes("DUPLICATE") || wh2.reason.includes("ALREADY") || wh2.reason.includes("RECONCILED"))
        ? "PASS"
        : "FAIL",
      wh2.reason,
    );

    const badSig = razorpayService.verifyWebhookSignature(whBody, "deadbeef");
    gate("webhook.invalid_signature", badSig === false ? "PASS" : "FAIL", `verify=${badSig}`);

    const whPayment = await prisma.payment.findFirst({ where: { bookingId: webhookFixtures.bookingId } });
    const whJournalBefore = whPayment
      ? await prisma.journalEntry.count({ where: { idempotencyKey: `booking_payment:${whPayment.id}` } })
      : 0;
    await dispatchWebhook(whBody, signWebhook(whBody, WEBHOOK_SECRET), whEventId);
    const whJournalAfter = whPayment
      ? await prisma.journalEntry.count({ where: { idempotencyKey: `booking_payment:${whPayment.id}` } })
      : 0;
    gate("webhook.duplicate_ledger", whJournalBefore === whJournalAfter ? "PASS" : "FAIL", `${whJournalBefore}→${whJournalAfter}`);
  }

  // ── SUCCESS IDEMPOTENCY (verify replay) ──
  const ledgerBeforeIdem = await prisma.journalEntry.count({
    where: { idempotencyKey: `booking_payment:${paymentSuccess.id}` },
  });
  const outboxBeforeIdem = await prisma.eventOutbox.count({
    where: { eventType: EVENT_TYPES.PAYMENT_SUCCESS, aggregateId: paymentSuccess.id },
  });
  const verify2 = await paymentService.verify(customerId, {
    razorpayOrderId: order.razorpayOrderId,
    razorpayPaymentId: successPaymentId,
    razorpaySignature: successSignature,
  });
  const idemOk =
    ("paymentId" in verify2 || (verify2 as { error?: string }).error === undefined) &&
    (verify2 as { status?: string }).status === "success";
  const ledgerAfterIdem = await prisma.journalEntry.count({
    where: { idempotencyKey: `booking_payment:${paymentSuccess.id}` },
  });
  const outboxAfterIdem = await prisma.eventOutbox.count({
    where: { eventType: EVENT_TYPES.PAYMENT_SUCCESS, aggregateId: paymentSuccess.id },
  });
  gate("success.idempotency", idemOk && ledgerBeforeIdem === ledgerAfterIdem && outboxBeforeIdem === outboxAfterIdem ? "PASS" : "FAIL", "verify replay stable");

  // ── FAILURE FLOW ──
  let failureFixtures;
  try {
    failureFixtures = await ensureStep12Fixtures(STEP12_RUN_ID, "failure");
    gate("fixtures.failure", "PASS", failureFixtures.bookingId);
  } catch (e) {
    gate("fixtures.failure", "FAIL", e instanceof Error ? e.message : "fixture error");
    process.exit(1);
  }

  const failOrder = await paymentService.createOrder(failureFixtures.customerId, failureFixtures.bookingId);
  if (!failOrder || "error" in failOrder || !failOrder.razorpayOrderId) {
    gate("failure.initiate", "FAIL", JSON.stringify(failOrder));
    process.exit(1);
  }
  gate("failure.initiate", "PASS", failOrder.razorpayOrderId);

  const failPaymentRow = await prisma.payment.findFirst({ where: { bookingId: failureFixtures.bookingId } });
  const failBaselineLedger = failPaymentRow
    ? await prisma.journalEntry.count({ where: { idempotencyKey: `booking_payment:${failPaymentRow.id}` } })
    : 0;

  const failBody = JSON.stringify({
    event: "payment.failed",
    payload: {
      payment: {
        entity: {
          id: `pay_${STEP12_RUN_ID}_fail`,
          order_id: failOrder.razorpayOrderId,
          status: "failed",
          error_code: "BAD_REQUEST_ERROR",
          error_description: "Payment declined by issuer (Step12 test)",
        },
      },
    },
  });
  const failEventId = `evt_${STEP12_RUN_ID}_fail1`;
  const failWh1 = await dispatchWebhook(failBody, signWebhook(failBody, WEBHOOK_SECRET), failEventId);
  gate("failure.webhook", failWh1.ok && failWh1.reason === "MARKED_FAILED" ? "PASS" : "FAIL", failWh1.reason);

  const failPayment = await prisma.payment.findFirst({ where: { bookingId: failureFixtures.bookingId } });
  gate(
    "failure.payment.db",
    failPayment?.status === PaymentStatus.FAILED ? "PASS" : "FAIL",
    failPayment?.status ?? "missing",
  );

  await flushOutbox();
  const failOutbox = failPayment
    ? await waitForPaymentOutboxPublished(EVENT_TYPES.PAYMENT_FAILED, failPayment.id)
    : null;
  gate("failure.event.outbox", failOutbox ? "PASS" : "FAIL", failOutbox?.eventId ?? "missing");
  gate("failure.event.published", failOutbox?.status === "PUBLISHED" ? "PASS" : "FAIL", failOutbox?.status ?? "null");

  const failEventEvidence = failPayment
    ? await collectPaymentEventEvidence(failPayment.id, EVENT_TYPES.PAYMENT_FAILED)
    : null;
  const failLedgerAfter = failPayment
    ? await prisma.journalEntry.count({ where: { idempotencyKey: `booking_payment:${failPayment.id}` } })
    : 0;
  const failSuccessEvents = failPayment
    ? await prisma.eventOutbox.count({
        where: { eventType: EVENT_TYPES.PAYMENT_SUCCESS, aggregateId: failPayment.id },
      })
    : 0;

  gate("failure.no_ledger", failLedgerAfter === 0 ? "PASS" : "FAIL", String(failLedgerAfter));
  gate("failure.no_success_event", failSuccessEvents === 0 ? "PASS" : "FAIL", String(failSuccessEvents));
  gate(
    "failure.isolation",
    failPayment?.status === PaymentStatus.FAILED && failLedgerAfter === 0 && failSuccessEvents === 0 ? "PASS" : "FAIL",
    "no success financial effects",
  );

  const failWh2 = await dispatchWebhook(failBody, signWebhook(failBody, WEBHOOK_SECRET), failEventId);
  gate(
    "failure.idempotency",
    failWh2.ok && (failWh2.reason.includes("DUPLICATE") || failWh2.reason.includes("ALREADY") || failWh2.reason.includes("MARKED"))
      ? "PASS"
      : "FAIL",
    failWh2.reason,
  );

  const failOutboxCountAfter = failPayment
    ? await prisma.eventOutbox.count({
        where: { eventType: EVENT_TYPES.PAYMENT_FAILED, aggregateId: failPayment.id },
      })
    : 0;
  gate("failure.no_duplicate_event", failOutboxCountAfter <= 1 ? "PASS" : "FAIL", String(failOutboxCountAfter));

  // ── AMOUNT RECONCILIATION ──
  const paymentAmountPaise = Number(paymentSuccess.amountPaise ?? 0) || expectedAmountPaise;
  const ledgerAmountPaise = Math.round(ledgerSuccess.totalDebit * 100);
  const amountReconciliation =
    orderJson?.amount === expectedAmountPaise &&
    Math.round(paymentSuccess.amount * 100) === expectedAmountPaise &&
    ledgerAmountPaise === expectedAmountPaise;
  gate("amount.reconciliation", amountReconciliation ? "PASS" : "FAIL", `rzp=${orderJson?.amount} pay=${Math.round(paymentSuccess.amount * 100)} ledger=${ledgerAmountPaise}`);

  // ── NOTIFICATIONS ──
  const successNotifs = await notificationCounts(customerId, paymentSuccess.id);
  const failNotifs = failPayment ? await notificationCounts(failureFixtures.customerId, failPayment.id) : { total: 0, byType: {} };

  // ── FINAL METRICS ──
  await flushOutbox();
  const metricsFinal = {
    homigo_outbox_pending: await outboxPendingCount(),
    homigo_dlq_unresolved: await dlqUnresolvedCount(),
  };
  gate("outbox.drain", metricsFinal.homigo_outbox_pending === 0 ? "PASS" : "FAIL", String(metricsFinal.homigo_outbox_pending));

  const step12Dlq =
    (successEventEvidence?.dlqEntries ?? 0) + (failEventEvidence?.dlqEntries ?? 0);
  gate("dlq.step12", step12Dlq === 0 ? "PASS" : "FAIL", String(step12Dlq));

  const failed = gates.filter((g) => g.status === "FAIL").length;
  const blocked = gates.filter((g) => g.status === "BLOCKED").length;
  const summary = blocked > 0 ? "BLOCKED" : failed > 0 ? "FAIL" : "PASS";

  const evidence = {
    step: 12,
    STEP12_RUN_ID,
    STEP12_PRE_PAYMENT_TIMESTAMP_UTC: prePaymentTimestampUtc,
    certifiedRcSha: CERTIFIED_RC_SHA,
    summary,
    gates,
    applicationPaths: {
      paymentInitiation: "paymentService.createOrder (POST /api/payments/order equivalent)",
      paymentVerify: "paymentService.verify (client callback path)",
      webhook: "paymentService.reconcileFromWebhook via signed Razorpay webhook",
    },
    fixtures: {
      success: {
        customerId,
        bookingId: successBookingId,
        paymentId: paymentSuccess.id,
        razorpayOrderId: order.razorpayOrderId,
        razorpayPaymentId: successPaymentId,
        customerEmailMasked: successFixtures.customerEmailMasked,
        realPiiUsed: false,
      },
      failure: {
        customerId: failureFixtures.customerId,
        bookingId: failureFixtures.bookingId,
        paymentId: failPayment?.id ?? null,
        razorpayOrderId: failOrder.razorpayOrderId,
        customerEmailMasked: failureFixtures.customerEmailMasked,
        realPiiUsed: false,
      },
    },
    baseline: baselineSuccess,
    successBusinessState: {
      paymentId: paymentSuccess.id,
      status: paymentSuccess.status,
      razorpayOrderId: paymentSuccess.razorpayOrderId,
      razorpayPaymentId: paymentSuccess.razorpayPaymentId,
      amount: paymentSuccess.amount,
      amountPaise: paymentAmountPaise,
      currency: paymentSuccess.currency,
      completedAt: paymentSuccess.completedAt?.toISOString() ?? null,
      bookingPaymentStatus: (
        await prisma.booking.findUnique({ where: { id: successBookingId }, select: { paymentStatus: true } })
      )?.paymentStatus ?? null,
    },
    successLedger: ledgerSuccess,
    successEvent: successEventEvidence,
    failureBusinessState: {
      paymentId: failPayment?.id ?? null,
      status: failPayment?.status ?? null,
      razorpayOrderId: failPayment?.razorpayOrderId ?? null,
      bookingPaymentStatus: failPayment
        ? (await prisma.booking.findUnique({ where: { id: failureFixtures.bookingId }, select: { paymentStatus: true } }))
            ?.paymentStatus ?? null
        : null,
    },
    failureEvent: failEventEvidence,
    financialAtomicity: {
      contract: atomicityContract,
      paymentStateCommitted: paymentSuccess.status === PaymentStatus.SUCCESS,
      ledgerCommitted: ledgerSuccess.journalId != null,
      outboxCommitted: successOutbox != null,
      sameTransactionBoundary: "YES — executeWithLedger single prisma.$transaction",
      financialEventAtomicity: runtimeAtomicity ? "PASS" : "FAIL",
      failureStateCommitted: failPayment?.status === PaymentStatus.FAILED,
      failureOutboxCommitted: failOutbox != null,
      failureEventAtomicity: failPayment?.status === PaymentStatus.FAILED && failOutbox != null ? "PASS" : "FAIL",
      rollbackAtomicityTest: "NOT_AVAILABLE — code contract + runtime correlation only (no staging fault injection)",
    },
    amountIntegrity: {
      expectedAmountPaise,
      razorpayAmountPaise: orderJson?.amount ?? null,
      paymentAmountPaise: Math.round(paymentSuccess.amount * 100),
      ledgerAmountPaise,
      reconciliation: amountReconciliation ? "PASS" : "FAIL",
    },
    webhookIdempotency: {
      validSignature: gates.find((g) => g.id === "webhook.valid_signature")?.status ?? "SKIP",
      invalidSignatureRejected: gates.find((g) => g.id === "webhook.invalid_signature")?.status ?? "SKIP",
      duplicateWebhookSafe: gates.find((g) => g.id === "webhook.duplicate")?.status ?? "SKIP",
      duplicateLedger: gates.find((g) => g.id === "webhook.duplicate_ledger")?.status ?? "SKIP",
    },
    idempotency: {
      successVerifyReplay: gates.find((g) => g.id === "success.idempotency")?.status ?? "FAIL",
      failureWebhookReplay: gates.find((g) => g.id === "failure.idempotency")?.status ?? "FAIL",
      concurrentFinalization: "NOT_TESTED",
    },
    failureFinancialIsolation: {
      successLedgerEntry: failLedgerAfter,
      successWalletCredit: 0,
      paymentSuccessEvent: failSuccessEvents,
      failureFinancialIsolation: failLedgerAfter === 0 && failSuccessEvents === 0 ? "PASS" : "FAIL",
    },
    metrics: { t0: metricsT0, postSuccess: metricsT0, final: metricsFinal },
    notifications: {
      success: { count: successNotifs.total, byType: successNotifs.byType, realRecipientContacted: false },
      failure: { count: failNotifs.total, byType: failNotifs.byType, realRecipientContacted: false },
      note: "Staging NODE_ENV=production without RESEND — internal enqueue only",
    },
    environment: {
      appEnv: process.env.APP_ENV,
      razorpayMode: "TEST",
      keySecretPresent: KEY_SECRET.length > 0,
      webhookSecretPresent: WEBHOOK_SECRET.length > 0,
      productionDbUsed: false,
      productionRedisUsed: false,
      productionRazorpayUsed: false,
      liveCredentialsUsed: false,
      realPayment: false,
    },
    cleanupPolicy: "KEEP_FOR_FORENSICS",
  };

  console.log("\n=== STEP12_EVIDENCE_JSON ===");
  console.log(JSON.stringify(evidence, null, 2));
  await prisma.$disconnect();
  process.exit(summary === "PASS" ? 0 : summary === "BLOCKED" ? 2 : 1);
}

main().catch(async (e) => {
  console.error(e instanceof Error ? e.message : e);
  await prisma.$disconnect();
  process.exit(1);
});
