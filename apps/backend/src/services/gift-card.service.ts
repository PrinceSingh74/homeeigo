import crypto from "crypto";
import { prisma } from "../lib/prisma";
import { GiftCardStatus, WalletTxnType, WalletTxnStatus, Prisma } from "@prisma/client";
import { razorpayService } from "./razorpay.service";
import { nextWalletTxnNumber } from "../lib/booking-number";
import { emailDeliveryService } from "./email-delivery.service";
import { financialLedgerService } from "./financial-ledger.service";
import {
  giftCardProtectionService,
  type GiftCardAttemptMeta,
} from "./gift-card-protection.service";
import { AuditLogService } from "./audit-log.service";
import { isPrismaPoolTimeout, isPrismaConcurrencyError } from "../lib/prisma-errors";

/** Marketplace denominations + bounds for custom amounts. */
export const GIFT_DENOMINATIONS = [100, 250, 500, 1000, 2000];
export const GIFT_MIN = 100;
export const GIFT_MAX = 10000;
const VALIDITY_DAYS = 365;

function generateCode(): string {
  const seg = () => crypto.randomBytes(2).toString("hex").toUpperCase();
  return `HG-${seg()}-${seg()}-${seg()}`;
}

export class GiftCardService {
  denominations() {
    return GIFT_DENOMINATIONS;
  }

  /**
   * Create a Razorpay order + a PENDING gift card. The amount comes from the
   * client but is bounds-checked; the real charge is the booking on the order.
   */
  async createOrder(
    userId: string,
    amount: number,
    opts: { recipientEmail?: string; recipientPhone?: string; message?: string },
  ) {
    if (!Number.isInteger(amount) || amount < GIFT_MIN || amount > GIFT_MAX) return null;
    let code = generateCode();
    // Avoid the (astronomically unlikely) code collision.
    for (let i = 0; i < 3; i++) {
      const exists = await prisma.giftCard.findUnique({ where: { code }, select: { id: true } });
      if (!exists) break;
      code = generateCode();
    }
    const order = await razorpayService.createOrder(amount, `gift_${userId}`, { userId });
    await prisma.giftCard.create({
      data: {
        code,
        purchaserId: userId,
        amount,
        balance: amount,
        status: GiftCardStatus.PENDING_PAYMENT,
        recipientEmail: opts.recipientEmail?.toLowerCase(),
        recipientPhone: opts.recipientPhone,
        message: opts.message?.slice(0, 200),
        razorpayOrderId: order.orderId,
        expiresAt: new Date(Date.now() + VALIDITY_DAYS * 86_400_000),
      },
    });
    return {
      razorpayOrderId: order.orderId,
      amount: order.amount,
      currency: order.currency,
      key: razorpayService.keyId,
    };
  }

  /** Verify payment → activate the card → notify the recipient (if any). */
  async verify(
    userId: string,
    body: { razorpayOrderId: string; razorpayPaymentId: string; razorpaySignature: string },
  ): Promise<{ ok: true; code: string; amount: number; sentTo: string | null } | { error: string }> {
    const card = await prisma.giftCard.findFirst({
      where: { purchaserId: userId, razorpayOrderId: body.razorpayOrderId },
    });
    if (!card) return { error: "NOT_FOUND" };
    if (card.status === GiftCardStatus.ACTIVE || card.status === GiftCardStatus.REDEEMED) {
      return { ok: true, code: card.code, amount: card.amount, sentTo: card.recipientEmail ?? card.recipientPhone };
    }
    const valid = razorpayService.verifyPaymentSignature(
      body.razorpayOrderId,
      body.razorpayPaymentId,
      body.razorpaySignature,
    );
    if (!valid) return { error: "INVALID_SIGNATURE" };

    await this.activatePaidCard(card.id, userId);

    const activated = await prisma.giftCard.findUnique({ where: { id: card.id } });
    const sentTo = activated?.recipientEmail ?? activated?.recipientPhone ?? null;
    if (card.recipientEmail) {
      emailDeliveryService.enqueue({
        to: card.recipientEmail,
        emailType: "gift_card",
        subject: `You've received a ₹${card.amount} HOMEEIGO gift card 🎁`,
        html: `<p>Someone sent you a HOMEEIGO gift card worth <b>₹${card.amount}</b>.</p><p>Redeem code: <b style="font-size:18px">${card.code}</b></p>${card.message ? `<p>Message: ${card.message}</p>` : ""}<p>Open HOMEEIGO → Wallet → Gift Cards → Redeem.</p>`,
        metadata: { cardId: card.id, amount: card.amount },
      });
    }
    if (card.recipientPhone || card.recipientEmail) {
      const recipientUser = await prisma.user.findFirst({
        where: {
          OR: [
            ...(card.recipientPhone ? [{ phoneNumber: card.recipientPhone }] : []),
            ...(card.recipientEmail ? [{ email: card.recipientEmail }] : []),
          ],
        },
        select: { id: true },
      });
      if (recipientUser) {
        void prisma.notification
          .create({
            data: {
              userId: recipientUser.id,
              type: "GIFT_CARD",
              title: "You've received a gift card 🎁",
              message: `A ₹${card.amount} HOMEEIGO gift card is waiting. Redeem code ${card.code}.`,
            },
          })
          .catch(() => {});
      }
    }

    return { ok: true, code: card.code, amount: card.amount, sentTo };
  }

  async reconcileFromWebhook(
    razorpayOrderId: string,
    _razorpayPaymentId: string,
  ): Promise<{ handled: boolean; reason: string }> {
    const card = await prisma.giftCard.findFirst({ where: { razorpayOrderId } });
    if (!card) return { handled: false, reason: "GIFT_CARD_NOT_FOUND" };
    if (card.status === GiftCardStatus.ACTIVE || card.status === GiftCardStatus.REDEEMED) {
      return { handled: true, reason: "GIFT_CARD_ALREADY_ACTIVE" };
    }
    await this.activatePaidCard(card.id, card.purchaserId);
    return { handled: true, reason: "GIFT_CARD_ACTIVATED" };
  }

  async reconcilePendingFromOrders(): Promise<number> {
    const pending = await prisma.giftCard.findMany({
      where: { status: GiftCardStatus.PENDING_PAYMENT, razorpayOrderId: { not: null } },
      take: 50,
    });
    let activated = 0;
    for (const card of pending) {
      if (!card.razorpayOrderId) continue;
      const payments = await razorpayService.fetchOrderPayments(card.razorpayOrderId);
      const captured = payments.find((p) => p.status === "captured");
      if (!captured) continue;
      const result = await this.reconcileFromWebhook(card.razorpayOrderId, captured.id);
      if (result.handled) activated++;
    }
    return activated;
  }

  private async activatePaidCard(cardId: string, purchaserId: string) {
    const card = await prisma.giftCard.findUnique({ where: { id: cardId } });
    if (!card || card.status === GiftCardStatus.ACTIVE || card.status === GiftCardStatus.REDEEMED) {
      return;
    }

    await prisma.$transaction(async (tx) => {
      await tx.giftCard.update({ where: { id: cardId }, data: { status: GiftCardStatus.ACTIVE } });
      await tx.giftCardTransaction.create({
        data: {
          giftCardId: cardId,
          userId: purchaserId,
          type: "PURCHASE",
          amount: card.amount,
          balanceAfter: card.amount,
        },
      });
      await financialLedgerService.recordJournalInTransaction(
        tx,
        financialLedgerService.journalForGiftCardPurchase(cardId, card.amount),
      );
    });
  }

  /**
   * Redeem a gift card → credit the redeemer's wallet. Supports PARTIAL redemption:
   * pass `redeemAmount` to draw down part of the balance (card stays ACTIVE with the
   * remainder); omit it to redeem the full remaining balance. Single-use per amount,
   * race-safe (row re-checked + balance recomputed inside the transaction).
   */
  async redeem(
    userId: string,
    rawCode: string,
    redeemAmount?: number,
    meta?: GiftCardAttemptMeta,
  ): Promise<
    | { ok: true; amount: number; walletBalance: number; remaining: number }
    | { error: string; blockedUntil?: Date }
  > {
    const code = rawCode.trim().toUpperCase();

    if (meta) {
      const gate = await giftCardProtectionService.trackRedemptionAttempt(code, {
        ...meta,
        userId,
      });
      if (!gate.allowed) {
        return {
          error: "RATE_LIMITED",
          blockedUntil: gate.blockedUntil,
        };
      }
    }

    const card = await prisma.giftCard.findUnique({ where: { code } });
    if (!card) {
      if (meta) {
        await giftCardProtectionService.recordFailedAttempt(code, { ...meta, userId }, "invalid_code");
      }
      return { error: "INVALID_CODE" };
    }
    if (card.status === GiftCardStatus.REDEEMED) {
      if (meta) await giftCardProtectionService.recordFailedAttempt(code, { ...meta, userId }, "already_redeemed", card.id);
      return { error: "ALREADY_REDEEMED" };
    }
    if (card.status === GiftCardStatus.VOID) {
      if (meta) await giftCardProtectionService.recordFailedAttempt(code, { ...meta, userId }, "voided", card.id);
      return { error: "VOIDED" };
    }
    if (card.status !== GiftCardStatus.ACTIVE) {
      if (meta) await giftCardProtectionService.recordFailedAttempt(code, { ...meta, userId }, "not_active", card.id);
      return { error: "NOT_ACTIVE" };
    }
    if (card.expiresAt && card.expiresAt < new Date()) {
      await prisma.giftCard.update({ where: { id: card.id }, data: { status: GiftCardStatus.EXPIRED } });
      if (meta) await giftCardProtectionService.recordFailedAttempt(code, { ...meta, userId }, "expired", card.id);
      return { error: "EXPIRED" };
    }
    if (redeemAmount !== undefined && (!Number.isInteger(redeemAmount) || redeemAmount <= 0)) {
      return { error: "INVALID_AMOUNT" };
    }

    const MAX_REDEEM_RETRIES = 8;
    let result: {
      amount: number;
      walletBalance: number;
      remaining: number;
      walletTxnId: string;
    } | null = null;

    for (let attempt = 0; attempt < MAX_REDEEM_RETRIES; attempt++) {
      try {
        result = await prisma.$transaction(
      async (tx) => {
      const lockedRows = await tx.$queryRaw<
        Array<{
          id: string;
          status: string;
          balance: number;
          code: string;
          recipient_id: string | null;
          redeemed_at: Date | null;
        }>
      >`
        SELECT id, status, balance, code, recipient_id, redeemed_at
        FROM gift_cards
        WHERE id = ${card.id}
        FOR UPDATE
      `;
      const locked = lockedRows[0];
      if (!locked || locked.status !== GiftCardStatus.ACTIVE || locked.balance <= 0) {
        throw new Error("ALREADY_REDEEMED");
      }
      // Draw down at most the remaining balance.
      const amount =
        redeemAmount && redeemAmount > 0 ? Math.min(redeemAmount, locked.balance) : locked.balance;
      const newBalance = locked.balance - amount;
      const userRows = await tx.$queryRaw<Array<{ wallet_balance: number }>>`
        SELECT wallet_balance FROM users WHERE id = ${userId} FOR UPDATE
      `;
      const user = userRows[0];
      if (!user) throw new Error("NOT_FOUND");

      const updated = await tx.user.update({
        where: { id: userId },
        data: { walletBalance: { increment: amount } },
      });
      const walletTxn = await tx.walletTransaction.create({
        data: {
          transactionNumber: await nextWalletTxnNumber(tx),
          userId,
          amount,
          walletBalanceBefore: user.wallet_balance,
          walletBalanceAfter: updated.walletBalance,
          type: WalletTxnType.CREDIT,
          description:
            newBalance > 0
              ? `Gift card ${locked.code} redeemed (₹${amount})`
              : `Gift card ${locked.code} redeemed`,
          referenceId: locked.id,
          referenceType: "gift_card",
          status: WalletTxnStatus.COMPLETED,
        },
      });
      await tx.giftCardTransaction.create({
        data: { giftCardId: locked.id, userId, type: "REDEEM", amount, balanceAfter: newBalance },
      });
      const applied = await tx.giftCard.updateMany({
        where: { id: locked.id, status: GiftCardStatus.ACTIVE, balance: locked.balance },
        data: {
          balance: newBalance,
          status: newBalance === 0 ? GiftCardStatus.REDEEMED : GiftCardStatus.ACTIVE,
          recipientId: locked.recipient_id ?? userId,
          redeemedAt: newBalance === 0 ? new Date() : locked.redeemed_at,
        },
      });
      if (applied.count === 0) {
        throw new Error("ALREADY_REDEEMED");
      }
      await financialLedgerService.recordWalletTopUpInTransaction(tx, walletTxn.id, amount);
      return { amount, walletBalance: updated.walletBalance, remaining: newBalance, walletTxnId: walletTxn.id };
    },
      { maxWait: 8_000, timeout: 12_000 },
    );
        break;
      } catch (error) {
        if (isPrismaConcurrencyError(error) || isPrismaPoolTimeout(error)) {
          if (attempt < MAX_REDEEM_RETRIES - 1) {
            await new Promise((r) => setTimeout(r, 15 * (attempt + 1) + Math.random() * 40));
            continue;
          }
          if (isPrismaPoolTimeout(error)) {
            return { error: "POOL_BUSY" };
          }
        }
        if (error instanceof Error && error.message === "ALREADY_REDEEMED") {
          return { error: "ALREADY_REDEEMED" };
        }
        throw error;
      }
    }

    if (!result) return { error: "ALREADY_REDEEMED" };

    if (meta) {
      await giftCardProtectionService.recordSuccessfulRedemption(code, { ...meta, userId }, card.id);
    }

    void AuditLogService.success("GIFT_CARD_REDEEMED", {
      userId,
      details: { giftCardId: card.id, amount: result.amount, remaining: result.remaining, code },
    });

    return { ok: true, amount: result.amount, walletBalance: result.walletBalance, remaining: result.remaining };
  }

  /**
   * Void/cancel a gift card the user PURCHASED. When a gateway payment exists,
   * Razorpay refund must succeed before any wallet credit. Idempotent + ledger-aware.
   */
  async void(
    userId: string,
    cardId: string,
  ): Promise<{ ok: true; refunded: number; walletBalance: number } | { error: string }> {
    const card = await prisma.giftCard.findFirst({ where: { id: cardId, purchaserId: userId } });
    if (!card) return { error: "NOT_FOUND" };
    if (card.status === GiftCardStatus.VOID) return { error: "ALREADY_VOIDED" };
    if (card.status !== GiftCardStatus.ACTIVE) return { error: "NOT_VOIDABLE" };
    if (card.balance <= 0) return { error: "NO_BALANCE" };

    let gatewayPaymentId: string | null = null;
    if (card.razorpayOrderId) {
      const payments = await razorpayService.fetchOrderPayments(card.razorpayOrderId);
      const captured = payments.find((p) => p.status === "captured");
      if (captured) {
        gatewayPaymentId = captured.id;
      } else if (payments.some((p) => p.status === "authorized")) {
        return { error: "AWAITING_CAPTURE" };
      }
    }

    const refundAmount = card.balance;
    if (gatewayPaymentId) {
      const idempotencyKey = `gift_void:${cardId}`;
      const existingRefund = await prisma.walletTransaction.findFirst({
        where: { referenceId: cardId, referenceType: "gift_card_void_refund" },
      });
      if (!existingRefund) {
        const gatewayRefund = await razorpayService.createRefund(gatewayPaymentId, refundAmount);
        if (!gatewayRefund.refundId) return { error: "GATEWAY_REFUND_FAILED" };
      }
    }

    const result = await prisma.$transaction(async (tx) => {
      const locked = await tx.giftCard.findUnique({ where: { id: cardId } });
      if (!locked || locked.status === GiftCardStatus.VOID) throw new Error("ALREADY_VOIDED");
      if (locked.status !== GiftCardStatus.ACTIVE || locked.balance <= 0) {
        throw new Error("NOT_VOIDABLE");
      }
      const refund = locked.balance;
      const purchaser = await tx.user.findUnique({ where: { id: userId }, select: { walletBalance: true } });
      if (!purchaser) throw new Error("NOT_FOUND");
      const updated = await tx.user.update({
        where: { id: userId },
        data: { walletBalance: { increment: refund } },
      });
      const walletTxn = await tx.walletTransaction.create({
        data: {
          transactionNumber: await nextWalletTxnNumber(tx),
          userId,
          amount: refund,
          walletBalanceBefore: purchaser.walletBalance,
          walletBalanceAfter: updated.walletBalance,
          type: WalletTxnType.CREDIT,
          description: `Gift card ${locked.code} refunded`,
          referenceId: locked.id,
          referenceType: gatewayPaymentId ? "gift_card_void_refund" : "gift_card_refund",
          status: WalletTxnStatus.COMPLETED,
        },
      });
      await tx.giftCardTransaction.create({
        data: { giftCardId: locked.id, userId, type: "REFUND", amount: refund, balanceAfter: 0 },
      });
      await tx.giftCard.update({
        where: { id: locked.id },
        data: { status: GiftCardStatus.VOID, balance: 0 },
      });
      await financialLedgerService.recordJournalInTransaction(
        tx,
        financialLedgerService.journalForRefund(
          gatewayPaymentId ?? cardId,
          refund,
          `gift_void:${cardId}`,
        ),
      );
      return { refunded: refund, walletBalance: updated.walletBalance, walletTxnId: walletTxn.id };
    });

    return { ok: true, refunded: result.refunded, walletBalance: result.walletBalance };
  }

  async myCards(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, phoneNumber: true },
    });
    const cards = await prisma.giftCard.findMany({
      where: {
        OR: [
          { purchaserId: userId },
          { recipientId: userId },
          ...(user?.email ? [{ recipientEmail: user.email }] : []),
          ...(user?.phoneNumber ? [{ recipientPhone: user.phoneNumber }] : []),
        ],
        status: { not: GiftCardStatus.PENDING_PAYMENT },
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return {
      cards: cards.map((c) => ({
        id: c.id,
        code: c.code,
        amount: c.amount,
        balance: c.balance,
        status: c.status,
        role: c.purchaserId === userId ? ("purchased" as const) : ("received" as const),
        recipient: c.recipientEmail ?? c.recipientPhone ?? null,
        message: c.message,
        createdAt: c.createdAt,
        expiresAt: c.expiresAt,
      })),
    };
  }

  // ===== Admin =====
  async adminList(query: { page?: string; limit?: string }) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const [rows, total] = await Promise.all([
      prisma.giftCard.findMany({
        where: { status: { not: GiftCardStatus.PENDING_PAYMENT } },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.giftCard.count({ where: { status: { not: GiftCardStatus.PENDING_PAYMENT } } }),
    ]);
    const [issued, redeemedLedger, refundedLedger, activeBal] = await Promise.all([
      prisma.giftCard.aggregate({ where: { status: { not: GiftCardStatus.PENDING_PAYMENT } }, _sum: { amount: true } }),
      prisma.giftCardTransaction.aggregate({ where: { type: "REDEEM" }, _sum: { amount: true } }),
      prisma.giftCardTransaction.aggregate({ where: { type: "REFUND" }, _sum: { amount: true } }),
      prisma.giftCard.aggregate({ where: { status: GiftCardStatus.ACTIVE }, _sum: { balance: true } }),
    ]);
    return {
      cards: rows.map((c) => ({
        id: c.id,
        code: c.code,
        amount: c.amount,
        balance: c.balance,
        status: c.status,
        recipient: c.recipientEmail ?? c.recipientPhone ?? "—",
        createdAt: c.createdAt,
      })),
      pagination: { page, limit, total, hasMore: page * limit < total },
      stats: {
        issued: issued._sum.amount ?? 0,
        redeemed: redeemedLedger._sum.amount ?? 0,
        refunded: refundedLedger._sum.amount ?? 0,
        outstanding: activeBal._sum.balance ?? 0, // real remaining liability (ACTIVE balances)
        count: total,
      },
    };
  }
}

export const giftCardService = new GiftCardService();
