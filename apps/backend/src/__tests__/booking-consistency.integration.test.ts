/**
 * Phase 40 — each read-only consistency check fires on a planted contradiction and stays quiet on
 * a consistent booking (a check that cannot fire is not a check). ISOLATED homigo_test DB.
 *   cd apps/backend && bun test D:/homigo/apps/backend/src/__tests__/booking-consistency.integration.test.ts
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import "../load-env";
import prisma from "../lib/prisma";
import { bookingConsistencyService } from "../services/booking-consistency.service";
import { cleanupAdversarialFixtures, dbReachable, payWithRealWallet, seedAdversarialFixtures, type AdvCtx } from "./helpers/adversarial-fixtures";
import { refuseIfNotIsolatedTestDb } from "./helpers/isolated-test-db";

const RUN = `bcs-${Date.now().toString(36)}`;
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

async function booking(data: Record<string, unknown> = {}) {
  seq++;
  const d = new Date(Date.now() + (200 + seq * 3) * 3_600_000);
  d.setMinutes(0, 0, 0);
  return (
    await prisma.booking.create({
      data: {
        bookingNumber: `BCS-${RUN}-${seq}`,
        userId: ctx.customerA.id,
        serviceId: ctx.serviceId,
        addressId: ctx.addressAId,
        status: "PENDING",
        scheduledDate: d,
        baseAmount: 1000,
        finalAmount: 1000,
        totalAmount: 1000,
        paymentStatus: "PENDING",
        // `booking_completed_requires_timestamp`: a planted COMPLETED row still needs a completion
        // time — the contradiction under test is "no earning", not "no timestamp".
        ...(data.status === "COMPLETED" ? { completedAt: new Date() } : {}),
        ...data,
      },
    })
  ).id;
}

describe.serial("booking consistency report", () => {
  test("planted contradictions are each reported; a consistent paid booking is not", async () => {
    if (!dbOk) return;
    const paidNoMoney = await booking({ paymentStatus: "SUCCESS" });
    const completedNoEarning = await booking({ status: "COMPLETED", providerId: ctx.providerId });
    const claimedNoPartner = await booking({ status: "ACCEPTED" });
    const offerOnCancelled = await booking({ status: "CANCELLED_BY_USER", cancelledAt: new Date() });
    const job = await prisma.assignmentJob.create({ data: { bookingId: offerOnCancelled, status: "DISPATCHED" } });
    await prisma.assignmentAttempt.create({ data: { jobId: job.id, providerId: ctx.providerId, status: "SENT", dispatchedAt: new Date() } });
    const consistent = await booking();
    await payWithRealWallet(consistent, ctx.customerA.id);

    const ids = [paidNoMoney, completedNoEarning, claimedNoPartner, offerOnCancelled, consistent];
    const snapshot = async () => JSON.stringify(await prisma.booking.findMany({ where: { id: { in: ids } }, orderBy: { id: "asc" } }));
    const before = await snapshot();
    const report = await bookingConsistencyService.run({ bookingIds: ids });
    expect(await snapshot()).toBe(before); // read-only: nothing it inspected changed

    const flagged = (check: string) => report.issues.filter((i) => i.check === check).map((i) => i.bookingId);
    expect(flagged("PAID_WITHOUT_MONEY")).toContain(paidNoMoney);
    expect(flagged("PAID_WITHOUT_MONEY")).not.toContain(consistent);
    expect(flagged("COMPLETED_WITHOUT_EARNING")).toContain(completedNoEarning);
    expect(flagged("CLAIMED_WITHOUT_PARTNER")).toContain(claimedNoPartner);
    expect(flagged("OPEN_OFFER_ON_CLOSED_BOOKING")).toContain(offerOnCancelled);
    for (const c of bookingConsistencyService.checks) expect(typeof report.totals[c.check]).toBe("number");
  });
});
