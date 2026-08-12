/**
 * Concurrent money simulation — N parallel wallet credit transactions against
 * one user. Verifies:
 *   1. No lost updates (final balance == sum of credits).
 *   2. Trigger-enforced paise stays exactly ROUND(float*100) under concurrency.
 *   3. wallet_transactions paise rows all match their float rows.
 */
import "../src/load-env";
import prisma from "../src/lib/prisma";

const CONCURRENCY = 200;
const RUN = `msim-${Date.now().toString(36)}`;

async function main() {
  const user = await prisma.user.create({
    data: {
      email: `${RUN}@sim.test`,
      phoneNumber: `+91${String(Date.now()).slice(-10)}`,
      firstName: "Money",
      lastName: "Sim",
      password: "x",
      role: "CUSTOMER",
      walletBalance: 0,
    },
  });

  // Paise-precise random amounts like 123.45
  const amounts = Array.from({ length: CONCURRENCY }, () => Math.round(Math.random() * 99999) / 100);
  const expectedPaise = amounts.reduce((s, a) => s + Math.round(a * 100), 0);

  const started = Date.now();
  await Promise.all(
    amounts.map((amount, i) =>
      prisma.$transaction(async (tx) => {
        const updated = await tx.user.update({
          where: { id: user.id },
          data: { walletBalance: { increment: amount } },
        });
        await tx.walletTransaction.create({
          data: {
            transactionNumber: `${RUN}-${i}`,
            userId: user.id,
            amount,
            walletBalanceBefore: updated.walletBalance - amount,
            walletBalanceAfter: updated.walletBalance,
            type: "CREDIT",
            description: "concurrent money sim",
            status: "COMPLETED",
          },
        });
      }),
    ),
  );
  const elapsed = Date.now() - started;

  const rows = await prisma.$queryRaw<
    Array<{ wallet_balance: number; wallet_balance_paise: bigint; txn_mismatches: bigint; txn_count: bigint }>
  >`
    SELECT u.wallet_balance,
           u.wallet_balance_paise,
           (SELECT COUNT(*) FROM wallet_transactions wt
             WHERE wt.user_id = u.id
               AND wt.amount_paise IS DISTINCT FROM money_to_paise(wt.amount)) AS txn_mismatches,
           (SELECT COUNT(*) FROM wallet_transactions wt WHERE wt.user_id = u.id) AS txn_count
    FROM users u WHERE u.id = ${user.id}`;

  const r = rows[0]!;
  const floatAsPaise = Math.round(r.wallet_balance * 100);
  const paiseDrift = Number(r.wallet_balance_paise) - expectedPaise;
  const floatVsPaise = Number(r.wallet_balance_paise) - floatAsPaise;

  console.log(`concurrent transactions: ${CONCURRENCY} (completed in ${elapsed}ms)`);
  console.log(`expected total paise:    ${expectedPaise}`);
  console.log(`final wallet_balance:    ${r.wallet_balance}`);
  console.log(`final paise column:      ${r.wallet_balance_paise}`);
  console.log(`paise vs expected drift: ${paiseDrift}`);
  console.log(`paise vs float drift:    ${floatVsPaise}`);
  console.log(`txn rows: ${r.txn_count}, paise mismatches: ${r.txn_mismatches}`);

  await prisma.walletTransaction.deleteMany({ where: { userId: user.id } });
  await prisma.user.delete({ where: { id: user.id } });

  const pass =
    paiseDrift === 0 && floatVsPaise === 0 && Number(r.txn_mismatches) === 0 && Number(r.txn_count) === CONCURRENCY;
  console.log(pass ? "VERDICT: PASS — zero drift under concurrency" : "VERDICT: FAIL");
  process.exit(pass ? 0 : 1);
}

main().finally(() => prisma.$disconnect());
