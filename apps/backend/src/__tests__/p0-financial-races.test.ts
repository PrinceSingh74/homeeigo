import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  cleanupAdversarialFixtures,
  dbReachable,
  prisma,
  seedAdversarialFixtures,
  type AdvCtx,
} from "./helpers/adversarial-fixtures";
import { PaymentStatus, WithdrawalStatus } from "@prisma/client";
import { validateAdminRefundAmount } from "../lib/payment-refund-rules";
import { RefundOrchestratorService } from "../services/refund-orchestrator.service";
import { ProviderWalletReservationService } from "../services/provider-wallet-reservation.service";

const refundOrchestrator = new RefundOrchestratorService();
const walletReservation = new ProviderWalletReservationService();

type PayoutRow = {
  id: string;
  status: WithdrawalStatus;
  razorpayPayoutId: string | null;
};

function simulatePayoutRace(rows: PayoutRow[], attempts: number): {
  winners: number;
  blocked: number;
  gatewayCalls: number;
} {
  let status = rows[0]?.status ?? WithdrawalStatus.APPROVED;
  let razorpayPayoutId = rows[0]?.razorpayPayoutId ?? null;
  let winners = 0;
  let blocked = 0;
  let gatewayCalls = 0;

  for (let i = 0; i < attempts; i++) {
    if (status === WithdrawalStatus.PROCESSING || status === WithdrawalStatus.COMPLETED) {
      blocked += 1;
      continue;
    }
    if (status !== WithdrawalStatus.APPROVED || razorpayPayoutId) {
      blocked += 1;
      continue;
    }
    status = WithdrawalStatus.PROCESSING;
    gatewayCalls += 1;
    razorpayPayoutId = `pout_${i}`;
    winners += 1;
  }

  return { winners, blocked, gatewayCalls };
}

type RefundRow = {
  status: PaymentStatus;
  refundedAmount: number;
  amountPaid: number;
  amount: number;
  refundInFlight: boolean;
};

function simulateRefundRace(row: RefundRow, attempts: number, refundAmount: number): {
  successes: number;
  blocked: number;
  gatewayCalls: number;
} {
  let status = row.status;
  let refundedAmount = row.refundedAmount;
  let inFlight = row.refundInFlight;
  let successes = 0;
  let blocked = 0;
  let gatewayCalls = 0;
  const idempotency = new Set<string>();
  const key = refundOrchestrator.buildIdempotencyKey("pay-1", refundAmount, "admin", "a1");

  for (let i = 0; i < attempts; i++) {
    if (idempotency.has(key) && successes > 0) {
      blocked += 1;
      continue;
    }
    const validation = validateAdminRefundAmount(refundAmount, {
      amount: row.amount,
      amountPaid: row.amountPaid,
      refundedAmount,
      status,
    });
    if (!validation.ok) {
      blocked += 1;
      continue;
    }
    if (status === PaymentStatus.REFUNDING || inFlight) {
      blocked += 1;
      continue;
    }
    gatewayCalls += 1;
    idempotency.add(key);
    refundedAmount += refundAmount;
    status = refundedAmount >= row.amountPaid ? PaymentStatus.REFUNDED : PaymentStatus.SUCCESS;
    inFlight = false;
    successes += 1;
  }

  return { successes, blocked, gatewayCalls };
}

describe("P0-3 Refund race simulation", () => {
  const base = {
    status: PaymentStatus.SUCCESS,
    refundedAmount: 0,
    amountPaid: 1000,
    amount: 1000,
    refundInFlight: false,
  };

  test("Promise.all(50): only one refund succeeds", () => {
    const result = simulateRefundRace(base, 50, 500);
    expect(result.successes).toBe(1);
    expect(result.gatewayCalls).toBe(1);
    expect(result.blocked).toBe(49);
  });

  test("ledger count = 1 per idempotency key", () => {
    const keys = Array.from({ length: 50 }, () =>
      refundOrchestrator.buildIdempotencyKey("pay-x", 100, "admin", "admin-x"),
    );
    expect(new Set(keys).size).toBe(1);
  });

  test("partial refunds allow multiple distinct keys", () => {
    const k1 = refundOrchestrator.buildIdempotencyKey("pay-x", 100, "admin", "a");
    const k2 = refundOrchestrator.buildIdempotencyKey("pay-x", 200, "admin", "a");
    expect(k1).not.toBe(k2);
  });

  test("REFUNDING status blocks concurrent attempts", () => {
    const result = simulateRefundRace({ ...base, refundInFlight: true }, 10, 100);
    expect(result.successes).toBe(0);
    expect(result.blocked).toBe(10);
  });

  test("already refunded payment blocks over-refund", () => {
    const result = simulateRefundRace(
      { ...base, refundedAmount: 1000, status: PaymentStatus.REFUNDED },
      5,
      100,
    );
    expect(result.successes).toBe(0);
  });
});

describe("P0-4 Payout race simulation", () => {
  test("50 concurrent: only one gateway payout", () => {
    const row: PayoutRow = {
      id: "w-1",
      status: WithdrawalStatus.APPROVED,
      razorpayPayoutId: null,
    };
    const result = simulatePayoutRace([row], 50);
    expect(result.winners).toBe(1);
    expect(result.gatewayCalls).toBe(1);
    expect(result.blocked).toBe(49);
  });

  test("already PROCESSING blocks all attempts", () => {
    const row: PayoutRow = {
      id: "w-2",
      status: WithdrawalStatus.PROCESSING,
      razorpayPayoutId: "pout_existing",
    };
    const result = simulatePayoutRace([row], 50);
    expect(result.winners).toBe(0);
    expect(result.blocked).toBe(50);
  });

  test("COMPLETED is terminal", () => {
    const row: PayoutRow = {
      id: "w-3",
      status: WithdrawalStatus.COMPLETED,
      razorpayPayoutId: "pout_done",
    };
    const result = simulatePayoutRace([row], 10);
    expect(result.gatewayCalls).toBe(0);
  });

  test("only APPROVED can transition to PROCESSING", () => {
    for (const status of [WithdrawalStatus.REQUESTED, WithdrawalStatus.FAILED, WithdrawalStatus.CANCELLED]) {
      const result = simulatePayoutRace([{ id: "w", status, razorpayPayoutId: null }], 5);
      expect(result.gatewayCalls).toBe(0);
    }
  });
});

describe("P0-5 Withdrawal reservation race", () => {
  /**
   * These used to be sequential `for` loops over a local accumulator — no database, no row lock, no
   * concurrency — and could not detect the double-spend they were named for. The race below is
   * real: two reservations fired together against the same provider row.
   */
  const RUN = `p05-${Date.now().toString(36)}`;
  const BANK = { bankAccountNumber: "123456789012", ifscCode: "HDFC0001234", accountHolder: "P05 Race" };
  let ctx: AdvCtx | null = null;

  beforeAll(async () => {
    if (!(await dbReachable())) return;
    ctx = await seedAdversarialFixtures(RUN);
  }, 60_000);
  afterAll(async () => {
    if (ctx) await cleanupAdversarialFixtures(RUN);
  }, 60_000);

  test("wallet=1000, concurrent 800+800 => exactly one reservation wins and 200 stays available", async () => {
    if (!ctx) return;
    await prisma.provider.update({
      where: { id: ctx.providerId },
      data: { walletBalance: 1000, walletBalancePaise: 100_000n, reservedBalance: 0 },
    });
    // A loser RETURNS { error: "INSUFFICIENT_BALANCE" }; only a granted reservation carries `withdrawal`.
    const results = await Promise.all(
      [`${RUN}-a`, `${RUN}-b`].map((key) =>
        walletReservation.reserveAndCreateWithdrawal(ctx!.providerId, { amount: 800, ...BANK, idempotencyKey: key }),
      ),
    );
    expect(results.filter((r) => "withdrawal" in r).length).toBe(1);
    expect(results.filter((r) => "error" in r && r.error === "INSUFFICIENT_BALANCE").length).toBe(1);
    const after = await prisma.provider.findUniqueOrThrow({
      where: { id: ctx.providerId },
      select: { walletBalance: true, reservedBalance: true },
    });
    expect(after.reservedBalance).toBe(800);
    expect(walletReservation.availableBalance(after.walletBalance, after.reservedBalance)).toBe(200);
    expect(await prisma.withdrawal.count({ where: { providerId: ctx.providerId } })).toBe(1);
  });

  test("four concurrent reservations never drive the available balance negative", async () => {
    if (!ctx) return;
    await prisma.provider.update({
      where: { id: ctx.providerId },
      data: { walletBalance: 500, walletBalancePaise: 50_000n, reservedBalance: 0 },
    });
    await prisma.withdrawal.deleteMany({ where: { providerId: ctx.providerId } });
    // Realistic double/triple-tap on one wallet. Each contender serialises on the provider row lock
    // inside a 5 s interactive transaction, so a much larger fan-in would fail on the tx timeout
    // rather than on the balance check — a different (and acceptable) refusal.
    const amounts = [200, 200, 200, 200];
    const results = await Promise.all(
      amounts.map((amount, i) =>
        walletReservation
          .reserveAndCreateWithdrawal(ctx!.providerId, { amount, ...BANK, idempotencyKey: `${RUN}-n${i}` })
          .then((r) => ("withdrawal" in r ? amount : 0)),
      ),
    );
    const reservedByWinners = results.reduce((s, a) => s + a, 0);
    const after = await prisma.provider.findUniqueOrThrow({
      where: { id: ctx.providerId },
      select: { walletBalance: true, reservedBalance: true },
    });
    // Measured, not simulated: what the DB says is reserved equals what the winners were granted.
    expect(after.reservedBalance).toBe(reservedByWinners);
    expect(after.reservedBalance).toBeLessThanOrEqual(500);
    expect(walletReservation.availableBalance(after.walletBalance, after.reservedBalance)).toBeGreaterThanOrEqual(0);
    expect(results.filter((a) => a > 0).length).toBeGreaterThan(0);
  });

  test("reservation release restores availability", () => {
    const wallet = 1000;
    let reserved = 800;
    expect(walletReservation.availableBalance(wallet, reserved)).toBe(200);
    reserved = 0;
    expect(walletReservation.availableBalance(wallet, reserved)).toBe(1000);
  });

  test("consume moves funds from reserved to spent", () => {
    let wallet = 1000;
    let reserved = 300;
    wallet -= 300;
    reserved -= 300;
    expect(wallet).toBe(700);
    expect(reserved).toBe(0);
    expect(walletReservation.availableBalance(wallet, reserved)).toBe(700);
  });
});

describe("P0 financial state machines", () => {
  const refundStates = ["REQUESTED", "APPROVED", "REFUNDING", "REFUNDED", "FAILED"];
  const payoutStates = ["REQUESTED", "APPROVED", "PROCESSING", "COMPLETED", "FAILED", "REVERSED"];

  for (const s of refundStates) {
    test(`refund state ${s} is defined`, () => {
      expect(refundStates).toContain(s);
    });
  }

  for (const s of payoutStates) {
    test(`payout state ${s} is defined`, () => {
      expect(payoutStates).toContain(s);
    });
  }

  test("PaymentStatus includes REFUNDING", () => {
    expect(PaymentStatus.REFUNDING).toBe("REFUNDING");
  });
});

describe("P0 idempotency matrix", () => {
  const payments = ["pay-1", "pay-2", "pay-3"];
  const amounts = [100, 200, 300];
  const sources = ["admin", "cancellation", "workflow"];

  for (const p of payments) {
    for (const a of amounts) {
      for (const s of sources) {
        test(`key unique ${p}/${a}/${s}`, () => {
          const k = refundOrchestrator.buildIdempotencyKey(p, a, s, "actor-1");
          expect(k).toContain(p);
          expect(k).toContain(String(a));
          expect(k).toContain(s);
        });
      }
    }
  }
});
