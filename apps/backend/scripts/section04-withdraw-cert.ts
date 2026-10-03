/**
 * Section 04 withdrawal / wallet integrity cert (avoids bun:test segfault).
 * Usage: bun --env-file=.env.test run scripts/section04-withdraw-cert.ts
 */
import "../src/load-env";
import prisma from "../src/lib/prisma";
import { providerWalletReservationService } from "../src/services/provider-wallet-reservation.service";
import {
  seedAdversarialFixtures,
  cleanupAdversarialFixtures,
} from "../src/__tests__/helpers/adversarial-fixtures";

const RUN_ID = `s04-wd-${Date.now().toString(36)}`;
let failed = 0;

function gate(name: string, ok: boolean, detail = "") {
  if (ok) console.log(`PASS  ${name}${detail ? ` — ${detail}` : ""}`);
  else {
    failed += 1;
    console.error(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function main() {
  const ctx = await seedAdversarialFixtures(RUN_ID);
  await prisma.provider.update({
    where: { id: ctx.providerId },
    data: { walletBalance: 500, walletBalancePaise: 50000n, reservedBalance: 0 },
  });

  const beforeBal = 500;
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

  gate("withdraw.idempotent_key", "withdrawal" in first && "withdrawal" in second);
  if ("withdrawal" in first && "withdrawal" in second) {
    gate("withdraw.same_row", second.withdrawal.id === first.withdrawal.id);
  }
  for (const r of parallel) {
    if ("withdrawal" in r && "withdrawal" in first) {
      gate("withdraw.parallel_same", r.withdrawal.id === first.withdrawal.id);
    }
  }
  const count = await prisma.withdrawal.count({ where: { providerId: ctx.providerId, idempotencyKey: key } });
  gate("withdraw.single_row", count === 1, `count=${count}`);

  const over = await providerWalletReservationService.reserveAndCreateWithdrawal(ctx.providerId, {
    amount: 50_000,
    bankAccountNumber: "123456789012",
    ifscCode: "HDFC0001234",
    accountHolder: "Section04",
  });
  gate("withdraw.over_balance_rejected", "error" in over);

  const zero = await providerWalletReservationService.reserveAndCreateWithdrawal(ctx.providerId, {
    amount: 0,
    bankAccountNumber: "123456789012",
    ifscCode: "HDFC0001234",
    accountHolder: "Section04",
  });
  gate("withdraw.zero_rejected", "error" in zero);

  const wrongPartner = await providerWalletReservationService.reserveAndCreateWithdrawal("nonexistent-provider", body);
  gate("withdraw.bad_provider", "error" in wrongPartner);

  const afterProvider = await prisma.provider.findUniqueOrThrow({
    where: { id: ctx.providerId },
    select: { walletBalance: true, reservedBalance: true },
  });
  gate(
    "withdraw.balance_integrity",
    afterProvider.walletBalance <= beforeBal && afterProvider.reservedBalance >= 0,
    `wallet=${afterProvider.walletBalance} reserved=${afterProvider.reservedBalance}`,
  );

  await prisma.withdrawal.deleteMany({ where: { providerId: ctx.providerId } });
  await cleanupAdversarialFixtures(RUN_ID);
  await prisma.$disconnect();

  console.log(failed === 0 ? "\nSECTION 04 WITHDRAW CERT: FULL PASS" : `\nSECTION 04 WITHDRAW CERT: FAIL (${failed})`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
