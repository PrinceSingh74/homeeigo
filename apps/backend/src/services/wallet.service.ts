import { WalletTxnStatus, WalletTxnType } from "@prisma/client";
import prisma from "../lib/prisma";
import { nextWalletTxnNumber } from "../lib/booking-number";
import { parsePagination } from "../lib/pagination";
import { razorpayService } from "./razorpay.service";
import { providerWalletReservationService } from "./provider-wallet-reservation.service";
import { notificationService } from "./notification.service";
import { financialLedgerService } from "./financial-ledger.service";

const WALLET_OFFERS = [
  {
    id: "offer_referral",
    title: "Referral Bonus",
    description: "Get ₹200 for each friend who signs up",
    amount: 200,
    type: "referral",
    isActive: true,
    expiresAt: "2026-12-31",
  },
  {
    id: "offer_first_booking",
    title: "First Booking Discount",
    description: "20% off on your first booking",
    discount: 20,
    type: "discount",
    isActive: true,
  },
];

export class WalletService {
  async balance(userId: string) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return null;
    const lastTxn = await prisma.walletTransaction.findFirst({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });
    return {
      balance: user.walletBalance,
      currency: user.walletCurrency,
      lastTransaction: lastTxn
        ? {
            type: lastTxn.type.toLowerCase(),
            amount: lastTxn.amount,
            reason: lastTxn.reason ?? lastTxn.description,
            createdAt: lastTxn.createdAt,
          }
        : null,
    };
  }

  async transactions(userId: string, query: Record<string, string | undefined>) {
    const { page, limit, skip } = parsePagination(query);
    const where: {
      userId: string;
      type?: WalletTxnType;
      createdAt?: { gte?: Date; lte?: Date };
    } = { userId };
    if (query.type && query.type !== "all") {
      where.type = query.type.toUpperCase() as WalletTxnType;
    }
    if (query.startDate || query.endDate) {
      where.createdAt = {};
      if (query.startDate) where.createdAt.gte = new Date(query.startDate);
      if (query.endDate) where.createdAt.lte = new Date(query.endDate);
    }

    const [rows, total, credits, debits] = await Promise.all([
      prisma.walletTransaction.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
      }),
      prisma.walletTransaction.count({ where }),
      prisma.walletTransaction.aggregate({
        where: { ...where, type: { in: ["CREDIT", "BONUS", "REFUND"] } },
        _sum: { amount: true },
      }),
      prisma.walletTransaction.aggregate({
        where: { ...where, type: { in: ["DEBIT", "WITHDRAWAL"] } },
        _sum: { amount: true },
      }),
    ]);

    const user = await prisma.user.findUnique({ where: { id: userId } });
    return {
      transactions: rows.map((t) => ({
        id: t.id,
        transactionNumber: t.transactionNumber,
        type: t.type.toLowerCase(),
        amount: t.amount,
        description: t.description,
        reason: t.reason,
        balanceBefore: t.walletBalanceBefore,
        balanceAfter: t.walletBalanceAfter,
        status: t.status.toLowerCase(),
        createdAt: t.createdAt,
      })),
      total,
      page,
      summary: {
        totalCredit: credits._sum.amount ?? 0,
        totalDebit: debits._sum.amount ?? 0,
        netBalance: user?.walletBalance ?? 0,
      },
    };
  }

  async addMoney(userId: string, amount: number) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return null;
    const order = await razorpayService.createOrder(amount, `wallet_${userId}`, { userId });
    await prisma.walletTransaction.create({
      data: {
        transactionNumber: await nextWalletTxnNumber(),
        userId,
        amount,
        walletBalanceBefore: user.walletBalance,
        walletBalanceAfter: user.walletBalance,
        type: WalletTxnType.CREDIT,
        description: "Wallet top-up",
        referenceId: order.orderId,
        referenceType: "razorpay_order",
        status: WalletTxnStatus.PENDING,
      },
    });
    return {
      razorpayOrderId: order.orderId,
      amount: order.amount,
      currency: order.currency,
      key: razorpayService.keyId,
    };
  }

  async reconcileTopUpFromWebhook(razorpayOrderId: string, razorpayPaymentId: string) {
    const txn = await prisma.walletTransaction.findFirst({
      where: { referenceId: razorpayOrderId, referenceType: "razorpay_order" },
    });
    if (!txn) return { handled: false as const, reason: "WALLET_TXN_NOT_FOUND" };
    if (txn.status === WalletTxnStatus.COMPLETED) {
      return { handled: true as const, reason: "WALLET_ALREADY_RECONCILED" };
    }

    const settled = await prisma.$transaction(async (tx) => {
      const locked = await tx.walletTransaction.findUnique({ where: { id: txn.id } });
      if (!locked) throw new Error("TXN_NOT_FOUND");
      if (locked.status === WalletTxnStatus.COMPLETED) {
        const user = await tx.user.findUnique({ where: { id: locked.userId! } });
        return { walletTransactionId: locked.id, balance: user?.walletBalance ?? 0 };
      }
      const user = await tx.user.findUnique({ where: { id: locked.userId! } });
      if (!user) throw new Error("USER_NOT_FOUND");
      const balanceBefore = user.walletBalance;
      const balanceAfter = balanceBefore + locked.amount;
      await tx.user.update({
        where: { id: user.id },
        data: { walletBalance: balanceAfter },
      });
      await tx.walletTransaction.update({
        where: { id: locked.id },
        data: {
          status: WalletTxnStatus.COMPLETED,
          walletBalanceBefore: balanceBefore,
          walletBalanceAfter: balanceAfter,
          completedAt: new Date(),
        },
      });
      return { walletTransactionId: locked.id, balance: balanceAfter };
    });

    await notificationService.createForUser({
      userId: txn.userId!,
      type: "WALLET_CREDIT",
      title: "Wallet topped up",
      message: `₹${txn.amount} added to your HOMIGO wallet`,
      referenceId: settled.walletTransactionId,
      priority: "high",
    });

    void financialLedgerService
      .recordWalletTopUp(settled.walletTransactionId, txn.amount)
      .catch(() => undefined);

    return { handled: true as const, reason: "WALLET_RECONCILED", ...settled };
  }

  async verifyTopUp(
    userId: string,
    body: { razorpayOrderId: string; razorpayPaymentId: string; razorpaySignature: string },
  ) {
    const txn = await prisma.walletTransaction.findFirst({
      where: {
        userId,
        referenceId: body.razorpayOrderId,
        referenceType: "razorpay_order",
      },
    });
    if (!txn) return { error: "NOT_FOUND" as const };

    const valid = razorpayService.verifyPaymentSignature(
      body.razorpayOrderId,
      body.razorpayPaymentId,
      body.razorpaySignature,
    );
    if (!valid) return { error: "INVALID_SIGNATURE" as const };

    if (txn.status === WalletTxnStatus.COMPLETED) {
      const user = await prisma.user.findUnique({ where: { id: userId } });
      return {
        walletTransactionId: txn.id,
        status: "success" as const,
        balance: user?.walletBalance ?? 0,
      };
    }

    try {
      const settled = await prisma.$transaction(async (tx) => {
        const locked = await tx.walletTransaction.findUnique({ where: { id: txn.id } });
        if (!locked) throw new Error("TXN_NOT_FOUND");
        if (locked.status === WalletTxnStatus.COMPLETED) {
          const user = await tx.user.findUnique({ where: { id: userId } });
          return { walletTransactionId: locked.id, balance: user?.walletBalance ?? 0 };
        }

        const user = await tx.user.findUnique({ where: { id: userId } });
        if (!user) throw new Error("USER_NOT_FOUND");
        const balanceBefore = user.walletBalance;
        const balanceAfter = balanceBefore + locked.amount;

        await tx.user.update({
          where: { id: userId },
          data: { walletBalance: balanceAfter },
        });

        await tx.walletTransaction.update({
          where: { id: locked.id },
          data: {
            status: WalletTxnStatus.COMPLETED,
            walletBalanceBefore: balanceBefore,
            walletBalanceAfter: balanceAfter,
            completedAt: new Date(),
          },
        });

        return { walletTransactionId: locked.id, balance: balanceAfter };
      });

      await notificationService.createForUser({
        userId,
        type: "WALLET_CREDIT",
        title: "Wallet topped up",
        message: `₹${txn.amount} added to your HOMIGO wallet`,
        referenceId: settled.walletTransactionId,
        priority: "high",
      });

      void financialLedgerService
        .recordWalletTopUp(settled.walletTransactionId, txn.amount)
        .catch(() => undefined);

      return { ...settled, status: "success" as const };
    } catch (error) {
      if (error instanceof Error && error.message === "TXN_NOT_FOUND") {
        return { error: "NOT_FOUND" as const };
      }
      throw error;
    }
  }

  async withdraw(
    providerId: string,
    body: {
      amount: number;
      bankAccountNumber: string;
      ifscCode: string;
      accountHolder: string;
    },
  ) {
    return providerWalletReservationService.reserveAndCreateWithdrawal(providerId, body);
  }

  offers() {
    return WALLET_OFFERS;
  }
}

export const walletService = new WalletService();
