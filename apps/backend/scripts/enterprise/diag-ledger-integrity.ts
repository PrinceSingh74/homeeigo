import "../../src/load-env";
import prisma from "../../src/lib/prisma";
import { financialTransactionManager } from "../../src/services/financial-transaction-manager.service";

const r = await financialTransactionManager.verifyPaymentLedgerIntegrity(50);
console.log("integrity", r);

for (const id of r.missing) {
  const p = await prisma.payment.findUnique({
    where: { id },
    include: { booking: { select: { bookingNumber: true, finalAmount: true, status: true } } },
  });
  console.log("missing payment", {
    id: p?.id,
    amount: p?.amount,
    status: p?.status,
    method: p?.paymentMethod,
    booking: p?.booking?.bookingNumber,
    bookingStatus: p?.booking?.status,
    createdAt: p?.createdAt,
  });
}

await prisma.$disconnect();
