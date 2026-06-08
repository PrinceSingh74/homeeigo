import prisma from "./prisma";

export async function nextBookingNumber(): Promise<string> {
  const d = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const prefix = `HOMIGO-${d}-`;
  const last = await prisma.booking.findFirst({
    where: { bookingNumber: { startsWith: prefix } },
    orderBy: { bookingNumber: "desc" },
    select: { bookingNumber: true },
  });
  const seq = last ? Number(last.bookingNumber.slice(-5)) + 1 : 1;
  return `${prefix}${String(seq).padStart(5, "0")}`;
}

export async function nextWalletTxnNumber(): Promise<string> {
  const d = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const prefix = `WXN-${d}-`;
  // Parse the 5-digit base sequence robustly — some numbers carry suffixes
  // (e.g. a "-R" recipient row for a P2P transfer), so a naive slice(-5) breaks.
  const rows = await prisma.walletTransaction.findMany({
    where: { transactionNumber: { startsWith: prefix } },
    select: { transactionNumber: true },
  });
  let max = 0;
  for (const r of rows) {
    const m = r.transactionNumber.slice(prefix.length).match(/^(\d{5})/);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}${String(max + 1).padStart(5, "0")}`;
}

export async function nextWithdrawalNumber(): Promise<string> {
  const d = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const prefix = `WD-${d}-`;
  const last = await prisma.withdrawal.findFirst({
    where: { withdrawalNumber: { startsWith: prefix } },
    orderBy: { withdrawalNumber: "desc" },
    select: { withdrawalNumber: true },
  });
  const seq = last ? Number(last.withdrawalNumber.slice(-5)) + 1 : 1;
  return `${prefix}${String(seq).padStart(5, "0")}`;
}
