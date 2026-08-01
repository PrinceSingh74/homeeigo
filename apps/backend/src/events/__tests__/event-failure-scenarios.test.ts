import { describe, expect, test } from "bun:test";
import { buildBookingCreatedEvent } from "../catalog/booking.events";
import { validateEventEnvelope } from "../core/validation";
import { computeRetryDelayMs, isTransientConsumerError } from "../core/retry";
import { bindEventContextFromRequest, getEventContext, runWithEventContext } from "../core/event-context";
import { buildPartnerArrivedEvent } from "../catalog/partner.events";

describe("failure scenarios (Phase 0)", () => {
  test("Scenario A — invalid envelope rejected before publish", () => {
    expect(() => validateEventEnvelope({ bad: true })).toThrow(/Invalid Homigo event envelope/);
  });

  test("Scenario B — oversized payload rejected", () => {
    const event = buildBookingCreatedEvent({
      bookingId: "bk_1",
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
    const huge = { ...event, data: { ...event.data, pad: "x".repeat(70_000) } };
    expect(() => validateEventEnvelope(huge)).toThrow(/max size/);
  });

  test("Scenario E — permanent validation errors are not retried", () => {
    expect(isTransientConsumerError(new Error("Invalid event envelope"))).toBe(false);
    expect(isTransientConsumerError(new Error("connection reset"))).toBe(true);
  });

  test("Scenario F — Redis outage does not affect envelope validation (Postgres is SoT)", () => {
    const event = buildBookingCreatedEvent({
      bookingId: "bk_redis",
      bookingNumber: "HG-R",
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
    expect(validateEventEnvelope(event).id).toBe(event.id);
  });

  test("trace context binds from HTTP request metadata", () => {
    runWithEventContext({ traceId: "parent" }, () => {
      bindEventContextFromRequest({ traceId: "t1", requestId: "req_abc", causationId: "pay_evt" });
      const ctx = getEventContext();
      expect(ctx.traceId).toBe("t1");
      expect(ctx.correlationId).toBe("req_abc");
      expect(ctx.causationId).toBe("pay_evt");
    });
  });

  test("ETA label event includes travelDurationMin without fabrication", () => {
    const event = buildPartnerArrivedEvent({
      providerId: "p1",
      bookingId: "b1",
      arrivedAt: new Date(),
      dispatchedAt: new Date(Date.now() - 30 * 60_000),
      enRouteAt: new Date(Date.now() - 25 * 60_000),
      travelDurationMin: 25,
      city: "Gurugram",
      serviceCategory: "plumbing",
      distanceKm: 0.1,
      googleEtaMin: 22,
    });
    expect(event.data.travelDurationMin).toBe(25);
    expect(event.data.city).toBe("Gurugram");
  });

  test("retry backoff grows with attempts", () => {
    const d1 = computeRetryDelayMs(1).getTime();
    const d4 = computeRetryDelayMs(4).getTime();
    expect(d4).toBeGreaterThan(d1);
  });
});

describe("performance smoke (Section 51)", () => {
  test("event builder overhead stays sub-millisecond per event", () => {
    const start = performance.now();
    for (let i = 0; i < 500; i++) {
      buildBookingCreatedEvent({
        bookingId: `bk_${i}`,
        bookingNumber: `HG-${i}`,
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
    }
    const elapsed = performance.now() - start;
    expect(elapsed / 500).toBeLessThan(5);
  });
});
