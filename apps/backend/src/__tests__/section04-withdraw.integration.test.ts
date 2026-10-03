import "../load-env";
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import {
  prisma,
  dbReachable,
  seedAdversarialFixtures,
  cleanupAdversarialFixtures,
  type AdvCtx,
} from "./helpers/adversarial-fixtures";
import { providerWalletReservationService } from "../services/provider-wallet-reservation.service";

const RUN_ID = `s04-wd-${Date.now().toString(36)}`;
let ctx: AdvCtx;
let dbOk = false;

beforeAll(async () => {
  dbOk = await dbReachable();
  if (!dbOk) return;
  ctx = await seedAdversarialFixtures(RUN_ID);
  await prisma.provider.update({
    where: { id: ctx.providerId },
    data: { walletBalance: 500, walletBalancePaise: 50000n, reservedBalance: 0 },
  });
}, 60_000);

afterAll(async () => {
  if (!dbOk) return;
  await prisma.withdrawal.deleteMany({ where: { providerId: ctx.providerId } });
  await cleanupAdversarialFixtures(RUN_ID);
}, 60_000);

function skipIfNoDb() {
  if (!dbOk) {
    console.warn("SKIP: PostgreSQL unreachable");
    return true;
  }
  return false;
}

describe.serial("Section 04 withdrawal idempotency", () => {
  test("same idempotency key creates one withdrawal", async () => {
    if (skipIfNoDb()) return;
    const key = `wd-${RUN_ID}`;
    const body = {
      amount: 50,
      bankAccountNumber: "123456789012",
      ifscCode: "HDFC0001234",
      accountHolder: "Section04",
      idempotencyKey: key,
    };
    const first = await providerWalletReservationService.reserveAndCreateWithdrawal(ctx.providerId, body);
    const second = await providerWalletReservationService.reserveAndCreateWithdrawal(ctx.providerId, body);
    const parallel = await Promise.all([
      providerWalletReservationService.reserveAndCreateWithdrawal(ctx.providerId, body),
      providerWalletReservationService.reserveAndCreateWithdrawal(ctx.providerId, body),
    ]);
    expect("withdrawal" in first).toBe(true);
    expect("withdrawal" in second).toBe(true);
    if ("withdrawal" in first && "withdrawal" in second) {
      expect(second.withdrawal.id).toBe(first.withdrawal.id);
    }
    for (const r of parallel) {
      expect("withdrawal" in r).toBe(true);
      if ("withdrawal" in r && "withdrawal" in first) expect(r.withdrawal.id).toBe(first.withdrawal.id);
    }
    const count = await prisma.withdrawal.count({ where: { providerId: ctx.providerId, idempotencyKey: key } });
    expect(count).toBe(1);
  });

  test("amount above available is rejected", async () => {
    if (skipIfNoDb()) return;
    const result = await providerWalletReservationService.reserveAndCreateWithdrawal(ctx.providerId, {
      amount: 50_000,
      bankAccountNumber: "123456789012",
      ifscCode: "HDFC0001234",
      accountHolder: "Section04",
    });
    expect("error" in result).toBe(true);
  });
});
