/**
 * Phase 29 — every booking status / partner / payment / schedule change is recorded, append-only,
 * with actor and reason where the writer supplied them. ISOLATED homigo_test DB.
 *   cd apps/backend && bun test D:/homigo/apps/backend/src/__tests__/booking-status-history.integration.test.ts
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import "../load-env";
import prisma from "../lib/prisma";
import { bookingService } from "../services/booking.service";
import { adminBookingOperationsService } from "../services/admin-booking-operations.service";
import {
  cleanupAdversarialFixtures,
  dbReachable,
  heartbeatFresh,
  payWithRealWallet,
  seedAdversarialFixtures,
  type AdvCtx,
} from "./helpers/adversarial-fixtures";
import { refuseIfNotIsolatedTestDb } from "./helpers/isolated-test-db";

const RUN = `bsh-${Date.now().toString(36)}`;
let ctx: AdvCtx;
let dbOk = false;
let seq = 0;

beforeAll(async () => {
  dbOk = await dbReachable();
  if (!dbOk) return;
  const [{ db }] = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
  refuseIfNotIsolatedTestDb(db);
  ctx = await seedAdversarialFixtures(RUN);
}, 90_000);

afterAll(async () => {
  if (dbOk) await cleanupAdversarialFixtures(RUN);
}, 60_000);

type Row = { old_status: string | null; new_status: string; new_payment_status: string | null; new_provider_id: string | null; actor_type: string | null; actor_id: string | null; reason: string | null; old_scheduled_date: Date | null };
const history = (bookingId: string) =>
  prisma.$queryRaw<Row[]>`SELECT old_status, new_status, new_payment_status, new_provider_id, actor_type, actor_id, reason, old_scheduled_date
    FROM booking_status_history WHERE booking_id = ${bookingId} ORDER BY id`;

async function booking() {
  seq++;
  const d = new Date(Date.now() + (96 + seq * 3) * 3_600_000);
  d.setMinutes(0, 0, 0);
  const b = await prisma.booking.create({
    data: {
      bookingNumber: `BSH-${RUN}-${seq}`,
      userId: ctx.customerA.id,
      serviceId: ctx.serviceId,
      addressId: ctx.addressAId,
      status: "PENDING",
      scheduledDate: d,
      baseAmount: 1000,
      finalAmount: 1000,
      totalAmount: 1000,
      paymentStatus: "PENDING",
    },
  });
  return b.id;
}

describe.serial("booking status history", () => {
  test("create → pay → customer cancel: every step recorded in order, with actor and reason", async () => {
    if (!dbOk) return;
    const id = await booking();
    await payWithRealWallet(id, ctx.customerA.id);
    await bookingService.cancel({ userId: ctx.customerA.id }, id, "plans changed");

    const h = await history(id);
    expect(h[0]).toMatchObject({ old_status: null, new_status: "PENDING" });
    expect(h.some((r) => r.new_payment_status === "SUCCESS" && (r.reason ?? "").startsWith("payment captured"))).toBe(true);
    const cancel = h.find((r) => r.new_status === "CANCELLED_BY_USER")!;
    expect(cancel).toMatchObject({ old_status: "PENDING", actor_type: "customer", actor_id: ctx.customerA.id });
    expect(cancel.reason).toContain("plans changed");
  });

  test("admin reassign and admin cancel are attributed to the admin", async () => {
    if (!dbOk) return;
    const id = await booking();
    await payWithRealWallet(id, ctx.customerA.id);
    await new Promise((r) => setTimeout(r, 400)); // let the payment-settled background dispatch finish
    await prisma.assignmentJob.deleteMany({ where: { bookingId: id } });
    await prisma.booking.update({ where: { id }, data: { providerId: null } });
    await heartbeatFresh(ctx);
    await adminBookingOperationsService.reassignProvider(id, ctx.superAdmin.id, ctx.providerId, "manual assign");
    await adminBookingOperationsService.cancelBooking(id, ctx.superAdmin.id, "ops call");

    const h = await history(id);
    const assigned = h.find((r) => r.new_status === "ASSIGNED")!;
    expect(assigned).toMatchObject({ actor_type: "admin", actor_id: ctx.superAdmin.id, new_provider_id: ctx.providerId });
    expect(h.find((r) => r.new_status === "CANCELLED_BY_USER")).toMatchObject({ actor_type: "admin" });
  });

  test("a reschedule is recorded with the old time", async () => {
    if (!dbOk) return;
    const id = await booking();
    const before = (await prisma.booking.findUniqueOrThrow({ where: { id } })).scheduledDate;
    const next = new Date(before.getTime() + 5 * 3_600_000);
    const r = await bookingService.update(ctx.customerA.id, id, { scheduledDate: next.toISOString() });
    expect("error" in r ? r.error : "ok").toBe("ok");
    const h = await history(id);
    const moved = h.find((row) => row.old_scheduled_date != null)!;
    expect(moved.old_scheduled_date?.getTime()).toBe(before.getTime());
    expect(moved.actor_type).toBe("customer");
  });

  test("a raw write with no audit context is still recorded; history rows cannot be edited", async () => {
    if (!dbOk) return;
    const id = await booking();
    await prisma.$executeRaw`UPDATE bookings SET status = 'CANCELLED_BY_USER' WHERE id = ${id}`;
    const h = await history(id);
    expect(h.at(-1)).toMatchObject({ old_status: "PENDING", new_status: "CANCELLED_BY_USER", actor_type: null });
    const edit = async () => prisma.$executeRaw`UPDATE booking_status_history SET reason = 'x' WHERE booking_id = ${id}`;
    await expect(edit()).rejects.toThrow(/append-only/);
  });
});
