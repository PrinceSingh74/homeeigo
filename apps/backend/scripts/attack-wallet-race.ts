/**
 * INDEPENDENT P0 attack — wallet double-credit race. Fires N concurrent settle
 * attempts (verifyTopUp + reconcileTopUpFromWebhook) at the SAME top-up and asserts
 * the wallet is credited EXACTLY once. Runs against homigo_test (NODE_ENV=test).
 *
 *   NODE_ENV=test bun run scripts/attack-wallet-race.ts
 */
import "../src/load-env";
import prisma from "../src/lib/prisma";
import { walletService } from "../src/services/wallet.service";

async function attack(N: number): Promise<boolean> {
  const user = await prisma.user.create({
    data: { email: `atk-${N}-${Date.now()}@homigo.test`, phoneNumber: `+9197${(Date.now() % 10000000)}`, firstName: "Atk", lastName: "Race", password: "x".repeat(20), walletBalance: 0 },
  });
  const topUp = await walletService.addMoney(user.id, 500);
  const body = { razorpayOrderId: topUp!.razorpayOrderId, razorpayPaymentId: `pay_atk_${N}_${Date.now()}`, razorpaySignature: "sig" };

  const ops: Promise<unknown>[] = [];
  for (let i = 0; i < N; i++) {
    ops.push(i % 2 === 0 ? walletService.verifyTopUp(user.id, body) : walletService.reconcileTopUpFromWebhook(body.razorpayOrderId, body.razorpayPaymentId));
  }
  const results = await Promise.allSettled(ops);
  const rejected = results.filter((r) => r.status === "rejected").length;

  const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  const txn = await prisma.walletTransaction.findFirstOrThrow({ where: { userId: user.id, referenceId: topUp!.razorpayOrderId } });
  const completed = await prisma.walletTransaction.count({ where: { userId: user.id, status: "COMPLETED" } });
  const journals = await prisma.journalEntry.count({ where: { referenceId: txn.id, referenceType: "wallet_transaction" } });

  const pass = after.walletBalance === 500 && completed === 1 && journals === 1 && rejected === 0;
  console.log(`  N=${String(N).padStart(4)}  walletBalance=${after.walletBalance} (want 500)  completed=${completed} (want 1)  journals=${journals} (want 1)  rejected=${rejected} (want 0)  → ${pass ? "✅ NO double-credit" : "❌ FAIL"}`);

  // No cleanup, deliberately. The credited user, its wallet transaction, the journal, its ledger lines
  // and balance snapshots form one consistent accounting trail on SHARED ledger accounts. The old
  // cleanup deleted the journal first — it only ever failed on its foreign keys (ledger_entries,
  // ledger_balance_snapshots), silently, so the trail survived intact. Deleting any subset breaks the
  // books instead: stripping ledger lines left ORPHAN_JOURNALs, and deleting the user while keeping
  // its lines leaves WALLET_LIABILITY_MISMATCH (both measured on homigo_test, 2026-09-30).
  return pass;
}

async function main() {
  console.log("🔨 Wallet double-credit race attack (isolated homigo_test):");
  let allPass = true;
  for (const N of [50, 100, 250]) {
    allPass = (await attack(N)) && allPass;
  }
  console.log(allPass ? "\n✅ VERIFIED: no double-credit under concurrency" : "\n❌ double-credit reproduced");
  await prisma.$disconnect();
  process.exit(allPass ? 0 : 1);
}
main().catch((e) => { console.error("fatal:", e); process.exit(1); });
