import type { Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import { financialLedgerService, type LedgerJournalInput } from "./financial-ledger.service";

/**
 * Guarantees DB state and ledger journal are committed atomically.
 * If ledger write fails, the entire transaction rolls back.
 */
export class FinancialTransactionManager {
  async executeWithLedger<T>(opts: {
    journal: LedgerJournalInput;
    mutate: (tx: Prisma.TransactionClient) => Promise<T>;
  }): Promise<T> {
    return prisma.$transaction(async (tx) => {
      const existing = await tx.journalEntry.findUnique({
        where: { idempotencyKey: opts.journal.idempotencyKey },
      });

      const result = await opts.mutate(tx);

      if (!existing) {
        await financialLedgerService.recordJournalInTransaction(tx, opts.journal);
      }

      return result;
    });
  }

  /** Verify every successful payment has a matching ledger journal. */
  async verifyPaymentLedgerIntegrity(limit = 100): Promise<{ ok: number; missing: string[] }> {
    const payments = await prisma.payment.findMany({
      where: { status: "SUCCESS" },
      select: { id: true },
      take: limit,
      orderBy: { createdAt: "desc" },
    });

    const missing: string[] = [];
    let ok = 0;

    for (const p of payments) {
      const journal = await prisma.journalEntry.findFirst({
        where: { idempotencyKey: `booking_payment:${p.id}` },
      });
      if (journal) ok += 1;
      else missing.push(p.id);
    }

    return { ok, missing };
  }
}

export const financialTransactionManager = new FinancialTransactionManager();
