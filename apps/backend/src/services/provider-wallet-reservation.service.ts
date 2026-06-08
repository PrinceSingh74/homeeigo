import { WalletReservationStatus, WithdrawalStatus } from "@prisma/client";
import prisma from "../lib/prisma";
import { nextWithdrawalNumber } from "../lib/booking-number";
import { recordFinancialMetric } from "../lib/financial-metrics";
import { AuditLogService } from "./audit-log.service";
import { encryptWithdrawalBankFields } from "./sensitive-data.service";
import { earningsLiveService } from "./earnings-live.service";

export type WithdrawReservationResult =
  | { withdrawal: { id: string; amount: number; withdrawalNumber: string } }
  | { error: "INSUFFICIENT_BALANCE" | "PROVIDER_NOT_FOUND" };

export class ProviderWalletReservationService {
  availableBalance(walletBalance: number, reservedBalance: number): number {
    return Math.round((walletBalance - reservedBalance) * 100) / 100;
  }

  async reserveAndCreateWithdrawal(
    providerId: string,
    body: {
      amount: number;
      bankAccountNumber: string;
      ifscCode: string;
      accountHolder: string;
    },
  ): Promise<WithdrawReservationResult> {
    const bankFields = encryptWithdrawalBankFields({
      accountNumber: body.bankAccountNumber,
      ifscCode: body.ifscCode,
      accountHolderName: body.accountHolder,
      bankName: "Bank",
    });

    try {
      const result = await prisma.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<
          Array<{ id: string; user_id: string; wallet_balance: number; reserved_balance: number }>
        >`
          SELECT id, user_id, wallet_balance, reserved_balance
          FROM providers WHERE id = ${providerId} FOR UPDATE
        `;
        const provider = rows[0];
        if (!provider) return { error: "PROVIDER_NOT_FOUND" as const };

        const available = this.availableBalance(provider.wallet_balance, provider.reserved_balance);
        if (available < body.amount) {
          recordFinancialMetric("withdrawal_race_blocked_total", 1);
          return { error: "INSUFFICIENT_BALANCE" as const };
        }

        const withdrawal = await tx.withdrawal.create({
          data: {
            withdrawalNumber: await nextWithdrawalNumber(),
            providerId,
            amount: body.amount,
            netAmount: body.amount,
            accountHolderName: bankFields.accountHolderName,
            accountNumber: bankFields.accountNumber,
            ifscCode: bankFields.ifscCode,
            bankName: bankFields.bankName,
            paymentMethod: "bank_transfer",
            status: WithdrawalStatus.REQUESTED,
          },
        });

        await tx.provider.update({
          where: { id: providerId },
          data: { reservedBalance: { increment: body.amount } },
        });

        await tx.providerWalletReservation.create({
          data: {
            providerId,
            withdrawalId: withdrawal.id,
            amount: body.amount,
            status: WalletReservationStatus.RESERVED,
          },
        });

        return {
          withdrawal: {
            id: withdrawal.id,
            amount: withdrawal.amount,
            withdrawalNumber: withdrawal.withdrawalNumber,
          },
          userId: provider.user_id,
        };
      });

      if ("error" in result) return result;

      void AuditLogService.success("WITHDRAWAL_RESERVED", {
        details: {
          providerId,
          withdrawalId: result.withdrawal.id,
          amount: result.withdrawal.amount,
        },
      });

      await earningsLiveService.notifyWithdrawalInitiated(
        result.userId,
        body.amount,
        result.withdrawal.id,
      );

      return { withdrawal: result.withdrawal };
    } catch {
      recordFinancialMetric("withdrawal_race_blocked_total", 1);
      return { error: "INSUFFICIENT_BALANCE" };
    }
  }

  async releaseReservation(withdrawalId: string, actorUserId?: string, reason?: string): Promise<void> {
    const reservation = await prisma.providerWalletReservation.findUnique({
      where: { withdrawalId },
      include: { provider: true },
    });
    if (!reservation || reservation.status !== WalletReservationStatus.RESERVED) return;

    await prisma.$transaction([
      prisma.provider.update({
        where: { id: reservation.providerId },
        data: { reservedBalance: { decrement: reservation.amount } },
      }),
      prisma.providerWalletReservation.update({
        where: { id: reservation.id },
        data: { status: WalletReservationStatus.RELEASED, releasedAt: new Date() },
      }),
    ]);

    void AuditLogService.success("WITHDRAWAL_RESERVATION_RELEASED", {
      userId: actorUserId,
      reason,
      details: { withdrawalId, amount: reservation.amount, providerId: reservation.providerId },
    });
  }

  async consumeReservation(withdrawalId: string, actorUserId?: string): Promise<void> {
    const reservation = await prisma.providerWalletReservation.findUnique({
      where: { withdrawalId },
    });
    if (!reservation || reservation.status !== WalletReservationStatus.RESERVED) return;

    await prisma.$transaction([
      prisma.provider.update({
        where: { id: reservation.providerId },
        data: {
          walletBalance: { decrement: reservation.amount },
          reservedBalance: { decrement: reservation.amount },
        },
      }),
      prisma.providerWalletReservation.update({
        where: { id: reservation.id },
        data: { status: WalletReservationStatus.CONSUMED, consumedAt: new Date() },
      }),
    ]);

    void AuditLogService.success("WITHDRAWAL_RESERVATION_CONSUMED", {
      userId: actorUserId,
      details: { withdrawalId, amount: reservation.amount, providerId: reservation.providerId },
    });
  }
}

export const providerWalletReservationService = new ProviderWalletReservationService();
