import { prisma } from "../lib/prisma";
import { WalletTransferStatus, WalletTxnType, WalletTxnStatus } from "@prisma/client";
import { nextWalletTxnNumber } from "../lib/booking-number";
import { OTPService } from "./otp.service";
import { financialLedgerService } from "./financial-ledger.service";
import { AuditLogService } from "./audit-log.service";
import { recordFinancialMetric } from "../lib/financial-metrics";
import { userPiiService } from "./user-pii.service";

const otpService = new OTPService(prisma);

/** Transfer guardrails (business rules). */
export const TRANSFER_MIN = 1;
export const TRANSFER_MAX_PER_TXN = 10000;
export const TRANSFER_MAX_DAILY = 50000;

function maskName(first: string | null, last: string | null, email: string | null): string {
  const name = [first, last].filter(Boolean).join(" ");
  return name || email || "HOMEEIGO user";
}

export class TransferService {
  /** Resolve a recipient by phone, email, or referral code. */
  private async resolveRecipient(identifier: string) {
    const id = identifier.trim();
    return (
      (await userPiiService.findByPhone(id)) ??
      (await userPiiService.findByEmail(id)) ??
      (await prisma.user.findUnique({ where: { referralCode: id.toUpperCase() } }))
    );
  }

  private async dailyTransferred(senderId: string): Promise<number> {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const agg = await prisma.walletTransfer.aggregate({
      where: { senderId, status: WalletTransferStatus.COMPLETED, completedAt: { gte: start } },
      _sum: { amount: true },
    });
    return agg._sum.amount ?? 0;
  }

  /**
   * Validate + create a PENDING transfer and send an OTP to the sender's phone.
   * Money is NOT moved until confirm().
   */
  async initiate(
    senderId: string,
    identifier: string,
    amount: number,
    note?: string,
  ): Promise<
    | { ok: true; transferId: string; recipient: string; otpSent: boolean; devOtp?: string }
    | { error: string }
  > {
    if (!Number.isFinite(amount) || amount < TRANSFER_MIN) return { error: "INVALID_AMOUNT" };
    if (amount > TRANSFER_MAX_PER_TXN) return { error: "EXCEEDS_TXN_LIMIT" };

    const sender = await prisma.user.findUnique({ where: { id: senderId } });
    if (!sender) return { error: "NOT_FOUND" };
    if (sender.walletBalance < amount) return { error: "INSUFFICIENT_BALANCE" };

    const recipient = await this.resolveRecipient(identifier);
    if (!recipient) return { error: "RECIPIENT_NOT_FOUND" };
    if (recipient.id === senderId) return { error: "CANNOT_SEND_TO_SELF" };

    const daily = await this.dailyTransferred(senderId);
    if (daily + amount > TRANSFER_MAX_DAILY) return { error: "EXCEEDS_DAILY_LIMIT" };

    // Clean up any stale pending transfers for this sender to avoid pile-up.
    await prisma.walletTransfer.updateMany({
      where: { senderId, status: WalletTransferStatus.PENDING },
      data: { status: WalletTransferStatus.CANCELLED },
    });

    const transfer = await prisma.walletTransfer.create({
      data: {
        senderId,
        recipientId: recipient.id,
        amount,
        note: note?.slice(0, 140),
        status: WalletTransferStatus.PENDING,
      },
    });

    const senderPhone = await userPiiService.resolvePhone(sender, { actorId: sender.id, authorized: true });
    if (!senderPhone) return { error: "SENDER_PHONE_MISSING" };
    const recipientEmail = await userPiiService.resolveEmail(recipient, { actorId: recipient.id, authorized: true });
    const otp = await otpService.sendOTP(senderPhone, sender.id);
    return {
      ok: true,
      transferId: transfer.id,
      recipient: maskName(recipient.firstName, recipient.lastName, recipientEmail ?? recipient.id),
      otpSent: otp.success,
      ...("devOtp" in otp && otp.devOtp ? { devOtp: otp.devOtp } : {}),
    };
  }

  /** Verify the sender's OTP and atomically move the money. */
  async confirm(
    senderId: string,
    transferId: string,
    otp: string,
  ): Promise<{ ok: true; amount: number; recipient: string; senderBalance: number } | { error: string }> {
    const transfer = await prisma.walletTransfer.findFirst({ where: { id: transferId, senderId } });
    if (!transfer) return { error: "NOT_FOUND" };
    if (transfer.status === WalletTransferStatus.COMPLETED) return { error: "ALREADY_COMPLETED" };
    if (transfer.status !== WalletTransferStatus.PENDING) return { error: "INVALID_STATE" };

    const sender = await prisma.user.findUnique({ where: { id: senderId } });
    if (!sender) return { error: "NOT_FOUND" };

    const senderPhone = await userPiiService.resolvePhone(sender, { actorId: sender.id, authorized: true });
    if (!senderPhone) return { error: "SENDER_PHONE_MISSING" };
    const otpResult = await otpService.verifyOTP(senderPhone, otp);
    if (!otpResult.isValid) return { error: "INVALID_OTP" };

    const recipient = await prisma.user.findUnique({ where: { id: transfer.recipientId } });
    if (!recipient) return { error: "RECIPIENT_NOT_FOUND" };

    // Pre-generate a unique base number; the two ledger rows derive distinct
    // numbers from it (calling the generator twice inside one tx collides).
    const baseTxnNo = await nextWalletTxnNumber();

    const result = await prisma.$transaction(async (tx) => {
      // Lock + re-check the sender balance inside the transaction.
      const s = await tx.user.findUnique({ where: { id: senderId }, select: { walletBalance: true } });
      if (!s || s.walletBalance < transfer.amount) throw new Error("INSUFFICIENT_BALANCE");

      const senderAfter = await tx.user.update({
        where: { id: senderId },
        data: { walletBalance: { decrement: transfer.amount } },
      });
      const recipAfter = await tx.user.update({
        where: { id: recipient.id },
        data: { walletBalance: { increment: transfer.amount } },
      });
      const senderTxn = await tx.walletTransaction.create({
        data: {
          transactionNumber: baseTxnNo,
          userId: senderId,
          amount: transfer.amount,
          walletBalanceBefore: s.walletBalance,
          walletBalanceAfter: senderAfter.walletBalance,
          type: WalletTxnType.DEBIT,
          description: `Sent to ${maskName(recipient.firstName, recipient.lastName, recipient.email)}`,
          referenceId: transfer.id,
          referenceType: "p2p_transfer",
          status: WalletTxnStatus.COMPLETED,
        },
      });
      const recipientTxn = await tx.walletTransaction.create({
        data: {
          transactionNumber: `${baseTxnNo}-R`,
          userId: recipient.id,
          amount: transfer.amount,
          walletBalanceBefore: recipAfter.walletBalance - transfer.amount,
          walletBalanceAfter: recipAfter.walletBalance,
          type: WalletTxnType.CREDIT,
          description: `Received from ${maskName(sender.firstName, sender.lastName, sender.email)}`,
          referenceId: transfer.id,
          referenceType: "p2p_transfer",
          status: WalletTxnStatus.COMPLETED,
        },
      });
      await tx.walletTransfer.update({
        where: { id: transfer.id },
        data: { status: WalletTransferStatus.COMPLETED, completedAt: new Date() },
      });
      await financialLedgerService.recordJournalInTransaction(
        tx,
        financialLedgerService.journalForWalletTransferOut(transfer.id, senderTxn.id, transfer.amount),
      );
      await financialLedgerService.recordJournalInTransaction(
        tx,
        financialLedgerService.journalForWalletTransferIn(transfer.id, recipientTxn.id, transfer.amount),
      );
      return {
        senderBalance: senderAfter.walletBalance,
        senderWalletTxnId: senderTxn.id,
        recipientWalletTxnId: recipientTxn.id,
      };
    });
    void AuditLogService.success("WALLET_TRANSFER", {
      userId: senderId,
      details: {
        transferId: transfer.id,
        amount: transfer.amount,
        recipientId: recipient.id,
      },
    });
    recordFinancialMetric("wallet_transfer_total", 1);
    recordFinancialMetric("wallet_debit_total", 1);

    return {
      ok: true,
      amount: transfer.amount,
      recipient: maskName(recipient.firstName, recipient.lastName, recipient.email),
      senderBalance: result.senderBalance,
    };
  }

  async history(userId: string) {
    const transfers = await prisma.walletTransfer.findMany({
      where: { OR: [{ senderId: userId }, { recipientId: userId }], status: WalletTransferStatus.COMPLETED },
      orderBy: { completedAt: "desc" },
      take: 50,
    });
    const otherIds = [...new Set(transfers.flatMap((t) => [t.senderId, t.recipientId]))];
    const users = await prisma.user.findMany({
      where: { id: { in: otherIds } },
      select: { id: true, firstName: true, lastName: true, email: true },
    });
    const nameById = new Map(users.map((u) => [u.id, maskName(u.firstName, u.lastName, u.email)]));
    return {
      transfers: transfers.map((t) => ({
        id: t.id,
        direction: t.senderId === userId ? ("sent" as const) : ("received" as const),
        counterparty: nameById.get(t.senderId === userId ? t.recipientId : t.senderId) ?? "HOMEEIGO user",
        amount: t.amount,
        note: t.note,
        createdAt: t.completedAt ?? t.createdAt,
      })),
      limits: { min: TRANSFER_MIN, maxPerTxn: TRANSFER_MAX_PER_TXN, maxDaily: TRANSFER_MAX_DAILY },
    };
  }

  // ===== Admin audit =====
  async adminList(query: { page?: string; limit?: string }) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const [rows, total] = await Promise.all([
      prisma.walletTransfer.findMany({
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.walletTransfer.count(),
    ]);
    const ids = [...new Set(rows.flatMap((t) => [t.senderId, t.recipientId]))];
    const users = await prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, firstName: true, lastName: true, email: true },
    });
    const nameById = new Map(users.map((u) => [u.id, maskName(u.firstName, u.lastName, u.email)]));
    const completedAgg = await prisma.walletTransfer.aggregate({
      where: { status: WalletTransferStatus.COMPLETED },
      _sum: { amount: true },
      _count: { _all: true },
    });
    return {
      transfers: rows.map((t) => ({
        id: t.id,
        sender: nameById.get(t.senderId) ?? "—",
        recipient: nameById.get(t.recipientId) ?? "—",
        amount: t.amount,
        status: t.status,
        createdAt: t.createdAt,
      })),
      pagination: { page, limit, total, hasMore: page * limit < total },
      totals: { completedCount: completedAgg._count._all, completedVolume: completedAgg._sum.amount ?? 0 },
    };
  }
}

export const transferService = new TransferService();
