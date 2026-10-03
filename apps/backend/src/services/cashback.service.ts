import { CashbackStatus, Prisma, WalletTxnStatus, WalletTxnType } from "@prisma/client";
import prisma from "../lib/prisma";
import { nextWalletTxnNumber } from "../lib/booking-number";
import { rupeesToPaise } from "../lib/money-paise";
import { parsePagination } from "../lib/pagination";
import { entitlementService, BENEFIT } from "./entitlement.service";
import { notificationService } from "./notification.service";
import { financialLedgerService } from "./financial-ledger.service";

/**
 * Premium Cashback Engine — server-generated after payment settlement.
 * Never trusts client-supplied cashback amounts.
 */
export class CashbackService {
  private computeAmount(userId: string, booking: { finalAmount: number }, entitlements: Awaited<ReturnType<typeof entitlementService.resolve>>) {
    if (entitlements.cashbackPct <= 0) return 0;
    return Math.round((booking.finalAmount * entitlements.cashbackPct) / 100);
  }

  /** Credit cashback only after booking COMPLETED — idempotent wallet + ledger write. */
  async creditOnBookingComplete(
    userId: string,
    bookingId: string,
  ): Promise<{ credited: boolean; amount: number }> {
    const pending = await this.accruePendingOnComplete(userId, bookingId);
    if (!pending.pending || pending.amount <= 0) {
      return { credited: false, amount: pending.amount };
    }
    return this.settlePendingCashback(userId, bookingId);
  }

  /** After booking completion — accrue PENDING cashback (no wallet credit yet). */
  async accruePendingOnComplete(userId: string, bookingId: string): Promise<{ pending: boolean; amount: number }> {
    const existing = await prisma.membershipCashback.findUnique({ where: { bookingId } });
    if (existing) return { pending: existing.status === CashbackStatus.PENDING, amount: existing.amount };

    const booking = await prisma.booking.findFirst({ where: { id: bookingId, userId, status: "COMPLETED" } });
    if (!booking) return { pending: false, amount: 0 };

    const entitlements = await entitlementService.resolve(userId);
    const amount = this.computeAmount(userId, booking, entitlements);
    if (amount <= 0) return { pending: false, amount: 0 };

    await prisma.membershipCashback.create({
      data: {
        userId,
        bookingId,
        amount,
        cashbackPct: entitlements.cashbackPct,
        settledAmount: booking.finalAmount,
        status: CashbackStatus.PENDING,
      },
    });
    return { pending: true, amount };
  }

  /** Idempotent: credits wallet for PENDING cashback after booking completion. */
  private async settlePendingCashback(
    userId: string,
    bookingId: string,
  ): Promise<{ credited: boolean; amount: number }> {
    const existing = await prisma.membershipCashback.findUnique({ where: { bookingId } });
    if (existing?.status === CashbackStatus.CREDITED) {
      return { credited: false, amount: existing.amount };
    }
    if (!existing || existing.status !== CashbackStatus.PENDING) {
      return { credited: false, amount: 0 };
    }

    const booking = await prisma.booking.findFirst({
      where: { id: bookingId, userId, status: "COMPLETED" },
    });
    if (!booking) return { credited: false, amount: 0 };

    const entitlements = await entitlementService.resolve(userId);
    const amount = existing.amount;
    if (amount <= 0) return { credited: false, amount: 0 };

    const result = await prisma.$transaction(async (tx) => {
      const dup = await tx.membershipCashback.findUnique({ where: { bookingId } });
      if (dup?.status === CashbackStatus.CREDITED) return { credited: false, amount: dup.amount };
      if (!dup || dup.status !== CashbackStatus.PENDING) return { credited: false, amount: 0 };

      // Serialise with every other wallet mutation for this user; the balance used to be SET to
      // `before + amount` from an unlocked read, silently overwriting any concurrent movement.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"wallet_pay:" + userId}))`;
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { walletBalance: true, walletBalancePaise: true },
      });
      if (!user) throw new Error("USER_NOT_FOUND");

      const creditPaise = rupeesToPaise(amount);
      await tx.user.update({
        where: { id: userId },
        data: {
          walletBalance: { increment: amount },
          walletBalancePaise: { increment: creditPaise },
          totalSaved: { increment: amount },
        },
      });
      const after = await tx.user.findUniqueOrThrow({
        where: { id: userId },
        select: { walletBalance: true, walletBalancePaise: true },
      });

      const walletTxn = await tx.walletTransaction.create({
        data: {
          transactionNumber: await nextWalletTxnNumber(tx),
          userId,
          amount,
          amountPaise: creditPaise,
          walletBalanceBefore: user.walletBalance,
          walletBalanceBeforePaise: user.walletBalancePaise,
          walletBalanceAfter: after.walletBalance,
          walletBalanceAfterPaise: after.walletBalancePaise,
          type: WalletTxnType.BONUS,
          description: `Membership cashback (${entitlements.cashbackPct}% on booking ${booking.bookingNumber})`,
          reason: "membership_cashback",
          referenceId: bookingId,
          referenceType: "booking",
          status: WalletTxnStatus.COMPLETED,
          completedAt: new Date(),
          idempotencyKey: `cashback-credit:${bookingId}`,
        },
      });

      const cb = await tx.membershipCashback.update({
        where: { bookingId },
        data: {
          amount,
          cashbackPct: entitlements.cashbackPct,
          settledAmount: booking.finalAmount,
          walletTransactionId: walletTxn.id,
          status: CashbackStatus.CREDITED,
        },
      });

      await financialLedgerService.recordJournalInTransaction(
        tx,
        financialLedgerService.journalForCashback(cb.id, amount),
      );

      return { credited: true, amount, walletTxnId: walletTxn.id };
    });

    if (result.credited) {
      await entitlementService.recordUsage(userId, BENEFIT.CASHBACK_PCT, { amount });
      // Detached: the cashback is committed. The sole caller wraps this in
      // `void ... .catch(...)`, so a throw here was invisible; this records it instead.
      await notificationService.createForUserDetached(
        {
          userId,
          type: "CASHBACK_CREDITED",
          title: "Premium cashback credited",
          message: `₹${result.amount} added to your wallet`,
          referenceId: bookingId,
          priority: "high",
        },
        { bookingId },
      );
    }

    return { credited: result.credited, amount: result.amount };
  }

  /**
   * Auto-reverse cashback on refund — transaction-safe, no double-reverse.
   *
   * ── OWNER DECISION #4: only a FULL refund reverses cashback ────────────────
   *
   * This reversed the entire cashback on ANY refund, so a 50-rupee partial refund on a 500-rupee
   * booking clawed back every rupee of the reward earned on the 450 the customer still paid.
   *
   * Three options existed: reverse on any refund (what it did), pro-rate to the refunded fraction,
   * or reverse only when the booking is fully refunded. Pro-rating is the most precise, and it is
   * the one rejected here for a specific reason: `MembershipCashback` has no reversed-amount column
   * and its status machine is one-shot (PENDING to CREDITED to REVERSED), so pro-rating across
   * successive partial refunds would need new persistent state and an accumulation path on the most
   * sensitive table in the system.
   *
   * Reversing only on a full refund errs in the safe direction. Over-reversal takes money from a
   * customer's wallet that they legitimately earned, and this function cannot reliably take it back
   * — `debit = Math.min(amount, walletBalance)` below means a customer who already spent it keeps
   * the shortfall, so the platform's books and the customer's balance disagree permanently. Under-
   * reversal costs the platform a bounded amount, harms nobody, and self-corrects the moment the
   * remainder is refunded.
   *
   * The rule lives here rather than in each caller: three call sites reach this function
   * (booking-refund, refund-ledger-sync, refund-orchestrator) and a rule they each have to remember
   * is one that one of them will eventually forget.
   */
  async reverseOnRefund(bookingId: string): Promise<{ reversed: boolean; amount: number }> {
    const row = await prisma.membershipCashback.findUnique({ where: { bookingId } });
    if (!row || row.status === CashbackStatus.REVERSED || row.status === CashbackStatus.PENDING) {
      return { reversed: false, amount: 0 };
    }
    if (row.status !== CashbackStatus.CREDITED) return { reversed: false, amount: 0 };

    /**
     * A partial refund leaves the reward standing. Read from the payment rather than trusting a
     * caller-supplied flag, so every path applies the same test against the same numbers.
     */
    const payment = await prisma.payment.findFirst({
      where: { bookingId },
      select: { amount: true, refundedAmount: true },
      orderBy: { createdAt: "desc" },
    });
    /**
     * No payment row means the refund cannot be shown to be full, and an unprovable full refund is
     * treated as a partial one. That is the same asymmetry the decision rests on: declining to
     * reverse costs the platform a bounded amount, while reversing on an assumption takes money from
     * a customer's wallet that this function cannot reliably give back.
     */
    if (!payment) return { reversed: false, amount: 0 };

    const paid = payment.amount ?? 0;
    const refunded = payment.refundedAmount ?? 0;
    // The same half-paise tolerance the refund path uses when it decides REFUNDED vs PARTIALLY_REFUNDED.
    const fullyRefunded = paid > 0 && refunded >= paid - 0.005;
    if (!fullyRefunded) return { reversed: false, amount: 0 };

    const reversed = await prisma.$transaction(async (tx) => {
      const current = await tx.membershipCashback.findUnique({ where: { bookingId } });
      if (!current || current.status !== CashbackStatus.CREDITED) return null;

      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"wallet_pay:" + current.userId}))`;
      const user = await tx.user.findUnique({
        where: { id: current.userId },
        select: { walletBalance: true, walletBalancePaise: true },
      });
      if (!user) return null;

      // A customer who already spent the cashback keeps the shortfall — which is why reversal is
      // now limited to full refunds (see the decision note above).
      const debit = Math.min(current.amount, user.walletBalance);
      if (debit <= 0) return null;
      const debitPaise = rupeesToPaise(debit);

      await tx.user.update({
        where: { id: current.userId },
        data: { walletBalance: { decrement: debit }, walletBalancePaise: { decrement: debitPaise } },
      });
      const after = await tx.user.findUniqueOrThrow({
        where: { id: current.userId },
        select: { walletBalance: true, walletBalancePaise: true },
      });

      const walletTxn = await tx.walletTransaction.create({
        data: {
          transactionNumber: await nextWalletTxnNumber(tx),
          userId: current.userId,
          amount: -debit,
          amountPaise: -debitPaise,
          walletBalanceBefore: user.walletBalance,
          walletBalanceBeforePaise: user.walletBalancePaise,
          walletBalanceAfter: after.walletBalance,
          walletBalanceAfterPaise: after.walletBalancePaise,
          type: WalletTxnType.REVERSAL,
          description: `Cashback reversed for refunded booking`,
          reason: "cashback_reversal",
          referenceId: bookingId,
          referenceType: "booking",
          status: WalletTxnStatus.COMPLETED,
          completedAt: new Date(),
          idempotencyKey: `cashback-reversal:${bookingId}`,
        },
      });

      await tx.membershipCashback.update({
        where: { bookingId },
        data: { status: CashbackStatus.REVERSED },
      });

      await financialLedgerService.recordJournalInTransaction(
        tx,
        financialLedgerService.journalForWalletDebit(walletTxn.id, debit),
      );
      await financialLedgerService.recordJournalInTransaction(
        tx,
        financialLedgerService.journalForCashbackReversal(walletTxn.id, debit, bookingId),
      );

      return { walletTxnId: walletTxn.id, debit };
    });

    return { reversed: Boolean(reversed), amount: reversed?.debit ?? 0 };
  }

  async history(userId: string, query: Record<string, string | undefined> = {}) {
    const { page, limit, skip } = parsePagination(query);
    const [rows, total, agg] = await Promise.all([
      prisma.membershipCashback.findMany({
        where: { userId },
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
        include: { booking: { select: { bookingNumber: true, serviceId: true, finalAmount: true } } },
      }),
      prisma.membershipCashback.count({ where: { userId } }),
      prisma.membershipCashback.aggregate({
        where: { userId, status: CashbackStatus.CREDITED },
        _sum: { amount: true },
        _count: true,
      }),
    ]);

    return {
      cashbacks: rows.map((r) => ({
        id: r.id,
        bookingId: r.bookingId,
        bookingNumber: r.booking.bookingNumber,
        amount: r.amount,
        cashbackPct: r.cashbackPct,
        settledAmount: r.settledAmount,
        status: r.status.toLowerCase(),
        createdAt: r.createdAt,
      })),
      total,
      page,
      summary: { totalCredited: agg._sum.amount ?? 0, count: agg._count },
    };
  }

  async adminDashboard() {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const [total, thisMonth, pending, topUsers] = await Promise.all([
      prisma.membershipCashback.aggregate({
        where: { status: CashbackStatus.CREDITED },
        _sum: { amount: true },
        _count: true,
      }),
      prisma.membershipCashback.aggregate({
        where: { status: CashbackStatus.CREDITED, createdAt: { gte: monthStart } },
        _sum: { amount: true },
        _count: true,
      }),
      prisma.membershipCashback.aggregate({
        where: { status: CashbackStatus.PENDING },
        _sum: { amount: true },
        _count: true,
      }),
      prisma.membershipCashback.groupBy({
        by: ["userId"],
        where: { status: CashbackStatus.CREDITED },
        _sum: { amount: true },
        orderBy: { _sum: { amount: "desc" } },
        take: 10,
      }),
    ]);

    const userIds = topUsers.map((u) => u.userId);
    const users = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, firstName: true, lastName: true, email: true },
    });
    const userMap = new Map(users.map((u) => [u.id, u]));

    return {
      totalCredited: total._sum.amount ?? 0,
      totalTransactions: total._count,
      thisMonthCredited: thisMonth._sum.amount ?? 0,
      thisMonthCount: thisMonth._count,
      pendingLiability: pending._sum.amount ?? 0,
      pendingCount: pending._count,
      topUsers: topUsers.map((u) => ({
        userId: u.userId,
        name: userMap.get(u.userId)
          ? `${userMap.get(u.userId)!.firstName} ${userMap.get(u.userId)!.lastName}`
          : "Unknown",
        totalCashback: u._sum.amount ?? 0,
      })),
    };
  }

  async adminLiability() {
    const [credited, reversed, byPct] = await Promise.all([
      prisma.membershipCashback.aggregate({
        where: { status: CashbackStatus.CREDITED },
        _sum: { amount: true },
        _count: true,
      }),
      prisma.membershipCashback.aggregate({
        where: { status: CashbackStatus.REVERSED },
        _sum: { amount: true },
        _count: true,
      }),
      prisma.membershipCashback.groupBy({
        by: ["cashbackPct"],
        where: { status: CashbackStatus.CREDITED },
        _sum: { amount: true },
        _count: true,
      }),
    ]);

    return {
      netLiability: (credited._sum.amount ?? 0) - (reversed._sum.amount ?? 0),
      creditedTotal: credited._sum.amount ?? 0,
      creditedCount: credited._count,
      reversedTotal: reversed._sum.amount ?? 0,
      reversedCount: reversed._count,
      byCashbackPct: byPct.map((b) => ({
        cashbackPct: b.cashbackPct,
        total: b._sum.amount ?? 0,
        count: b._count,
      })),
    };
  }

  async adminReports(query: Record<string, string | undefined> = {}) {
    const { page, limit, skip } = parsePagination(query);
    const where: Prisma.MembershipCashbackWhereInput = {};
    if (query.startDate || query.endDate) {
      where.createdAt = {};
      if (query.startDate) where.createdAt.gte = new Date(query.startDate);
      if (query.endDate) {
        const end = new Date(query.endDate);
        if (!Number.isNaN(end.getTime())) {
          end.setHours(23, 59, 59, 999);
          where.createdAt.lte = end;
        }
      }
    }
    const statusRaw = query.status?.trim().toUpperCase();
    if (statusRaw && (Object.values(CashbackStatus) as string[]).includes(statusRaw)) {
      where.status = statusRaw as CashbackStatus;
    }
    const term = query.search?.trim();
    if (term) {
      where.OR = [
        { user: { email: { contains: term, mode: "insensitive" } } },
        { user: { firstName: { contains: term, mode: "insensitive" } } },
        { user: { lastName: { contains: term, mode: "insensitive" } } },
        { booking: { bookingNumber: { contains: term, mode: "insensitive" } } },
      ];
    }

    const [rows, total, agg] = await Promise.all([
      prisma.membershipCashback.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
        include: {
          user: { select: { id: true, firstName: true, lastName: true, email: true } },
          booking: { select: { id: true, bookingNumber: true } },
        },
      }),
      prisma.membershipCashback.count({ where }),
      prisma.membershipCashback.aggregate({ where, _sum: { amount: true } }),
    ]);

    return {
      reports: rows.map((r) => ({
        id: r.id,
        userId: r.userId,
        bookingId: r.bookingId,
        user: `${r.user.firstName} ${r.user.lastName}`.trim() || r.user.email,
        email: r.user.email,
        bookingNumber: r.booking.bookingNumber,
        amount: r.amount,
        cashbackPct: r.cashbackPct,
        settledAmount: r.settledAmount,
        status: r.status.toLowerCase(),
        createdAt: r.createdAt,
      })),
      total,
      page,
      totalAmount: agg._sum.amount ?? 0,
    };
  }
}

export const cashbackService = new CashbackService();
