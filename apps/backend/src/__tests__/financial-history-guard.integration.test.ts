/**
 * Phase 8 — financial history survives entity deletion (ISOLATED homigo_test DB).
 *   cd apps/backend && bun test D:/homigo/apps/backend/src/__tests__/financial-history-guard.integration.test.ts
 *
 * homigo_test opts out of the guard by database default (fixtures); each case here turns it back ON
 * inside its own transaction (SET LOCAL … 'off'), which is exactly the production behaviour.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import "../load-env";
import prisma from "../lib/prisma";
import { cleanupAdversarialFixtures, dbReachable, payWithRealWallet, seedAdversarialFixtures, type AdvCtx } from "./helpers/adversarial-fixtures";
import { refuseIfNotIsolatedTestDb } from "./helpers/isolated-test-db";

const RUN = `fhg-${Date.now().toString(36)}`;
let ctx: AdvCtx;
let dbOk = false;
let paidBookingId = "";

beforeAll(async () => {
  dbOk = await dbReachable();
  if (!dbOk) return;
  const [{ db }] = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
  refuseIfNotIsolatedTestDb(db);
  ctx = await seedAdversarialFixtures(RUN);
  const d = new Date(Date.now() + 400 * 3_600_000);
  d.setMinutes(0, 0, 0);
  paidBookingId = (
    await prisma.booking.create({
      data: { bookingNumber: `FHG-${RUN}`, userId: ctx.customerA.id, serviceId: ctx.serviceId, addressId: ctx.addressAId, providerId: ctx.providerId, status: "PENDING", scheduledDate: d, baseAmount: 500, finalAmount: 500, totalAmount: 500, paymentStatus: "PENDING" },
    })
  ).id;
  // providerId is set up front so settlement does NOT fire the fire-and-forget dispatch
  // (booking-payment-settled.ts: only an unassigned PENDING booking is re-dispatched). Without it the
  // broadcast's BOOKING_REQUEST notifications outlived this file and landed inside the next file's
  // "mutates nothing" snapshot (finance-narrative, reversed order — release certification F3).
  await payWithRealWallet(paidBookingId, ctx.customerA.id);
}, 90_000);

afterAll(async () => {
  if (dbOk) await cleanupAdversarialFixtures(RUN);
}, 60_000);

/** Run `sql` with the guard ON (production behaviour) and report whether Postgres refused it. */
async function guarded(fn: (tx: typeof prisma) => Promise<unknown>): Promise<"refused" | "allowed"> {
  try {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('homigo.allow_financial_purge', 'off', true)`;
      await fn(tx as unknown as typeof prisma);
      throw new Error("__rollback__"); // never actually delete anything in this suite
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("__rollback__")) return "allowed";
    if (/financial history guard/.test(msg)) return "refused";
    throw e;
  }
  return "allowed";
}

describe.serial("financial history delete guard", () => {
  test("a customer with wallet/payment history cannot be hard-deleted; history intact", async () => {
    if (!dbOk) return;
    expect(await guarded((tx) => tx.user.delete({ where: { id: ctx.customerA.id } }))).toBe("refused");
    expect(await prisma.walletTransaction.count({ where: { userId: ctx.customerA.id } })).toBeGreaterThan(0);
  });

  test("a booking with a wallet payment cannot be hard-deleted", async () => {
    if (!dbOk) return;
    expect(await guarded((tx) => tx.booking.delete({ where: { id: paidBookingId } }))).toBe("refused");
  });

  test("a partner with earnings cannot be hard-deleted", async () => {
    if (!dbOk) return;
    await prisma.earning.create({
      data: { providerId: ctx.providerId, bookingId: paidBookingId, grossAmount: 500, commission: 100, netEarning: 400 },
    });
    expect(await guarded((tx) => tx.provider.delete({ where: { id: ctx.providerId } }))).toBe("refused");
    await prisma.earning.deleteMany({ where: { bookingId: paidBookingId } });
  });

  test("entities WITHOUT money history still delete; soft delete is always allowed", async () => {
    if (!dbOk) return;
    expect(await guarded((tx) => tx.user.delete({ where: { id: ctx.customerB.id } }))).toBe("allowed");
    expect(await guarded((tx) => tx.user.update({ where: { id: ctx.customerA.id }, data: { deletedAt: new Date() } }))).toBe("allowed");
  });

  test("the deliberate opt-out lifts the guard (and only it)", async () => {
    if (!dbOk) return;
    let lifted = false;
    try {
      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('homigo.allow_financial_purge', 'on', true)`;
        await tx.booking.delete({ where: { id: paidBookingId } });
        lifted = true;
        throw new Error("__rollback__");
      });
    } catch (e) {
      if (!(e instanceof Error && e.message === "__rollback__")) throw e;
    }
    expect(lifted).toBe(true);
    expect(await prisma.booking.count({ where: { id: paidBookingId } })).toBe(1); // rolled back
  });
});
