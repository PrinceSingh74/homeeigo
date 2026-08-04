/** Stage D Phase 3-7: consumers, idempotency, DLQ replay (in-process consumers in job). */
import prisma from "/app/src/lib/prisma.ts";
import { emitInTransaction } from "/app/src/events/core/event-publisher.ts";
import { buildBookingCreatedEvent } from "/app/src/events/catalog/booking.events.ts";
import { processOutboxBatch } from "/app/src/events/core/outbox-processor.ts";
import { dispatchEvent } from "/app/src/events/core/event-bus.ts";
import { bootstrapEventConsumers, resetEventConsumersForTests } from "/app/src/events/consumers/index.ts";
import { clearConsumersForTests, registerConsumer } from "/app/src/events/core/consumer-registry.ts";
import { replayDeadLetterById } from "/app/src/events/core/replay.ts";

const tag = `sd_full_${Date.now()}`;
const gates: { id: string; status: string; detail: string }[] = [];
const push = (id: string, ok: boolean, detail: string) =>
  gates.push({ id, status: ok ? "PASS" : "FAIL", detail });

process.env.EVENTS_OUTBOX_ENABLED = "true";
process.env.EVENTS_CONSUMERS_ENABLED = "true";

async function fixtures() {
  type Row = { user_id: string; service_id: string; city: string; category: string };
  const rows = await prisma.$queryRaw<Row[]>`
    SELECT u.id AS user_id, s.id AS service_id, 'Delhi' AS city, s.category
    FROM users u CROSS JOIN services s
    WHERE u.email = 'stage-d-customer@homigo-staging.test' AND s.slug = 'stage-d-deep-cleaning' LIMIT 1`;
  return rows[0];
}

async function main() {
  push("preflight", process.env.STAGING_EVENTS_CERTIFICATION === "1", "cert mode");
  const fx = await fixtures();
  if (!fx) {
    push("fixtures", false, "run seed first");
    console.log(JSON.stringify({ tag, gates, summary: "BLOCKED" }, null, 2));
    process.exit(2);
  }
  push("fixtures", true, fx.user_id);

  resetEventConsumersForTests();
  bootstrapEventConsumers();

  const ev = buildBookingCreatedEvent({
    bookingId: `${tag}_bk`,
    bookingNumber: `HG-${tag}`,
    userId: fx.user_id,
    serviceId: fx.service_id,
    serviceCategory: fx.category,
    city: fx.city,
    providerId: null,
    status: "PENDING",
    finalAmount: 500,
    paymentMethod: "razorpay",
    scheduledAt: new Date(),
  });
  await prisma.$transaction(async (tx) => emitInTransaction(tx, ev));
  await processOutboxBatch();
  const pub = await prisma.eventOutbox.findUnique({ where: { eventId: ev.id } });
  const receipts = await prisma.eventConsumerReceipt.count({ where: { eventId: ev.id } });
  push("outbox+consumers", pub?.status === "PUBLISHED" && receipts > 0, `status=${pub?.status} receipts=${receipts}`);

  const before = receipts;
  if (pub) await dispatchEvent(pub.payload as object);
  const after = await prisma.eventConsumerReceipt.count({ where: { eventId: ev.id } });
  push("idempotency", after === before, `${before} -> ${after}`);

  clearConsumersForTests();
  registerConsumer({
    name: "stage-d.fail.v1",
    eventTypes: ["homigo.booking.created"],
    handler: async () => {
      throw new Error("stage_d_fail");
    },
    maxAttempts: 1,
  });
  const failEv = buildBookingCreatedEvent({
    bookingId: `${tag}_dlq`,
    bookingNumber: `HG-${tag}-D`,
    userId: fx.user_id,
    serviceId: fx.service_id,
    serviceCategory: fx.category,
    city: fx.city,
    providerId: null,
    status: "PENDING",
    finalAmount: 500,
    paymentMethod: "razorpay",
    scheduledAt: new Date(),
  });
  await prisma.$transaction(async (tx) => emitInTransaction(tx, failEv));
  await processOutboxBatch();
  const dlq = await prisma.eventDeadLetter.findFirst({
    where: { eventId: failEv.id, consumerName: "stage-d.fail.v1" },
  });
  push("dlq", Boolean(dlq), dlq?.id ?? "none");

  if (dlq) {
    clearConsumersForTests();
    registerConsumer({
      name: "stage-d.fail.v1",
      eventTypes: ["homigo.booking.created"],
      handler: async () => undefined,
      maxAttempts: 1,
    });
    await prisma.eventConsumerReceipt.deleteMany({
      where: { consumerName: "stage-d.fail.v1", eventId: failEv.id },
    });
    const replay = await replayDeadLetterById(dlq.id);
    push("dlq.replay", replay.replayed, replay.reason);
  }

  const failed = gates.filter((g) => g.status === "FAIL").length;
  console.log(JSON.stringify({ tag, phase: "consumers-dlq-idempotency", gates, summary: failed ? "FAIL" : "PASS" }, null, 2));
  await prisma.$disconnect();
  process.exit(failed ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
