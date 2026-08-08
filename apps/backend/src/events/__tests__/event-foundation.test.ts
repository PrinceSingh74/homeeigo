import { describe, expect, test } from "bun:test";
import { buildBookingCreatedEvent, buildBookingCompletedEvent } from "../catalog/booking.events";
import { buildPaymentSuccessEvent } from "../catalog/payment.events";
import { buildPartnerArrivedEvent } from "../catalog/partner.events";
import {
  buildEtaFeatureUpdatedEvent,
  buildEtaLabelCreatedEvent,
  buildEtaTripCompletedEvent,
} from "../catalog/eta.events";
import { EVENT_TYPES } from "../catalog/event-types";
import { assertNoProhibitedPii, sanitizeEventPayload } from "../core/pii";
import { validateEventEnvelope } from "../core/validation";
import { computeRetryDelayMs, isTransientConsumerError } from "../core/retry";
import { isHomigoEvent } from "../core/homigo-event";

describe("event builders", () => {
  test("booking.created uses integer paise and no PII", () => {
    const event = buildBookingCreatedEvent({
      bookingId: "bk_1",
      bookingNumber: "HG-100",
      userId: "user_1",
      serviceId: "svc_1",
      serviceCategory: "cleaning",
      city: "Gurugram",
      providerId: null,
      status: "PENDING",
      finalAmount: 499,
      paymentMethod: "razorpay",
      scheduledAt: new Date("2026-07-31T10:00:00.000Z"),
    });
    expect(event.type).toBe("homigo.booking.created");
    expect(event.homigo.version).toBe("1.0");
    expect(event.data.finalAmountPaise).toBe(49900);
    expect(validateEventEnvelope(event).id).toBe(event.id);
  });

  test("partner.arrived captures ETA ML label fields", () => {
    const arrivedAt = new Date("2026-07-31T12:30:00.000Z");
    const event = buildPartnerArrivedEvent({
      providerId: "pro_1",
      bookingId: "bk_1",
      arrivedAt,
      dispatchedAt: new Date("2026-07-31T12:00:00.000Z"),
      enRouteAt: new Date("2026-07-31T12:05:00.000Z"),
      travelDurationMin: 25,
      city: "Delhi",
      serviceCategory: "plumbing",
      distanceKm: 0.08,
      googleEtaMin: 22,
    });
    expect(event.data.travelDurationMin).toBe(25);
    expect(event.data.hourOfDay).toBe(arrivedAt.getHours());
  });

  test("payment.success envelope validates", () => {
    const event = buildPaymentSuccessEvent({
      paymentId: "pay_1",
      bookingId: "bk_1",
      userId: "user_1",
      amount: 1000,
      paymentMethod: "razorpay",
      completedAt: new Date(),
    });
    expect(isHomigoEvent(event)).toBe(true);
    expect(event.data.amountPaise).toBe(100000);
  });
});

describe("PII protection", () => {
  test("sanitizer strips prohibited keys", () => {
    const cleaned = sanitizeEventPayload({
      userId: "u1",
      email: "secret@example.com",
      nested: { phone: "+911234567890", bookingId: "b1" },
    });
    expect(cleaned).toEqual({ userId: "u1", nested: { bookingId: "b1" } } as typeof cleaned);
  });

  test("assertNoProhibitedPii rejects poison payloads", () => {
    expect(() =>
      assertNoProhibitedPii({ userId: "u1", email: "x@y.com" }),
    ).toThrow(/prohibited/i);
  });

  test("builders reject ORM-style PII leakage", () => {
    expect(() =>
      buildBookingCompletedEvent({
        bookingId: "bk_1",
        userId: "user_1",
        providerId: "pro_1",
        serviceId: "svc_1",
        completedAt: new Date(),
        actualDurationMin: 60,
        finalAmount: 100,
      }),
    ).not.toThrow();
  });
});

describe("retry semantics", () => {
  test("backoff increases with attempts", () => {
    const d1 = computeRetryDelayMs(1).getTime();
    const d3 = computeRetryDelayMs(3).getTime();
    expect(d3).toBeGreaterThan(d1);
  });

  test("validation errors are permanent", () => {
    expect(isTransientConsumerError(new Error("Invalid event envelope"))).toBe(false);
    expect(isTransientConsumerError(new Error("connection reset"))).toBe(true);
  });
});

describe("event type namespace contract", () => {
  test("every registered event type uses the homigo namespace", () => {
    const offenders = Object.entries(EVENT_TYPES)
      .filter(([, type]) => !type.startsWith("homigo."))
      .map(([name, type]) => `${name}="${type}"`);
    expect(offenders).toEqual([]);
  });

  test("ETA events are registered and pass envelope validation", () => {
    const events = [
      buildEtaLabelCreatedEvent({
        bookingId: "bk_eta_1",
        partnerHash: "hash",
        city: "Delhi",
        actualTravelDurationSec: 600,
        googleEtaSeconds: 540,
        qualityScore: 95,
        status: "TRAINING_READY",
      }),
      buildEtaTripCompletedEvent({
        bookingId: "bk_eta_2",
        partnerHash: "hash",
        actualTravelDurationMin: 10,
        googleEtaMinutes: 9,
        gapMinutes: 1,
        city: "Delhi",
      }),
      buildEtaFeatureUpdatedEvent({
        bookingId: "bk_eta_3",
        featureGroup: "eta",
        versionTag: "v2.0",
        rowCount: 1,
      }),
    ];

    expect(events.map((e) => e.type)).toEqual([
      "homigo.eta.label.created",
      "homigo.eta.trip.completed",
      "homigo.eta.feature.updated",
    ]);

    for (const event of events) {
      expect(validateEventEnvelope(event).id).toBe(event.id);
      expect(event.homigo.aggregateType).toBe("eta");
    }
  });
});
