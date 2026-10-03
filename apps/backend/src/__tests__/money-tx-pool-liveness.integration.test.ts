/**
 * A serialised money operation must still let ONE caller through when callers outnumber the pool.
 *
 * Found by the coding-phase operational certification (2026-09-27, chaos 7J / K1+K3): eight concurrent
 * full-balance referral withdrawals — and eight concurrent full H-Coin redemptions — produced ZERO
 * successes. Nothing was paid twice (the per-user serialisation held), but nobody was paid at all.
 *
 * Cause: inside the serialising transaction, `nextWalletTxnNumber()` was called WITHOUT `tx`, so it
 * asked the pool for a second connection. With the test pool's five connections all held by
 * transactions queued on the same user's lock, the lock holder waited for a connection that could only
 * be freed by itself — every transaction then died at the interactive-transaction timeout. Most
 * callers already pass `tx`; four did not (referral, H-Coin, financial adjustment, partner incentive
 * payout). The database URL's `connection_limit=5` is what makes this reproducible here.
 *
 *   cd apps/backend
 *   bun test "D:/homigo/apps/backend/src/__tests__/money-tx-pool-liveness.integration.test.ts" --timeout 180000
 */
import "../load-env";
import { describe, expect, test } from "bun:test";
import prisma from "../lib/prisma";
import { provenanceForNewUser } from "../lib/data-provenance";
import { referralService } from "../services/referral.service";
import { hcoinService } from "../services/hcoin.service";

const rnd = () => Math.random().toString(36).slice(2, 8);
const CONCURRENCY = 8;

async function user(tag: string) {
  const email = `mtl-${tag}-${Date.now()}-${rnd()}@test.test`;
  return prisma.user.create({
    data: {
      ...provenanceForNewUser(email),
      email,
      phoneNumber: `+9171${Math.floor(1e7 + Math.random() * 8e7)}`,
      firstName: "Mtl",
      lastName: tag,
      password: "x".repeat(20),
      role: "CUSTOMER",
      walletBalance: 0,
    } as never,
  });
}

const walletPaise = async (userId: string) =>
  Number((await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { walletBalancePaise: true } })).walletBalancePaise);

const settle = <T>(ps: Promise<T>[]) => Promise.all(ps.map((p) => p.then((v) => ({ value: v as unknown }), (e) => ({ thrown: String(e).slice(0, 120) }))));

describe("concurrent full-balance money operations: exactly one succeeds", () => {
  test(`referral withdrawal × ${CONCURRENCY}: one credit, the rest refused, nothing thrown`, async () => {
    const referrer = await user("ref");
    const referee = await user("peer");
    const txn = await prisma.referralTransaction.create({
      data: { referrerId: referrer.id, refereeId: referee.id, code: `MTL${rnd()}`.slice(0, 12), status: "QUALIFIED", qualifiedAt: new Date() },
      select: { id: true },
    });
    await prisma.referralCommission.create({
      data: { referrerId: referrer.id, refereeId: referee.id, transactionId: txn.id, bookingId: `mtl-${rnd()}`, amount: 300, status: "APPROVED" },
    });
    const before = await walletPaise(referrer.id);

    const results = await settle(Array.from({ length: CONCURRENCY }, () => referralService.withdraw(referrer.id, 300)));
    const ok = results.filter((r) => "value" in r && (r.value as { ok?: boolean }).ok === true).length;
    const insufficient = results.filter((r) => "value" in r && (r.value as { error?: string }).error === "INSUFFICIENT_BALANCE").length;
    const thrown = results.filter((r) => "thrown" in r).map((r) => (r as { thrown: string }).thrown);

    expect(thrown).toEqual([]);
    expect(ok).toBe(1);
    expect(insufficient).toBe(CONCURRENCY - 1);
    expect((await walletPaise(referrer.id)) - before).toBe(30_000);
    expect(await prisma.referralWithdrawal.count({ where: { userId: referrer.id } })).toBe(1);
  }, 180_000);

  test(`H-Coin redemption × ${CONCURRENCY}: one credit, the rest refused, nothing thrown`, async () => {
    const u = await user("coin");
    await prisma.hCoinWallet.create({ data: { userId: u.id, balance: 500, lifetimeEarned: 500 } });
    const before = await walletPaise(u.id);

    const results = await settle(Array.from({ length: CONCURRENCY }, () => hcoinService.redeem(u.id, 500)));
    const ok = results.filter((r) => "value" in r && (r.value as { ok?: boolean }).ok === true).length;
    const thrown = results.filter((r) => "thrown" in r).map((r) => (r as { thrown: string }).thrown);

    expect(thrown).toEqual([]);
    expect(ok).toBe(1);
    const coins = (await prisma.hCoinWallet.findUniqueOrThrow({ where: { userId: u.id }, select: { balance: true } })).balance;
    expect(coins).toBe(0);
    expect((await walletPaise(u.id)) - before).toBeGreaterThan(0);
  }, 180_000);
});
