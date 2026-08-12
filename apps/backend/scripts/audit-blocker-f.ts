import "../src/load-env";
import { prisma } from "../src/__tests__/helpers/adversarial-fixtures";
import { walletService } from "../src/services/wallet.service";
import { financialLedgerService } from "../src/services/financial-ledger.service";

const RUN_ID = `audit-f-${Date.now().toString(36)}`;

const user = await prisma.user.create({
  data: {
    email: `${RUN_ID}@audit.test`,
    phoneNumber: `+9199${RUN_ID.slice(-8)}88`,
    firstName: "W",
    lastName: "A",
    password: await Bun.password.hash("x", { algorithm: "bcrypt", cost: 4 }),
    role: "CUSTOMER",
    isEmailVerified: true,
    walletBalance: 0,
  },
});

const topUp = await walletService.addMoney(user.id, 500);
const txn = await prisma.walletTransaction.findFirstOrThrow({
  where: { userId: user.id, referenceId: topUp!.razorpayOrderId },
});

let spyCalls = 0;
const original = financialLedgerService.recordWalletTopUp.bind(financialLedgerService);
financialLedgerService.recordWalletTopUp = async () => {
  spyCalls += 1;
  throw new Error("FORCED_LEDGER_FAILURE");
};

const verify = await walletService.verifyTopUp(user.id, {
  razorpayOrderId: topUp!.razorpayOrderId,
  razorpayPaymentId: `pay_${RUN_ID}`,
  razorpaySignature: "audit-sig",
});

financialLedgerService.recordWalletTopUp = original;

const afterUser = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
const completedTxns = await prisma.walletTransaction.count({
  where: { userId: user.id, status: "COMPLETED" },
});
const ledgerEntries = await prisma.journalEntry.count({
  where: { referenceId: txn.id, referenceType: "wallet_transaction" },
});
const diverged = afterUser.walletBalance > 0 && ledgerEntries === 0;

console.log(
  JSON.stringify(
    {
      blocker: "F",
      verifyResult: verify,
      walletBalance: afterUser.walletBalance,
      completedWalletTransactions: completedTxns,
      journalEntriesForTxn: ledgerEntries,
      recordWalletTopUpSpyCalls: spyCalls,
      balanceLedgerDiverged: diverged,
    },
    null,
    2,
  ),
);

await prisma.journalEntry.deleteMany({ where: { referenceId: txn.id } });
await prisma.walletTransaction.deleteMany({ where: { userId: user.id } });
await prisma.user.delete({ where: { id: user.id } });
await prisma.$disconnect();
