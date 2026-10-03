import { describe, expect, test, beforeAll } from "bun:test";
import prisma from "../../lib/prisma";
import { buildBookingCreatedEvent } from "../catalog/booking.events";
import { emitInTransaction } from "../core/event-publisher";
import { dispatchEvent } from "../core/event-bus";
import { clearConsumersForTests, registerConsumer } from "../core/consumer-registry";

const HAS_DB = Boolean(process.env.DATABASE_URL);

async function eventTablesReady(): Promise<boolean> {
  if (!HAS_DB) return false;
  try {
    await prisma.$queryRaw`SELECT 1 FROM event_outbox LIMIT 1`;
    return true;
  } catch {
    return false;
  }
}

describe.skipIf(!HAS_DB)("event integration (requires migrated DB)", () => {
  let ready = false;
  beforeAll(async () => {
    ready = await eventTablesReady();
  });

  test("Scenario B/C — outbox row persists atomically in transaction", async () => {
    if (!ready) return;
    const event = buildBookingCreatedEvent({
      bookingId: `bk_int_${Date.now()}`,
      bookingNumber: `HG-INT-${Date.now()}`,
      userId: "integration_user",
      serviceId: "integration_service",
      serviceCategory: "cleaning",
      city: "Delhi",
      providerId: null,
      status: "PENDING",
      finalAmount: 100,
      paymentMethod: "razorpay",
      scheduledAt: new Date(),
    });

    await expect(
      prisma.$transaction(async (tx) => {
        await emitInTransaction(tx, event);
        throw new Error("ROLLBACK_TEST");
      }),
    ).rejects.toThrow("ROLLBACK_TEST");

    const row = await prisma.eventOutbox.findFirst({ where: { eventId: event.id } });
    expect(row).toBeNull();
  });

  test("Scenario C — committed outbox survives for later publish", async () => {
    if (!ready) return;
    const event = buildBookingCreatedEvent({
      bookingId: `bk_commit_${Date.now()}`,
      bookingNumber: `HG-C-${Date.now()}`,
      userId: "integration_user",
      serviceId: "integration_service",
      serviceCategory: "cleaning",
      city: "Delhi",
      providerId: null,
      status: "PENDING",
      finalAmount: 100,
      paymentMethod: "razorpay",
      scheduledAt: new Date(),
    });

    await prisma.$transaction(async (tx) => {
      await emitInTransaction(tx, event);
    });

    const row = await prisma.eventOutbox.findUnique({ where: { eventId: event.id } });
    expect(row?.status).toBe("PENDING");

    await prisma.eventOutbox.delete({ where: { eventId: event.id } }).catch(() => undefined);
  });

  // ── P0-4: real-DB proof that the normal DLQ path is unchanged by the event-bus fix ──
  test("P0-4 regression — real consumer failure writes a real EventDeadLetter row and receipt", async () => {
    if (!ready) return;
    clearConsumersForTests();
    registerConsumer({
      name: "test.p0-4-real-dlq",
      eventTypes: ["homigo.booking.created"],
      handler: async () => { throw new Error("real consumer failure"); },
      maxAttempts: 1,
    });

    const event = buildBookingCreatedEvent({
      bookingId: `bk_p04_${Date.now()}`,
      bookingNumber: `HG-P04-${Date.now()}`,
      userId: "integration_user",
      serviceId: "integration_service",
      serviceCategory: "cleaning",
      city: "Delhi",
      providerId: null,
      status: "PENDING",
      finalAmount: 100,
      paymentMethod: "razorpay",
      scheduledAt: new Date(),
    });

    await dispatchEvent(event);

    const dlqRow = await prisma.eventDeadLetter.findFirst({
      where: { eventId: event.id, consumerName: "test.p0-4-real-dlq" },
    });
    expect(dlqRow).not.toBeNull();
    expect(dlqRow?.error).toContain("real consumer failure");

    const receipt = await prisma.eventConsumerReceipt.findUnique({
      where: { consumerName_eventId: { consumerName: "test.p0-4-real-dlq", eventId: event.id } },
    });
    expect(receipt?.result).toBe("skipped");
    expect(receipt?.errorMessage).toStartWith("dlq:");

    await prisma.eventDeadLetter.deleteMany({ where: { eventId: event.id } });
    await prisma.eventConsumerReceipt.deleteMany({ where: { eventId: event.id } });
    clearConsumersForTests();
  });
});
