/**
 * Phase 5 — verify payment idempotency keys and webhook dedup schema.
 * Usage: bun --env-file=.env run scripts/verify-payment-idempotency.ts
 */
import "../src/load-env";
import prisma from "../src/lib/prisma";

async function main() {
  const dupPayments = await prisma.$queryRaw<{ cnt: bigint }[]>`
    SELECT COUNT(*)::bigint AS cnt FROM (
      SELECT idempotency_key FROM payments GROUP BY idempotency_key HAVING COUNT(*) > 1
    ) t
  `;

  const dupWebhooks = await prisma.$queryRaw<{ cnt: bigint }[]>`
    SELECT COUNT(*)::bigint AS cnt FROM (
      SELECT event_id FROM webhook_event_dedup GROUP BY event_id HAVING COUNT(*) > 1
    ) t
  `;

  const missingKey = await prisma.$queryRaw<{ cnt: bigint }[]>`
    SELECT COUNT(*)::bigint AS cnt FROM payments WHERE idempotency_key IS NULL OR idempotency_key = ''
  `;
  const paymentsWithoutKey = Number(missingKey[0]?.cnt ?? 0);
  const razorpayConfigured = Boolean(
    process.env.RAZORPAY_KEY_ID?.trim() && process.env.RAZORPAY_KEY_SECRET?.trim(),
  );

  const report = {
    duplicateIdempotencyKeys: Number(dupPayments[0]?.cnt ?? 0),
    duplicateWebhookEvents: Number(dupWebhooks[0]?.cnt ?? 0),
    paymentsWithoutIdempotencyKey: paymentsWithoutKey,
    razorpayConfigured,
    paymentCount: await prisma.payment.count(),
    pass:
      Number(dupPayments[0]?.cnt ?? 0) === 0 &&
      Number(dupWebhooks[0]?.cnt ?? 0) === 0 &&
      paymentsWithoutKey === 0,
  };

  console.log(JSON.stringify(report, null, 2));
  if (!report.pass) process.exit(1);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
