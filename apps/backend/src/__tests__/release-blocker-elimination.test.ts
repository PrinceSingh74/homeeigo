/**
 * Release blocker elimination — PostgreSQL + production services.
 */
import "../load-env";
import { provenanceForNewUser } from "../lib/data-provenance";
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { WalletTxnStatus } from "@prisma/client";
import {
  prisma,
  dbReachable,
  seedAdversarialFixtures,
  heartbeatFresh,
  keepPresenceFresh,
  cleanupAdversarialFixtures,
  deleteBookingsForUsers,
  fixturePhone,
  futureSlot,
  type AdvCtx,
} from "./helpers/adversarial-fixtures";
import { bookingService } from "../services/booking.service";
import { sumCounterWhere } from "../lib/metrics";
import { walletService } from "../services/wallet.service";
import { financialLedgerService } from "../services/financial-ledger.service";

const RUN_ID = `rbe-${Date.now().toString(36)}`;
let ctx: AdvCtx;
let dbOk = false;
const savedNodeEnv = process.env.NODE_ENV;

beforeAll(async () => {
  dbOk = await dbReachable();
  if (!dbOk) return;
  ctx = await seedAdversarialFixtures(RUN_ID);
  /**
   * Warm-up (2026-09-26): one direct-assign create outside any test budget. The first create of a
   * process pays module init, engine warm-up, the to_regclass probes and the first capability
   * gate-context load (Phase 11); with that cold-start inside the FIRST concurrency test's 60s
   * budget, the 50-way race timed out and its still-running leaked promises then starved every
   * later test in this serial suite. The suite certifies ATOMICITY (one success, no duplicates),
   * not cold-start latency, so steady state is the right thing to measure.
   */
  await heartbeatFresh(ctx);
  const warm = await bookingService.create(ctx.customerA.id, {
    serviceId: ctx.serviceId,
    providerId: ctx.providerId,
    scheduledDate: futureSlot(40).toISOString(),
    addressId: ctx.addressAId,
  });
  if ("booking" in warm && warm.booking) {
    await prisma.booking.delete({ where: { id: warm.booking.id } }).catch(() => undefined);
  }
}, 120_000);

afterAll(async () => {
  if (dbOk) await cleanupAdversarialFixtures(RUN_ID);
  process.env.NODE_ENV = savedNodeEnv;
}, 60_000);

function skipIfNoDb() {
  if (!dbOk) {
    console.warn("SKIP: PostgreSQL unreachable");
    return true;
  }
  return false;
}

async function seedCustomers(count: number, tag: string) {
  return Promise.all(
    Array.from({ length: count }, async (_, i) => {
      const user = await prisma.user.create({
        data: {
          ...provenanceForNewUser(`adv-${RUN_ID}-${tag}-${i}@adv.test`),
          email: `adv-${RUN_ID}-${tag}-${i}@adv.test`,
          phoneNumber: fixturePhone(RUN_ID, `race-${tag}-${i}`),
          firstName: "Race",
          lastName: `U${i}`,
          password: await Bun.password.hash("x", { algorithm: "bcrypt", cost: 4 }),
          role: "CUSTOMER",
          isEmailVerified: true,
        },
      });
      const address = await prisma.address.create({
        data: {
          userId: user.id,
          label: "Home",
          addressLine1: `${i} St`,
          city: "Noida",
          state: "UP",
          zipCode: "201301",
          fullAddress: `${i} St`,
          latitude: 28.62,
          longitude: 77.37,
        },
      });
      return { userId: user.id, addressId: address.id };
    }),
  );
}

async function cleanupCustomers(customers: Array<{ userId: string }>) {
  const userIds = customers.map((c) => c.userId);
  await deleteBookingsForUsers(userIds);
  await prisma.address.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

async function cleanupCtxCustomerBookings() {
  await deleteBookingsForUsers([ctx.customerA.id, ctx.customerB.id]);
}

async function cleanProviderSlot(providerId: string, slot: Date) {
  const ms = 30 * 60 * 1000;
  await prisma.booking.deleteMany({
    where: {
      providerId,
      scheduledDate: {
        gte: new Date(slot.getTime() - ms),
        lte: new Date(slot.getTime() + ms),
      },
    },
  });
}

async function runConcurrentCreates(concurrency: number, slotOffset: number) {
  const slot = futureSlot(slotOffset);
  await cleanProviderSlot(ctx.providerId, slot);
  const customers = await seedCustomers(concurrency, `c${concurrency}-${slotOffset}`);
  // Seeding N users can outlast PRESENCE_FRESH_SEC; refresh presence right before the race.
  await heartbeatFresh(ctx);
  // …and keep it live DURING the race, as the partner's app would (it heartbeats every ~25 s).
  // A direct assignment requires live presence (assertOfferEligible, livePresenceRequired defaults
  // on), and a 500-way burst on the 5-connection test pool drains every create's pre-transaction
  // validation before the first transaction starts: measured 20–24 s, over 30 s under suite load.
  // With one heartbeat the presence expired mid-race and EVERY create — the winner included — was
  // refused STALE_PRESENCE, reported as "0 successes" (reproduced 2026-09-30 with
  // PRESENCE_FRESH_SEC=10: 500/500 STALE_PRESENCE). 8 s stays inside the heartbeat rate limit.
  const stalePresenceBefore = sumCounterWhere("direct_assignment_rejections", "STALE_PRESENCE");
  const keepAlive = setInterval(() => {
    void heartbeatFresh(ctx).catch(() => undefined);
  }, 8_000);
  let results: Awaited<ReturnType<typeof bookingService.create>>[];
  try {
    results = await Promise.all(
      customers.map((c) =>
        bookingService.create(c.userId, {
          serviceId: ctx.serviceId,
          providerId: ctx.providerId,
          scheduledDate: slot.toISOString(),
          addressId: c.addressId,
        }),
      ),
    );
  } finally {
    clearInterval(keepAlive);
  }
  const stalePresenceRejections =
    sumCounterWhere("direct_assignment_rejections", "STALE_PRESENCE") - stalePresenceBefore;
  const successes = results.filter((r) => "booking" in r);
  const failures = results.filter((r) => "error" in r);
  const throws = results.filter((r) => r instanceof Error);
  const active = await prisma.booking.count({
    where: {
      providerId: ctx.providerId,
      scheduledDate: slot,
      status: { in: ["PENDING", "ACCEPTED", "ASSIGNED", "EN_ROUTE", "IN_PROGRESS"] },
    },
  });
  await cleanupCustomers(customers);
  return {
    concurrency,
    successCount: successes.length,
    failureCount: failures.length,
    throwCount: throws.length,
    activeBookings: active,
    allFailuresProviderUnavailable: failures.every((f) => f.error === "PROVIDER_UNAVAILABLE"),
    stalePresenceRejections,
  };
}

describe.serial("Release blocker elimination", () => {
  const createSlotHours: Record<50 | 100 | 250 | 500, number> = {
    50: 60,
    100: 72,
    250: 96,
    500: 120,
  };

  for (const n of [50, 100, 250, 500] as const) {
    test(
      `booking ${n} concurrent creates — 1 success, 0 duplicates, 0 throws`,
      async () => {
      if (skipIfNoDb()) return;
      const r = await runConcurrentCreates(n, createSlotHours[n]);
      // A refusal for an expired fixture heartbeat is a harness failure, not a slot race: say so.
      expect(r.stalePresenceRejections, "fixture presence expired during the race").toBe(0);
      expect(r.successCount).toBe(1);
      expect(r.activeBookings).toBe(1);
      expect(r.throwCount).toBe(0);
      expect(r.allFailuresProviderUnavailable).toBe(true);
      },
      n >= 500 ? 120_000 : 60_000,
    );
  }

  test("booking update rejects exact and buffer conflicts", async () => {
    if (skipIfNoDb()) return;
    await heartbeatFresh(ctx);

    const baseSlot = futureSlot(140);
    const bookingA = await bookingService.create(ctx.customerA.id, {
      serviceId: ctx.serviceId,
      providerId: ctx.providerId,
      scheduledDate: baseSlot.toISOString(),
      addressId: ctx.addressAId,
    });
    expect("booking" in bookingA).toBe(true);

    const slotB = new Date(baseSlot.getTime() + 3 * 3_600_000);
    const bookingB = await bookingService.create(ctx.customerB.id, {
      serviceId: ctx.serviceId,
      providerId: ctx.providerId,
      scheduledDate: slotB.toISOString(),
      addressId: ctx.addressBId,
    });
    expect("booking" in bookingB).toBe(true);
    const bookingBId = bookingB.booking!.id;

    const exact = await bookingService.update(ctx.customerB.id, bookingBId, {
      scheduledDate: baseSlot.toISOString(),
    });
    expect(exact).toEqual({ error: "PROVIDER_UNAVAILABLE" });

    const bufferSlot = new Date(baseSlot.getTime() + 15 * 60_000);
    const buffer = await bookingService.update(ctx.customerB.id, bookingBId, {
      scheduledDate: bufferSlot.toISOString(),
    });
    expect(buffer).toEqual({ error: "PROVIDER_UNAVAILABLE" });

    await cleanupCtxCustomerBookings();
  });

  test(
    "booking 50 concurrent updates — 1 success, 49 conflicts",
    async () => {
    if (skipIfNoDb()) return;
    await heartbeatFresh(ctx);

    const targetSlot = futureSlot(150);
    await cleanProviderSlot(ctx.providerId, targetSlot);

    const customers = await seedCustomers(50, "upd-race");
    try {
      const farSlots = customers.map(
        (_, i) => new Date(targetSlot.getTime() + (i + 2) * 4 * 3_600_000),
      );
      const bookingIds: string[] = [];

      for (let i = 0; i < customers.length; i++) {
        // 50 sequential creates after seeding 50 customers can outlast PRESENCE_FRESH_SEC.
        await keepPresenceFresh(ctx);
        const created = await bookingService.create(customers[i]!.userId, {
          serviceId: ctx.serviceId,
          providerId: ctx.providerId,
          scheduledDate: farSlots[i]!.toISOString(),
          addressId: customers[i]!.addressId,
        });
        expect("booking" in created).toBe(true);
        bookingIds.push(created.booking!.id);
      }

      await keepPresenceFresh(ctx);
      const results = await Promise.all(
        customers.map((c, i) =>
          bookingService.update(c.userId, bookingIds[i]!, {
            scheduledDate: targetSlot.toISOString(),
          }),
        ),
      );

      const successes = results.filter((r) => "ok" in r && r.ok);
      const conflicts = results.filter(
        (r) =>
          "error" in r &&
          (r.error === "PROVIDER_UNAVAILABLE" || r.error === "OVERLAPPING_BOOKING"),
      );
      expect(successes.length).toBe(1);
      expect(conflicts.length).toBe(49);
      expect(results.filter((r) => r instanceof Error)).toHaveLength(0);
    } finally {
      await cleanupCustomers(customers);
    }
    },
    120_000,
  );

  test(
    "booking create vs update race — no duplicate active bookings",
    async () => {
    if (skipIfNoDb()) return;
    await heartbeatFresh(ctx);

    const slot = futureSlot(160);
    await cleanProviderSlot(ctx.providerId, slot);

    try {
      const farSlot = new Date(slot.getTime() + 6 * 3_600_000);
      const createdB = await bookingService.create(ctx.customerB.id, {
        serviceId: ctx.serviceId,
        providerId: ctx.providerId,
        scheduledDate: farSlot.toISOString(),
        addressId: ctx.addressBId,
      });
      expect("booking" in createdB).toBe(true);
      const bookingBId = createdB.booking!.id;

      const [createRace, updateRace] = await Promise.all([
        bookingService.create(ctx.customerA.id, {
          serviceId: ctx.serviceId,
          providerId: ctx.providerId,
          scheduledDate: slot.toISOString(),
          addressId: ctx.addressAId,
        }),
        bookingService.update(ctx.customerB.id, bookingBId, {
          scheduledDate: slot.toISOString(),
        }),
      ]);

      const outcomes = [createRace, updateRace];
      const successCount = outcomes.filter(
        (o) => ("booking" in o && o.booking) || ("ok" in o && o.ok),
      ).length;
      expect(successCount).toBe(1);

      const active = await prisma.booking.count({
        where: {
          providerId: ctx.providerId,
          scheduledDate: slot,
          status: { in: ["PENDING", "ACCEPTED", "ASSIGNED", "EN_ROUTE", "IN_PROGRESS"] },
        },
      });
      expect(active).toBe(1);
    } finally {
      await cleanupCtxCustomerBookings();
    }
    },
    60_000,
  );

  test("wallet top-up commits balance and ledger atomically", async () => {
    if (skipIfNoDb()) return;
    await heartbeatFresh(ctx);

    const user = await prisma.user.create({
      data: {
        ...provenanceForNewUser(`${RUN_ID}-wallet-ok@adv.test`),
        email: `${RUN_ID}-wallet-ok@adv.test`,
        phoneNumber: fixturePhone(RUN_ID, "wallet-ok"),
        firstName: "Wallet",
        lastName: "Ok",
        password: await Bun.password.hash("x", { algorithm: "bcrypt", cost: 4 }),
        role: "CUSTOMER",
        isEmailVerified: true,
        walletBalance: 0,
      },
    });

    const topUp = await walletService.addMoney(user.id, 500);
    if (!topUp || "error" in topUp) throw new Error(`addMoney failed: ${JSON.stringify(topUp)}`);
    const verify = await walletService.verifyTopUp(user.id, {
      razorpayOrderId: topUp.razorpayOrderId,
      razorpayPaymentId: `pay_${RUN_ID}-ok`,
      razorpaySignature: "sig",
    });

    const txn = await prisma.walletTransaction.findFirstOrThrow({
      where: { userId: user.id, referenceId: topUp.razorpayOrderId },
    });
    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    const ledgerEntries = await prisma.journalEntry.count({
      where: { referenceId: txn.id, referenceType: "wallet_transaction" },
    });
    const journal = await prisma.journalEntry.findFirstOrThrow({
      where: { referenceId: txn.id, referenceType: "wallet_transaction" },
      include: { lines: { include: { account: true } } },
    });
    const walletLine = journal.lines.find((l) => l.account.code === "CUSTOMER_WALLET");

    expect(verify).not.toHaveProperty("error");
    expect(after.walletBalance).toBe(500);
    expect(ledgerEntries).toBe(1);
    expect(walletLine?.credit).toBe(500);

    await cleanupWalletTestData(txn.id, user.id);
  });

  test("wallet ledger failure rolls back balance (no divergence)", async () => {
    if (skipIfNoDb()) return;
    await heartbeatFresh(ctx);

    const user = await prisma.user.create({
      data: {
        ...provenanceForNewUser(`${RUN_ID}-wallet-fail@adv.test`),
        email: `${RUN_ID}-wallet-fail@adv.test`,
        phoneNumber: fixturePhone(RUN_ID, "wallet-fail"),
        firstName: "Wallet",
        lastName: "Fail",
        password: await Bun.password.hash("x", { algorithm: "bcrypt", cost: 4 }),
        role: "CUSTOMER",
        isEmailVerified: true,
        walletBalance: 0,
      },
    });

    const topUp = await walletService.addMoney(user.id, 500);
    if (!topUp || "error" in topUp) throw new Error(`addMoney failed: ${JSON.stringify(topUp)}`);
    const txn = await prisma.walletTransaction.findFirstOrThrow({
      where: { userId: user.id, referenceId: topUp.razorpayOrderId },
    });

    const original = financialLedgerService.recordWalletTopUpInTransaction.bind(financialLedgerService);
    financialLedgerService.recordWalletTopUpInTransaction = async () => {
      throw new Error("FORCED_LEDGER_FAILURE");
    };

    let threw = false;
    try {
      await walletService.verifyTopUp(user.id, {
        razorpayOrderId: topUp.razorpayOrderId,
        razorpayPaymentId: `pay_${RUN_ID}-fail`,
        razorpaySignature: "sig",
      });
    } catch {
      threw = true;
    } finally {
      financialLedgerService.recordWalletTopUpInTransaction = original;
    }

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    const txnAfter = await prisma.walletTransaction.findUniqueOrThrow({ where: { id: txn.id } });
    const ledgerEntries = await prisma.journalEntry.count({
      where: { referenceId: txn.id, referenceType: "wallet_transaction" },
    });

    expect(threw).toBe(true);
    expect(after.walletBalance).toBe(0);
    expect(txnAfter.status).toBe(WalletTxnStatus.PENDING);
    expect(ledgerEntries).toBe(0);

    await prisma.walletTransaction.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
  });

  test("wallet duplicate verify is idempotent — balance matches ledger", async () => {
    if (skipIfNoDb()) return;
    // Presence is only a precondition here; heartbeatFresh after the preceding tests tripped the
    // product heartbeat rate limit (429) before the wallet assertion ever ran.
    await keepPresenceFresh(ctx);

    const user = await prisma.user.create({
      data: {
        ...provenanceForNewUser(`${RUN_ID}-wallet-dup@adv.test`),
        email: `${RUN_ID}-wallet-dup@adv.test`,
        phoneNumber: fixturePhone(RUN_ID, "wallet-dup"),
        firstName: "Wallet",
        lastName: "Dup",
        password: await Bun.password.hash("x", { algorithm: "bcrypt", cost: 4 }),
        role: "CUSTOMER",
        isEmailVerified: true,
        walletBalance: 0,
      },
    });

    const topUp = await walletService.addMoney(user.id, 300);
    if (!topUp || "error" in topUp) throw new Error(`addMoney failed: ${JSON.stringify(topUp)}`);
    const body = {
      razorpayOrderId: topUp.razorpayOrderId,
      razorpayPaymentId: `pay_${RUN_ID}-dup`,
      razorpaySignature: "sig",
    };

    const [first, second] = await Promise.all([
      walletService.verifyTopUp(user.id, body),
      walletService.verifyTopUp(user.id, body),
    ]);

    const txn = await prisma.walletTransaction.findFirstOrThrow({
      where: { userId: user.id, referenceId: topUp.razorpayOrderId },
    });
    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    const ledgerEntries = await prisma.journalEntry.count({
      where: { referenceId: txn.id, referenceType: "wallet_transaction" },
    });
    const completed = await prisma.walletTransaction.count({
      where: { userId: user.id, status: WalletTxnStatus.COMPLETED },
    });

    expect(first).not.toHaveProperty("error");
    expect(second).not.toHaveProperty("error");
    expect(after.walletBalance).toBe(300);
    expect(completed).toBe(1);
    expect(ledgerEntries).toBe(1);

    await cleanupWalletTestData(txn.id, user.id);
  });
});

async function cleanupWalletTestData(walletTxnId: string, userId: string) {
  const journals = await prisma.journalEntry.findMany({
    where: { referenceId: walletTxnId, referenceType: "wallet_transaction" },
    select: { id: true },
  });
  const journalIds = journals.map((j) => j.id);
  if (journalIds.length > 0) {
    await prisma.ledgerBalanceSnapshot.deleteMany({ where: { journalId: { in: journalIds } } });
    await prisma.ledgerEntry.deleteMany({ where: { journalId: { in: journalIds } } });
    await prisma.journalEntry.deleteMany({ where: { id: { in: journalIds } } });
  }
  await prisma.walletTransaction.deleteMany({ where: { userId } });
  await prisma.user.delete({ where: { id: userId } });
}
