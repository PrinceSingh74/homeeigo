/**
 * Production blocker final — execution proof for ledger, atomic writes, paise drift.
 */
import "../load-env";
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { HCoinTxnType, WalletTxnStatus } from "@prisma/client";
import {
  prisma,
  dbReachable,
  fixturePhone,
} from "./helpers/adversarial-fixtures";
import { ledgerReconciliationService } from "../services/ledger-reconciliation.service";
import { financialIntegrityService } from "../services/financial-integrity.service";
import { observabilityService } from "../services/observability.service";
import { hcoinService } from "../services/hcoin.service";
import { financialLedgerService } from "../services/financial-ledger.service";
import { walletService } from "../services/wallet.service";
import { rupeesToPaise, addPaise } from "../lib/money-paise";

const RUN_ID = `pbf-${Date.now().toString(36)}`;
let dbOk = false;

beforeAll(async () => {
  dbOk = await dbReachable();
  if (dbOk) {
    await ledgerReconciliationService.reconcile({ backfillLimit: 3000 });
  }
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe.serial("Production blocker final", () => {
  test("ledger reconciliation achieves zero adjustable delta", async () => {
    if (!dbOk) return;

    const result = await ledgerReconciliationService.reconcile({ backfillLimit: 3000 });
    const adjustable = result.final.filter((r) =>
      ["CUSTOMER_WALLET", "PROVIDER_PAYABLE", "HCOIN_LIABILITY", "PLATFORM_ESCROW"].includes(
        r.ledgerAccount,
      ),
    );
    for (const r of adjustable) {
      expect(Math.abs(r.delta)).toBeLessThanOrEqual(0.01);
    }

    const integrity = await financialIntegrityService.validate();
    const liabilityIssues = integrity.issues.filter((i) =>
      ["WALLET_LIABILITY_MISMATCH", "PROVIDER_PAYABLE_MISMATCH"].includes(i.category),
    );
    expect(liabilityIssues.length).toBe(0);
  }, 120_000);

  test("finance dashboard healthy after reconciliation", async () => {
    if (!dbOk) return;
    const dash = await observabilityService.getHealthDashboard();
    expect(dash.serviceHealth.finance.status).toBe("healthy");
    expect(dash.serviceHealth.database.status).toBe("healthy");
  });

  test("hcoin earn rolls back when ledger write fails", async () => {
    if (!dbOk) return;

    const user = await prisma.user.create({
      data: {
        email: `${RUN_ID}-hcoin-fail@adv.test`,
        phoneNumber: fixturePhone(RUN_ID, "hcoin-fail"),
        firstName: "H",
        lastName: "Fail",
        password: await Bun.password.hash("x", { algorithm: "bcrypt", cost: 4 }),
        role: "CUSTOMER",
        isEmailVerified: true,
      },
    });

    const original = financialLedgerService.recordHcoinEarnedInTransaction.bind(financialLedgerService);
    financialLedgerService.recordHcoinEarnedInTransaction = async () => {
      throw new Error("FORCED_LEDGER_FAILURE");
    };

    let threw = false;
    try {
      await hcoinService.earn(user.id, "BOOKING_COMPLETED", `ref-${RUN_ID}`);
    } catch {
      threw = true;
    } finally {
      financialLedgerService.recordHcoinEarnedInTransaction = original;
    }

    const wallet = await prisma.hCoinWallet.findUnique({ where: { userId: user.id } });
    const txns = await prisma.hCoinTransaction.count({ where: { userId: user.id } });
    expect(threw).toBe(true);
    expect(wallet).toBeNull();
    expect(txns).toBe(0);

    await prisma.user.delete({ where: { id: user.id } });
  });

  test("wallet top-up rolls back when ledger fails", async () => {
    if (!dbOk) return;

    const user = await prisma.user.create({
      data: {
        email: `${RUN_ID}-wallet-atomic@adv.test`,
        phoneNumber: fixturePhone(RUN_ID, "wallet-atomic"),
        firstName: "W",
        lastName: "Atomic",
        password: await Bun.password.hash("x", { algorithm: "bcrypt", cost: 4 }),
        role: "CUSTOMER",
        isEmailVerified: true,
        walletBalance: 0,
        walletBalancePaise: 0n,
      },
    });

    const topUp = await walletService.addMoney(user.id, 200);
    expect("razorpayOrderId" in topUp).toBe(true);

    const original = financialLedgerService.recordWalletTopUpInTransaction.bind(financialLedgerService);
    financialLedgerService.recordWalletTopUpInTransaction = async () => {
      throw new Error("FORCED_LEDGER_FAILURE");
    };

    let threw = false;
    try {
      await walletService.verifyTopUp(user.id, {
        razorpayOrderId: (topUp as { razorpayOrderId: string }).razorpayOrderId,
        razorpayPaymentId: `pay_${RUN_ID}`,
        razorpaySignature: "sig",
      });
    } catch {
      threw = true;
    } finally {
      financialLedgerService.recordWalletTopUpInTransaction = original;
    }

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(threw).toBe(true);
    expect(after.walletBalance).toBe(0);
    expect(after.walletBalancePaise).toBe(0n);

    const txn = await prisma.walletTransaction.findFirst({
      where: { userId: user.id, referenceType: "razorpay_order" },
    });
    expect(txn?.status).toBe(WalletTxnStatus.PENDING);

    await prisma.walletTransaction.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
  });

  test("1M paise accumulation — zero drift", () => {
    let paise = 0n;
    for (let i = 0; i < 1_000_000; i++) {
      paise = addPaise(paise, rupeesToPaise(0.01));
    }
    expect(paise).toBe(1_000_000n);
    expect(Number(paise) / 100).toBe(10_000);
  });
});
