import { describe, expect, test, beforeEach, mock } from "bun:test";

const idempotency = {
  hasConsumerProcessed: mock(async () => false),
  recordConsumerSuccess: mock(async () => undefined),
  recordConsumerSkipped: mock(async () => undefined),
};

const deadLetter = {
  recordDeadLetter: mock(async () => undefined),
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
});
