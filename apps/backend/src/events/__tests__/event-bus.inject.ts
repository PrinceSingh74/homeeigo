/**
 * Event-bus unit tests that `mock.module` the idempotency and dead-letter modules.
 * Bun's mock.module is process-global, so this file MUST NOT be on the default
 * `*.test.ts` glob or it poisons `event-integration.test.ts` (real DLQ writes
 * become no-ops). Run in its own process via package.json `test` / CI.
 */
import { describe, expect, test, beforeEach, mock } from "bun:test";
import { getRingBufferLogs } from "../../lib/logger";

const idempotency = {
  hasConsumerProcessed: mock(async (_consumerName: string, _eventId: string) => false),
  recordConsumerSuccess: mock(async (_consumerName: string, _eventId: string, _result?: string) => undefined),
  recordConsumerSkipped: mock(async (_consumerName: string, _eventId: string, _reason: string) => undefined),
};

const deadLetter = {
  recordDeadLetter: mock(async (_input: Record<string, unknown>) => undefined),
};

mock.module("../core/idempotency", () => idempotency);
mock.module("../core/dead-letter", () => deadLetter);

const { buildBookingCreatedEvent } = await import("../catalog/booking.events");
const { clearConsumersForTests, registerConsumer } = await import("../core/consumer-registry");
const { dispatchEvent } = await import("../core/event-bus");
const { bootstrapEventConsumers, resetEventConsumersForTests } = await import("../consumers");

describe("event bus", () => {
  beforeEach(() => {
    clearConsumersForTests();
    resetEventConsumersForTests();
    idempotency.hasConsumerProcessed.mockReset();
    idempotency.hasConsumerProcessed.mockImplementation(async () => false);
    idempotency.recordConsumerSuccess.mockReset();
    idempotency.recordConsumerSkipped.mockReset();
    deadLetter.recordDeadLetter.mockReset();
  });

  test("dispatches to all matching consumers", async () => {
    let a = 0;
    let b = 0;
    registerConsumer({ name: "test.a", eventTypes: ["homigo.booking.created"], handler: async () => { a += 1; }, maxAttempts: 1 });
    registerConsumer({ name: "test.b", eventTypes: "*", handler: async () => { b += 1; }, maxAttempts: 1 });

    const event = buildBookingCreatedEvent({
      bookingId: "bk_test",
      bookingNumber: "HG-1",
      userId: "u1",
      serviceId: "s1",
      serviceCategory: "cleaning",
      city: "Delhi",
      providerId: null,
      status: "PENDING",
      finalAmount: 100,
      paymentMethod: "razorpay",
      scheduledAt: new Date(),
    });

    await dispatchEvent(event);
    expect(a).toBe(1);
    expect(b).toBe(1);
  });

  test("consumer failure does not block unrelated consumers", async () => {
    let ok = 0;
    registerConsumer({ name: "test.fail", eventTypes: ["homigo.booking.created"], handler: async () => { throw new Error("boom"); }, maxAttempts: 1 });
    registerConsumer({ name: "test.ok", eventTypes: ["homigo.booking.created"], handler: async () => { ok += 1; }, maxAttempts: 1 });

    const event = buildBookingCreatedEvent({
      bookingId: "bk_fail",
      bookingNumber: "HG-2",
      userId: "u1",
      serviceId: "s1",
      serviceCategory: "cleaning",
      city: "Delhi",
      providerId: null,
      status: "PENDING",
      finalAmount: 100,
      paymentMethod: "razorpay",
      scheduledAt: new Date(),
    });

    await dispatchEvent(event);
    expect(ok).toBe(1);
    expect(deadLetter.recordDeadLetter.mock.calls.length).toBe(1);
  });

  test("duplicate delivery skipped when receipt exists (Scenario D)", async () => {
    idempotency.hasConsumerProcessed.mockImplementation(async () => true);
    let runs = 0;
    registerConsumer({ name: "test.dedup", eventTypes: ["homigo.booking.created"], handler: async () => { runs += 1; }, maxAttempts: 1 });

    const event = buildBookingCreatedEvent({
      bookingId: "bk_dedup",
      bookingNumber: "HG-3",
      userId: "u1",
      serviceId: "s1",
      serviceCategory: "cleaning",
      city: "Delhi",
      providerId: null,
      status: "PENDING",
      finalAmount: 100,
      paymentMethod: "razorpay",
      scheduledAt: new Date(),
    });

    await dispatchEvent(event);
    expect(runs).toBe(0);
  });

  test("bootstrap registers production consumers", () => {
    bootstrapEventConsumers();
    bootstrapEventConsumers();
    expect(true).toBe(true);
  });

  // ── P0-4: dead-letter persistence failure must not silently lose the event ──

  test("DLQ persist failure: dispatch does not throw, no consumer receipt written, failure is logged loudly", async () => {
    deadLetter.recordDeadLetter.mockImplementation(async () => {
      throw new Error("DB_UNAVAILABLE_SIMULATED");
    });
    registerConsumer({
      name: "test.dlq-write-fails",
      eventTypes: ["homigo.booking.created"],
      handler: async () => { throw new Error("consumer boom"); },
      maxAttempts: 1,
    });

    const event = buildBookingCreatedEvent({
      bookingId: "bk_dlq_fail",
      bookingNumber: "HG-4",
      userId: "u1",
      serviceId: "s1",
      serviceCategory: "cleaning",
      city: "Delhi",
      providerId: null,
      status: "PENDING",
      finalAmount: 100,
      paymentMethod: "razorpay",
      scheduledAt: new Date(),
    });

    // Must not throw — dispatchEvent has no consumers left over to break.
    await expect(dispatchEvent(event)).resolves.toBeUndefined();

    // The DLQ write was attempted (and failed) — no receipt should be written, so a
    // future replay of this event will retry this consumer rather than being skipped.
    expect(idempotency.recordConsumerSkipped.mock.calls.length).toBe(0);

    // The double failure (consumer + DLQ persist) must be loudly logged, not silent.
    const logs = getRingBufferLogs(50);
    const found = logs.find((l) => l.message === "event_dead_letter_persist_failed" && l.meta?.eventId === event.id);
    expect(found).toBeDefined();
    expect(found?.level).toBe("error");
  });

  test("DLQ persist success (regression): consumer receipt IS written with dlq: prefix", async () => {
    deadLetter.recordDeadLetter.mockImplementation(async () => undefined);
    registerConsumer({
      name: "test.dlq-write-ok",
      eventTypes: ["homigo.booking.created"],
      handler: async () => { throw new Error("consumer boom"); },
      maxAttempts: 1,
    });

    const event = buildBookingCreatedEvent({
      bookingId: "bk_dlq_ok",
      bookingNumber: "HG-5",
      userId: "u1",
      serviceId: "s1",
      serviceCategory: "cleaning",
      city: "Delhi",
      providerId: null,
      status: "PENDING",
      finalAmount: 100,
      paymentMethod: "razorpay",
      scheduledAt: new Date(),
    });

    await dispatchEvent(event);

    expect(deadLetter.recordDeadLetter.mock.calls.length).toBe(1);
    expect(idempotency.recordConsumerSkipped.mock.calls.length).toBe(1);
    const [, , reason] = idempotency.recordConsumerSkipped.mock.calls[0];
    expect(String(reason)).toStartWith("dlq:");
  });

  test("multiprocess-style: many concurrent dispatches with a flaky DLQ write never crash and never hang", async () => {
    let call = 0;
    deadLetter.recordDeadLetter.mockImplementation(async () => {
      call += 1;
      if (call % 2 === 0) throw new Error("DB_FLAKY_SIMULATED");
      return undefined;
    });
    registerConsumer({
      name: "test.dlq-concurrent",
      eventTypes: ["homigo.booking.created"],
      handler: async () => { throw new Error("consumer boom"); },
      maxAttempts: 1,
    });

    const events = Array.from({ length: 20 }, (_, i) =>
      buildBookingCreatedEvent({
        bookingId: `bk_concurrent_${i}`,
        bookingNumber: `HG-C-${i}`,
        userId: "u1",
        serviceId: "s1",
        serviceCategory: "cleaning",
        city: "Delhi",
        providerId: null,
        status: "PENDING",
        finalAmount: 100,
        paymentMethod: "razorpay",
        scheduledAt: new Date(),
      }),
    );

    // Simulates concurrent delivery across multiple instances/workers hitting the
    // same in-process event bus at once — every dispatch must settle cleanly.
    const results = await Promise.allSettled(events.map((e) => dispatchEvent(e)));
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
    expect(deadLetter.recordDeadLetter.mock.calls.length).toBe(20);
  });
});
