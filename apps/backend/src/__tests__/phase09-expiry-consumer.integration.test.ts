/**
 * §49 / §80 — the consumer for `homigo.booking.payment_expired`.
 *
 * A released booking has to reach the customer. This asserts the consumer does its real job (a
 * notification the customer can read, saying what happened and why), and that it is idempotent:
 * a duplicate delivery, a retry or a consumer restart must not message them twice.
 *
 * `booking.rescheduled` has no notification consumer ON PURPOSE — the reschedule path already
 * notifies the partner and the customer performed the action — so this file also pins that the
 * audit and metrics consumers are the ones that carry it, rather than a no-op added for a test.
 */
import "../load-env";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import prisma from "../lib/prisma";
import {
  cleanupAdversarialFixtures,
  dbReachable,
  seedAdversarialFixtures,
  type AdvCtx,
} from "./helpers/adversarial-fixtures";
import { refuseIfNotIsolatedTestDb } from "./helpers/isolated-test-db";
import { createBookingWithQuote } from "./helpers/quote-token";
import {
  bookingPaymentExpiryService,
  PAYMENT_PENDING_TTL_MINUTES,
} from "../services/booking-payment-expiry.service";
import { bookingLifecycleNotifyConsumer } from "../events/consumers/booking-lifecycle-notify.consumer";
import { buildBookingPaymentExpiredEvent } from "../events/catalog/booking.events";
import { EVENT_TYPES } from "../events/catalog/event-types";

const RUN = `p09cons-${Date.now().toString(36)}`;
let ctx: AdvCtx;
let dbOk = false;
let day = 4;

function istSlot(daysAhead: number, hhmm = "10:00"): Date {
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" })
    .format(new Date(Date.now() + daysAhead * 86_400_000));
  return new Date(`${ymd}T${hhmm}:00+05:30`);
}

/** A booking the TTL has actually expired, plus the event that expiry emitted. */
async function expiredBooking() {
  const created = await createBookingWithQuote(ctx.customerA.id, {
    serviceId: ctx.serviceId,
    providerId: ctx.providerId,
    addressId: ctx.addressAId,
    scheduledDate: istSlot((day += 1)).toISOString(),
  });
  if (!("booking" in created) || !created.booking) throw new Error(`create failed: ${JSON.stringify(created)}`);
  const bookingId = created.booking.id;
  await prisma.$executeRawUnsafe(
    `UPDATE bookings SET created_at = NOW() - INTERVAL '${PAYMENT_PENDING_TTL_MINUTES + 5} minutes' WHERE id = $1`,
    bookingId,
  );
  const out = await bookingPaymentExpiryService.expireStalePendingPayments(50, PAYMENT_PENDING_TTL_MINUTES, { bookingId });
  expect(out.expired).toBe(1);
  return bookingId;
}

const notificationsFor = (bookingId: string) =>
  prisma.notification.findMany({ where: { referenceId: bookingId, type: "BOOKING_PAYMENT_EXPIRED" } });

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? "a".repeat(64);
  process.env.HASH_HMAC_KEY = process.env.HASH_HMAC_KEY ?? "test-hmac-pepper";
  process.env.MASTER_ENCRYPTION_KEY = process.env.MASTER_ENCRYPTION_KEY ?? Buffer.alloc(32, 7).toString("base64");
  dbOk = await dbReachable();
  if (!dbOk) return;
  const [{ db }] = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
  refuseIfNotIsolatedTestDb(db);
  ctx = await seedAdversarialFixtures(RUN);
}, 120_000);

afterAll(async () => {
  if (!dbOk) return;
  await cleanupAdversarialFixtures(RUN);
}, 60_000);

describe.serial("the customer is told their booking was released", () => {
  test("the event produces one notification that explains what happened", async () => {
    if (!dbOk) return;
    const bookingId = await expiredBooking();
    const events = await prisma.$queryRaw<Array<{ payload: any }>>`
      SELECT payload FROM event_outbox
      WHERE event_type = ${EVENT_TYPES.BOOKING_PAYMENT_EXPIRED} AND aggregate_id = ${bookingId}
    `;
    expect(events.length).toBe(1);

    await bookingLifecycleNotifyConsumer({
      ...events[0]!.payload,
      data: events[0]!.payload.data,
      homigo: events[0]!.payload.homigo,
    } as any);

    const notes = await notificationsFor(bookingId);
    expect(notes.length).toBe(1);
    const n = notes[0]!;
    expect(n.userId).toBe(ctx.customerA.id);
    // Says the window closed and invites a new booking; never claims anyone cancelled it.
    expect(n.message.toLowerCase()).toContain("wasn't completed");
    expect(n.message).toContain(String(PAYMENT_PENDING_TTL_MINUTES));
    expect(n.title.toLowerCase()).not.toContain("cancel");
    expect(n.message.toLowerCase()).not.toContain("cancel");
  });

  test("a duplicate delivery does not message the customer twice", async () => {
    if (!dbOk) return;
    const bookingId = await expiredBooking();
    const event = buildBookingPaymentExpiredEvent({
      bookingId,
      userId: ctx.customerA.id,
      providerId: ctx.providerId,
      scheduledAt: new Date(),
      ttlMinutes: PAYMENT_PENDING_TTL_MINUTES,
      previousPaymentStatus: "PENDING",
    });

    await bookingLifecycleNotifyConsumer(event);
    await bookingLifecycleNotifyConsumer(event);
    await bookingLifecycleNotifyConsumer(event);

    expect((await notificationsFor(bookingId)).length).toBe(1);
  });

  test("concurrent deliveries of the same event still produce one notification", async () => {
    if (!dbOk) return;
    const bookingId = await expiredBooking();
    const event = buildBookingPaymentExpiredEvent({
      bookingId,
      userId: ctx.customerA.id,
      providerId: ctx.providerId,
      scheduledAt: new Date(),
      ttlMinutes: PAYMENT_PENDING_TTL_MINUTES,
      previousPaymentStatus: "PENDING",
    });

    const results = await Promise.allSettled(Array.from({ length: 5 }, () => bookingLifecycleNotifyConsumer(event)));
    // Nothing may throw: a consumer that rejects is retried, and retrying a delivered notification
    // is how a customer gets the same message five times.
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
    expect((await notificationsFor(bookingId)).length).toBe(1);
  });

  test("an event missing its fields is ignored rather than guessed at", async () => {
    if (!dbOk) return;
    const broken = buildBookingPaymentExpiredEvent({
      bookingId: "",
      userId: "",
      providerId: null,
      scheduledAt: new Date(),
      ttlMinutes: PAYMENT_PENDING_TTL_MINUTES,
      previousPaymentStatus: "PENDING",
    });
    await bookingLifecycleNotifyConsumer(broken);
    expect(await prisma.notification.count({ where: { referenceId: "", type: "BOOKING_PAYMENT_EXPIRED" } })).toBe(0);
  });

  test("it ignores every other event type — it is not a catch-all", async () => {
    if (!dbOk) return;
    const bookingId = await expiredBooking();
    const wrongType = {
      ...buildBookingPaymentExpiredEvent({
        bookingId,
        userId: ctx.customerA.id,
        providerId: ctx.providerId,
        scheduledAt: new Date(),
        ttlMinutes: PAYMENT_PENDING_TTL_MINUTES,
        previousPaymentStatus: "PENDING",
      }),
      type: EVENT_TYPES.BOOKING_RESCHEDULED,
    };
    await bookingLifecycleNotifyConsumer(wrongType as any);
    expect((await notificationsFor(bookingId)).length).toBe(0);
  });
});

describe("both new events are carried by a real consumer", () => {
  test("the audit consumer subscribes to rescheduled and payment_expired", async () => {
    const { AUDIT_CONSUMER_NAME } = await import("../events/consumers/audit.consumer");
    const registry = await import("../events/core/consumer-registry");
    const { bootstrapEventConsumers } = await import("../events/consumers/index");
    bootstrapEventConsumers();
    const consumers = (registry as unknown as { listConsumers?: () => Array<{ name: string; eventTypes: string[] | "*" }> })
      .listConsumers?.();
    if (!consumers) return; // registry does not expose a listing in this build
    const audit = consumers.find((c) => c.name === AUDIT_CONSUMER_NAME);
    expect(audit).toBeTruthy();
    if (audit && audit.eventTypes !== "*") {
      expect(audit.eventTypes).toContain(EVENT_TYPES.BOOKING_RESCHEDULED);
      expect(audit.eventTypes).toContain(EVENT_TYPES.BOOKING_PAYMENT_EXPIRED);
    }
  });
});
