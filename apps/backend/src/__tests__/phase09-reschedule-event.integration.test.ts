/**
 * Phase 09 — `homigo.booking.rescheduled`.
 *
 * The event name already existed in the AI tool catalogue (`write.booking.rescheduleBooking` declares
 * `eventMapping: "homigo.booking.rescheduled"`), but nothing emitted it: a schedule change reached no
 * consumer. It is now written to the outbox inside the same transaction as the schedule write, by
 * both the customer path and the admin path.
 *
 * What is asserted: the row exists with the right before/after instants and actor; a reschedule that
 * ROLLS BACK leaves no event; and a refused reschedule emits nothing.
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
import { bookingService } from "../services/booking.service";
import { adminBookingOperationsService } from "../services/admin-booking-operations.service";
import { eventPlatformConfig } from "../events/core/config";

const RUN = `p09evt-${Date.now().toString(36)}`;
let ctx: AdvCtx;
let dbOk = false;
let day = 3;

function istSlot(daysAhead: number, hhmm = "10:00"): Date {
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" })
    .format(new Date(Date.now() + daysAhead * 86_400_000));
  return new Date(`${ymd}T${hhmm}:00+05:30`);
}

async function createBooking() {
  const created = await bookingService.create(ctx.customerA.id, {
    serviceId: ctx.serviceId,
    providerId: ctx.providerId,
    addressId: ctx.addressAId,
    scheduledDate: istSlot((day += 1)).toISOString(),
  });
  if (!("booking" in created) || !created.booking) throw new Error(`create failed: ${JSON.stringify(created)}`);
  return created.booking.id as string;
}

/** Outbox rows of this type for one booking, newest first. */
async function rescheduleEvents(bookingId: string) {
  // CloudEvents envelope: the domain fields live under payload.data; the actor is also a column.
  return prisma.$queryRaw<Array<{ id: string; payload: any; actor_type: string | null; actor_id: string | null; created_at: Date }>>`
    SELECT id, payload, actor_type, actor_id, created_at FROM event_outbox
    WHERE event_type = 'homigo.booking.rescheduled' AND aggregate_id = ${bookingId}
    ORDER BY created_at DESC
  `;
}

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

describe.serial("a schedule change reaches the outbox", () => {
  test("the event platform is on for this run (otherwise the assertions below prove nothing)", () => {
    if (!dbOk) return;
    expect(eventPlatformConfig.outboxEnabled && eventPlatformConfig.bookingEventsEnabled).toBe(true);
  });

  test("a customer reschedule emits one event carrying both instants and the customer as actor", async () => {
    if (!dbOk) return;
    const id = await createBooking();
    const before = (await prisma.booking.findUniqueOrThrow({ where: { id }, select: { scheduledDate: true } })).scheduledDate;
    const target = istSlot((day += 1), "14:00");

    const res = await bookingService.update(ctx.customerA.id, id, { scheduledDate: target.toISOString() });
    expect(res).toMatchObject({ ok: true });

    const events = await rescheduleEvents(id);
    expect(events.length).toBe(1);
    const ev = events[0]!;
    const p = ev.payload.data;
    expect(p.bookingId).toBe(id);
    expect(new Date(p.previousScheduledAt).toISOString()).toBe(before.toISOString());
    expect(new Date(p.scheduledAt).toISOString()).toBe(target.toISOString());
    expect(p.providerId).toBe(ctx.providerId);
    expect(ev.payload.type).toBe("homigo.booking.rescheduled");
    expect(ev.actor_type).toBe("customer");
    expect(ev.actor_id).toBe(ctx.customerA.id);
  });

  test("an admin reschedule emits the same event with the admin as actor", async () => {
    if (!dbOk) return;
    const id = await createBooking();
    const before = (await prisma.booking.findUniqueOrThrow({ where: { id }, select: { scheduledDate: true } })).scheduledDate;
    const target = istSlot((day += 1), "15:00");

    await adminBookingOperationsService.rescheduleBooking(id, ctx.superAdmin.id, target.toISOString(), "ops move");

    const events = await rescheduleEvents(id);
    expect(events.length).toBe(1);
    const ev = events[0]!;
    const p = ev.payload.data;
    expect(new Date(p.previousScheduledAt).toISOString()).toBe(before.toISOString());
    expect(new Date(p.scheduledAt).toISOString()).toBe(target.toISOString());
    expect(ev.actor_type).toBe("admin");
    expect(ev.actor_id).toBe(ctx.superAdmin.id);
  });

  test("a REFUSED reschedule emits nothing — no consumer hears about a move that never happened", async () => {
    if (!dbOk) return;
    const id = await createBooking();
    const kept = (await prisma.booking.findUniqueOrThrow({ where: { id }, select: { scheduledDate: true } })).scheduledDate;

    // Into the past: refused by the Phase 07/08 rules before the transaction is even opened.
    const refused = await bookingService.update(ctx.customerA.id, id, {
      scheduledDate: new Date(Date.now() - 2 * 86_400_000).toISOString(),
    });
    expect("error" in refused).toBe(true);
    expect(await rescheduleEvents(id)).toEqual([]);
    const after = await prisma.booking.findUniqueOrThrow({ where: { id }, select: { scheduledDate: true } });
    expect(after.scheduledDate.toISOString()).toBe(kept.toISOString());
  });

  test("a reschedule that CONFLICTS rolls back the event with the write", async () => {
    if (!dbOk) return;
    // Two bookings for the same partner; moving one onto the other's window must fail in-transaction,
    // which is the case that would leak an event if it were emitted outside the transaction.
    const first = await createBooking();
    const second = await createBooking();
    const firstAt = (await prisma.booking.findUniqueOrThrow({ where: { id: first }, select: { scheduledDate: true } })).scheduledDate;

    const res = await bookingService.update(ctx.customerA.id, second, { scheduledDate: firstAt.toISOString() });
    expect("error" in res).toBe(true);
    expect(await rescheduleEvents(second)).toEqual([]);
  });
});
