import { WalletTxnStatus, WalletTxnType, Prisma } from "@prisma/client";
import { withTxRetry } from "../lib/db-retry";
import prisma from "../lib/prisma";
import { nextWalletTxnNumber } from "../lib/booking-number";
import { parsePagination } from "../lib/pagination";
import { razorpayService } from "./razorpay.service";
import { providerWalletReservationService } from "./provider-wallet-reservation.service";
import { notificationService } from "./notification.service";
import { financialLedgerService } from "./financial-ledger.service";
import { rupeesToPaise } from "../lib/money-paise";

/** Max non-expired pending top-up intents per user. */
export const MAX_PENDING_WALLET_TOPUPS = 10;
/** Pending top-up intent TTL (Razorpay order validity window). */
export const WALLET_TOPUP_PENDING_TTL_MS = 30 * 60 * 1000;

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

  async addMoney(
    userId: string,
    amount: number,
    opts?: { idempotencyKey?: string },
  ): Promise<
    | {
        razorpayOrderId: string;
        amount: number;
        currency: string;
        key: string | undefined;
        expiresAt: Date;
      }
    | { error: "USER_NOT_FOUND" | "TOO_MANY_PENDING" | "INVALID_AMOUNT" }
  > {
    if (!Number.isFinite(amount) || amount <= 0) {
      return { error: "INVALID_AMOUNT" };
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return { error: "USER_NOT_FOUND" };

    const now = new Date();
    const expiresAt = new Date(now.getTime() + WALLET_TOPUP_PENDING_TTL_MS);

    if (opts?.idempotencyKey) {
      const existing = await prisma.walletTransaction.findUnique({
        where: { idempotencyKey: opts.idempotencyKey },
      });
      if (existing) {
        if (
          existing.userId === userId &&
          existing.status === WalletTxnStatus.PENDING &&
          (!existing.expiresAt || existing.expiresAt > now) &&
          existing.referenceId
        ) {
          return {
            razorpayOrderId: existing.referenceId,
            amount: existing.amount,
            currency: user.walletCurrency,
            key: razorpayService.keyId,
            expiresAt: existing.expiresAt ?? expiresAt,
          };
        }
        return { error: "TOO_MANY_PENDING" };
      }
    }

    const activePending = await prisma.walletTransaction.count({
      where: {
        userId,
        type: WalletTxnType.CREDIT,
        referenceType: "razorpay_order",
        status: WalletTxnStatus.PENDING,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
    });
    if (activePending >= MAX_PENDING_WALLET_TOPUPS) {
      return { error: "TOO_MANY_PENDING" };
    }

    const order = await razorpayService.createOrder(amount, `wallet_${userId}`, { userId });
    // `transactionNumber` is a human-readable max()+1 value, so concurrent creation
    // across processes (multi-node) collides on its unique index. Retry with a freshly
    // computed number on a transactionNumber collision; the idempotencyKey collision
    // (genuine duplicate request) still short-circuits to the racing row.
    const TXN_NUMBER_RETRIES = 25;
    for (let attempt = 0; ; attempt++) {
      try {
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
            expiresAt,
            idempotencyKey: opts?.idempotencyKey,
          },
        });
        break;
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          const target = String((error.meta as { target?: string | string[] } | undefined)?.target ?? "");
          // Duplicate request (same idempotencyKey) → return the row the racer created.
          if (opts?.idempotencyKey && target.toLowerCase().includes("idempotency")) {
            const raced = await prisma.walletTransaction.findUnique({ where: { idempotencyKey: opts.idempotencyKey } });
            if (raced?.userId === userId && raced.referenceId && raced.status === WalletTxnStatus.PENDING) {
              return {
                razorpayOrderId: raced.referenceId,
                amount: raced.amount,
                currency: order.currency,
                key: razorpayService.keyId,
                expiresAt: raced.expiresAt ?? expiresAt,
              };
            }
          }
          // transactionNumber collision under concurrency → regenerate the number + retry.
          if (target.toLowerCase().includes("transaction") && attempt < TXN_NUMBER_RETRIES) {
            await new Promise((r) => setTimeout(r, 5 + Math.random() * 25 * (attempt + 1)));
            continue;
          }
        }
        throw error;
      }
    }

    return {
      razorpayOrderId: order.orderId,
      amount: order.amount,
      currency: order.currency,
      key: razorpayService.keyId,
      expiresAt,
    };
  }

  /** Mark stale pending top-ups as EXPIRED — safe to run on a schedule. */
  async expireStalePendingTopUps(): Promise<number> {
    const result = await prisma.walletTransaction.updateMany({
      where: {
        status: WalletTxnStatus.PENDING,
        referenceType: "razorpay_order",
        expiresAt: { lt: new Date() },
      },
      data: { status: WalletTxnStatus.EXPIRED },
    });
    return result.count;
  }

  async countActivePendingTopUps(userId?: string): Promise<number> {
    const now = new Date();
    return prisma.walletTransaction.count({
      where: {
        ...(userId ? { userId } : {}),
        type: WalletTxnType.CREDIT,
        referenceType: "razorpay_order",
        status: WalletTxnStatus.PENDING,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
    });
  }

  async reconcileTopUpFromWebhook(razorpayOrderId: string, _razorpayPaymentId: string) {
    const txn = await prisma.walletTransaction.findFirst({
      where: { referenceId: razorpayOrderId, referenceType: "razorpay_order" },
    });
    if (!txn) return { handled: false as const, reason: "WALLET_TXN_NOT_FOUND" };
    if (!txn.userId) return { handled: false as const, reason: "WALLET_TXN_NOT_FOUND" };

    const settled = await this.settleTopUpTransaction(txn.id, txn.userId);
    if (settled.alreadySettled) {
      return { handled: true as const, reason: "WALLET_ALREADY_RECONCILED", ...settled };
    }

    await notificationService.createForUser({
      userId: txn.userId,
      type: "WALLET_CREDIT",
      title: "Wallet topped up",
      message: `₹${txn.amount} added to your HOMEEIGO wallet`,
      referenceId: settled.walletTransactionId,
      priority: "high",
    });

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
    if (txn.status === WalletTxnStatus.EXPIRED) return { error: "EXPIRED" as const };
    if (txn.status === WalletTxnStatus.FAILED) return { error: "FAILED" as const };
    if (txn.expiresAt && txn.expiresAt < new Date() && txn.status === WalletTxnStatus.PENDING) {
      await prisma.walletTransaction.update({
        where: { id: txn.id },
        data: { status: WalletTxnStatus.EXPIRED },
      });
      return { error: "EXPIRED" as const };
    }

    const valid = razorpayService.verifyPaymentSignature(
      body.razorpayOrderId,
      body.razorpayPaymentId,
      body.razorpaySignature,
    );
    if (!valid) return { error: "INVALID_SIGNATURE" as const };

    try {
      const settled = await this.settleTopUpTransaction(txn.id, userId);

      if (!settled.alreadySettled) {
        await notificationService.createForUser({
          userId,
          type: "WALLET_CREDIT",
          title: "Wallet topped up",
          message: `₹${txn.amount} added to your HOMEEIGO wallet`,
          referenceId: settled.walletTransactionId,
          priority: "high",
        });
      }

      return { ...settled, status: "success" as const };
    } catch (error) {
      if (error instanceof Error) {
        if (error.message === "TXN_NOT_FOUND") return { error: "NOT_FOUND" as const };
        if (error.message === "TXN_EXPIRED") return { error: "EXPIRED" as const };
        if (error.message === "TXN_FAILED") return { error: "FAILED" as const };
      }
      throw error;
    }
  }

  /**
   * Atomic wallet top-up settlement — wallet balance, txn status, and ledger journal
   * commit or roll back together.
   */
  private async settleTopUpTransaction(
    walletTransactionId: string,
    userId: string,
  ): Promise<{ walletTransactionId: string; balance: number; alreadySettled: boolean }> {
    // Retry on write-conflict/deadlock (e.g. concurrent webhook + client verify on
    // the same wallet). Idempotent: the inner tx locks the row `FOR UPDATE` and
    // short-circuits when already COMPLETED, so a retry can never double-credit.
    return withTxRetry(() =>
      prisma.$transaction(async (tx) => {
        const settled = await this.settleTopUpInTransaction(tx, walletTransactionId, userId);
        if (!settled.alreadySettled) {
          await financialLedgerService.recordWalletTopUpInTransaction(
            tx,
            settled.walletTransactionId,
            settled.amount,
          );
        }
        return {
          walletTransactionId: settled.walletTransactionId,
          balance: settled.balance,
          alreadySettled: settled.alreadySettled,
        };
      }),
    );
  }

  private async settleTopUpInTransaction(
    tx: Prisma.TransactionClient,
    walletTransactionId: string,
    userId: string,
  ): Promise<{
    walletTransactionId: string;
    balance: number;
    alreadySettled: boolean;
    amount: number;
  }> {
    // Serialize concurrent settles of the SAME top-up (e.g. webhook + client verify
    // racing). A transaction-scoped advisory lock taken BEFORE any row lock removes
    // lock-ordering deadlocks entirely: the loser blocks here, then reads status =
    // COMPLETED below and returns alreadySettled (never double-credits).
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"wallet_settle:" + walletTransactionId}))`;

    const txnRows = await tx.$queryRaw<
      Array<{
        id: string;
        user_id: string | null;
        amount: number;
        status: WalletTxnStatus;
      }>
    >`
      SELECT id, user_id, amount, status
      FROM wallet_transactions
      WHERE id = ${walletTransactionId}
      FOR UPDATE
    `;
    const locked = txnRows[0];
    if (!locked || locked.user_id !== userId) {
      throw new Error("TXN_NOT_FOUND");
    }

    if (locked.status === WalletTxnStatus.EXPIRED) {
      throw new Error("TXN_EXPIRED");
    }
    if (locked.status === WalletTxnStatus.FAILED) {
      throw new Error("TXN_FAILED");
    }

    if (locked.status === WalletTxnStatus.COMPLETED) {
      const userRows = await tx.$queryRaw<Array<{ wallet_balance: number }>>`
        SELECT wallet_balance FROM users WHERE id = ${userId} FOR UPDATE
      `;
      return {
        walletTransactionId: locked.id,
        balance: userRows[0]?.wallet_balance ?? 0,
        alreadySettled: true,
        amount: locked.amount,
      };
    }

    const userRows = await tx.$queryRaw<Array<{ wallet_balance: number }>>`
      SELECT wallet_balance FROM users WHERE id = ${userId} FOR UPDATE
    `;
    const user = userRows[0];
    if (!user) throw new Error("USER_NOT_FOUND");

    const balanceBefore = user.wallet_balance;
    const balanceAfter = balanceBefore + locked.amount;

    const creditPaise = rupeesToPaise(locked.amount);
    await tx.user.update({
      where: { id: userId },
      data: {
        walletBalance: { increment: locked.amount },
        walletBalancePaise: { increment: creditPaise },
      },
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

    return {
      walletTransactionId: locked.id,
      balance: balanceAfter,
      alreadySettled: false,
      amount: locked.amount,
    };
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
