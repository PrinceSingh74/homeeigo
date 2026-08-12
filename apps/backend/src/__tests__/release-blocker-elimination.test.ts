/**
 * Release blocker elimination — PostgreSQL + production services.
 */
import "../load-env";
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { WalletTxnStatus } from "@prisma/client";
import {
  prisma,
  dbReachable,
  seedAdversarialFixtures,
  cleanupAdversarialFixtures,
  deleteBookingsForUsers,
  fixturePhone,
  futureSlot,
  type AdvCtx,
} from "./helpers/adversarial-fixtures";
import { bookingService } from "../services/booking.service";
import { walletService } from "../services/wallet.service";
import { financialLedgerService } from "../services/financial-ledger.service";

const RUN_ID = `rbe-${Date.now().toString(36)}`;
let ctx: AdvCtx;
let dbOk = false;

beforeAll(async () => {
  process.env.NODE_ENV = "development";
  dbOk = await dbReachable();
  if (!dbOk) return;
  ctx = await seedAdversarialFixtures(RUN_ID);
});

afterAll(async () => {
  if (dbOk) await cleanupAdversarialFixtures(RUN_ID);
  await prisma.$disconnect();
});

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
  const results = await Promise.all(
    customers.map((c) =>
      bookingService.create(c.userId, {
        serviceId: ctx.serviceId,
        providerId: ctx.providerId,
        scheduledDate: slot.toISOString(),
        addressId: c.addressId,
      }),
    ),
  );
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

    const targetSlot = futureSlot(150);
    await cleanProviderSlot(ctx.providerId, targetSlot);

    const customers = await seedCustomers(50, "upd-race");
    try {
      const farSlots = customers.map(
        (_, i) => new Date(targetSlot.getTime() + (i + 2) * 4 * 3_600_000),
      );
      const bookingIds: string[] = [];

      for (let i = 0; i < customers.length; i++) {
        const created = await bookingService.create(customers[i]!.userId, {
          serviceId: ctx.serviceId,
          providerId: ctx.providerId,
          scheduledDate: farSlots[i]!.toISOString(),
          addressId: customers[i]!.addressId,
        });
        expect("booking" in created).toBe(true);
        bookingIds.push(created.booking!.id);
      }

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

    const user = await prisma.user.create({
      data: {
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

    const user = await prisma.user.create({
      data: {
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

    const user = await prisma.user.create({
      data: {
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
