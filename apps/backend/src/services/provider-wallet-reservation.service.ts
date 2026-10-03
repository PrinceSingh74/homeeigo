import { Prisma, WalletReservationStatus, WithdrawalStatus } from "@prisma/client";
import prisma from "../lib/prisma";
import { nextWithdrawalNumber } from "../lib/booking-number";
import { recordFinancialMetric } from "../lib/financial-metrics";
import { rupeesToPaise } from "../lib/money-paise";
import { AuditLogService } from "./audit-log.service";
import { encryptWithdrawalBankFields } from "./sensitive-data.service";
import { earningsLiveService } from "./earnings-live.service";

export type WithdrawReservationResult =
  | { withdrawal: { id: string; amount: number; withdrawalNumber: string } }
  | { error: "INSUFFICIENT_BALANCE" | "PROVIDER_NOT_FOUND" | "INVALID_AMOUNT" };

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
      idempotencyKey?: string;
    },
  ): Promise<WithdrawReservationResult> {
    if (!Number.isFinite(body.amount) || body.amount <= 0) {
      return { error: "INVALID_AMOUNT" };
    }

    const bankFields = encryptWithdrawalBankFields({
      accountNumber: body.bankAccountNumber,
      ifscCode: body.ifscCode,
      accountHolderName: body.accountHolder,
      bankName: "Bank",
    });

    if (body.idempotencyKey) {
      const existing = await prisma.withdrawal.findUnique({
        where: { idempotencyKey: body.idempotencyKey },
      });
      if (existing && existing.providerId === providerId) {
        return {
          withdrawal: {
            id: existing.id,
            amount: existing.amount,
            withdrawalNumber: existing.withdrawalNumber,
          },
        };
      }
    }

    try {
      const result = await prisma.$transaction(async (tx) => {
        if (body.idempotencyKey) {
          const raced = await tx.withdrawal.findUnique({
            where: { idempotencyKey: body.idempotencyKey },
          });
          if (raced && raced.providerId === providerId) {
            return {
              withdrawal: {
                id: raced.id,
                amount: raced.amount,
                withdrawalNumber: raced.withdrawalNumber,
              },
              userId: null as string | null,
              replayed: true as const,
            };
          }
        }

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
            idempotencyKey: body.idempotencyKey ?? null,
          },
        });

        const { buildPartnerPayoutCreatedEvent } = await import("../events/catalog/partner.events");
        const { emitPartnerEvent } = await import("../events/core/partner-event-emit");
        await emitPartnerEvent(
          buildPartnerPayoutCreatedEvent({
            providerId,
            withdrawalId: withdrawal.id,
            withdrawalNumber: withdrawal.withdrawalNumber,
            amount: withdrawal.amount,
            netAmount: withdrawal.netAmount,
          }),
          tx,
        );

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

      if ("replayed" in result && result.replayed) {
        return { withdrawal: result.withdrawal };
      }

      void AuditLogService.success("WITHDRAWAL_RESERVED", {
        details: {
          providerId,
          withdrawalId: result.withdrawal.id,
          amount: result.withdrawal.amount,
        },
      });

      if (result.userId) {
        await earningsLiveService.notifyWithdrawalInitiated(
          result.userId,
          body.amount,
          result.withdrawal.id,
        );
      }

      return { withdrawal: result.withdrawal };
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002" && body.idempotencyKey) {
        const raced = await prisma.withdrawal.findUnique({
          where: { idempotencyKey: body.idempotencyKey },
        });
        if (raced && raced.providerId === providerId) {
          return {
            withdrawal: {
              id: raced.id,
              amount: raced.amount,
              withdrawalNumber: raced.withdrawalNumber,
            },
          };
        }
      }
      recordFinancialMetric("withdrawal_race_blocked_total", 1);
      return { error: "INSUFFICIENT_BALANCE" };
    }
  }

  /**
   * Release inside a caller-owned transaction, so a payout failure can post its reversal
   * journal, flip the withdrawal and free the reservation atomically.
   */
  async releaseReservationInTransaction(
    tx: Prisma.TransactionClient,
    withdrawalId: string,
  ): Promise<{ amount: number; providerId: string } | null> {
    const rows = await tx.$queryRaw<
      Array<{ id: string; provider_id: string; amount: number; status: WalletReservationStatus }>
    >`
      SELECT id, provider_id, amount, status
      FROM provider_wallet_reservations
      WHERE withdrawal_id = ${withdrawalId}
      FOR UPDATE
    `;
    const reservation = rows[0];
    if (!reservation || reservation.status !== WalletReservationStatus.RESERVED) return null;

    await tx.provider.update({
      where: { id: reservation.provider_id },
      data: { reservedBalance: { decrement: reservation.amount } },
    });
    await tx.providerWalletReservation.update({
      where: { id: reservation.id },
      data: { status: WalletReservationStatus.RELEASED, releasedAt: new Date() },
    });
    return { amount: reservation.amount, providerId: reservation.provider_id };
  }

  async releaseReservation(withdrawalId: string, actorUserId?: string, reason?: string): Promise<void> {
    const applied = await prisma.$transaction((tx) => this.releaseReservationInTransaction(tx, withdrawalId));

    if (!applied) return;

    void AuditLogService.success("WITHDRAWAL_RESERVATION_RELEASED", {
      userId: actorUserId,
      reason,
      details: { withdrawalId, amount: applied.amount, providerId: applied.providerId },
    });
  }

  /**
   * Consume (deduct) inside a caller-owned transaction. Payout completion uses this so the
   * ledger journal, the wallet deduction and the wallet-transaction snapshot commit together —
   * they used to be three transactions, and a crash after the first left the ledger saying "paid"
   * while the provider still held the money.
   */
  async consumeReservationInTransaction(
    tx: Prisma.TransactionClient,
    withdrawalId: string,
  ): Promise<{ amount: number; providerId: string } | null> {
    const rows = await tx.$queryRaw<
      Array<{ id: string; provider_id: string; amount: number; status: WalletReservationStatus }>
    >`
      SELECT id, provider_id, amount, status
      FROM provider_wallet_reservations
      WHERE withdrawal_id = ${withdrawalId}
      FOR UPDATE
    `;
    const reservation = rows[0];
    if (!reservation || reservation.status !== WalletReservationStatus.RESERVED) return null;

    await tx.provider.update({
      where: { id: reservation.provider_id },
      data: {
        walletBalance: { decrement: reservation.amount },
        walletBalancePaise: { decrement: rupeesToPaise(reservation.amount) },
        reservedBalance: { decrement: reservation.amount },
      },
    });
    await tx.providerWalletReservation.update({
      where: { id: reservation.id },
      data: { status: WalletReservationStatus.CONSUMED, consumedAt: new Date() },
    });
    return { amount: reservation.amount, providerId: reservation.provider_id };
  }

  async consumeReservation(withdrawalId: string, actorUserId?: string): Promise<void> {
    const applied = await prisma.$transaction((tx) => this.consumeReservationInTransaction(tx, withdrawalId));

    if (!applied) return;

    void AuditLogService.success("WITHDRAWAL_RESERVATION_CONSUMED", {
      userId: actorUserId,
      details: { withdrawalId, amount: applied.amount, providerId: applied.providerId },
    });
  }
}

export const providerWalletReservationService = new ProviderWalletReservationService();
