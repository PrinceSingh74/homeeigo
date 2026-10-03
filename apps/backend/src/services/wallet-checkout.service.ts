import { JournalEntryType, PaymentStatus, WalletTxnStatus, WalletTxnType } from "@prisma/client";
import prisma from "../lib/prisma";
import { nextWalletTxnNumber } from "../lib/booking-number";
import { withTxRetry } from "../lib/db-retry";
import { financialLedgerService } from "./financial-ledger.service";
import { razorpayService } from "./razorpay.service";
import { giftCardService } from "./gift-card.service";
import { hcoinService, COIN_TO_RUPEE } from "./hcoin.service";
import { recordFeatureEvent } from "../lib/metrics";
import { recordFinancialMetric } from "../lib/financial-metrics";
import { onBookingPaymentSettledBackground } from "../lib/booking-payment-settled";
import { stampPaymentEnvironment } from "../lib/payment-environment-column";
import { applyBookingPaymentSuccess, isCapturedPaymentStatus } from "../lib/booking-payment-settlement";
import { isPayableBookingStatus, paymentDispositionFor } from "../lib/booking-state-machine";
import { incCounter } from "../lib/metrics";
import { logger } from "../lib/logger";
import { parseCatalogConfig } from "../lib/service-catalog-config";
import { assertSplitAllowed, assertWalletAllowed } from "../lib/service-runtime-policy";

const toPaise = (inr: number): bigint => BigInt(Math.round(inr * 100));
const round2 = (n: number): number => Math.round(n * 100) / 100;

async function paymentConfigForBooking(bookingId: string) {
  const row = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: { serviceConfigSnapshot: true, service: { select: { catalogConfig: true } } },
  });
  const snap = row?.serviceConfigSnapshot;
  if (snap && typeof snap === "object" && !Array.isArray(snap) && "payment" in snap) {
    return { payment: (snap as { payment?: unknown }).payment } as { payment?: { walletAllowed?: boolean; splitPaymentAllowed?: boolean } };
  }
  return parseCatalogConfig(row?.service?.catalogConfig);
}

export type WalletCheckoutQuote = {
  bookingId: string;
  bookingAmount: number; // base + taxes = finalAmount
  taxes: number;
  finalAmount: number;
  walletBalance: number;
  walletApplicable: number;
  razorpayRequired: number; // remainder after wallet
  remainderDue: number; // alias of razorpayRequired
  fullyPayableFromWallet: boolean;
  alreadyPaid: boolean;
};

type PayResult =
  | { ok: true; alreadyPaid: boolean; walletTransactionId: string | null; amountPaid: number; balance: number }
  | { error: "BOOKING_NOT_FOUND" | "ALREADY_PAID" | "INSUFFICIENT_WALLET_BALANCE" | "INVALID_AMOUNT" | "BOOKING_NOT_PAYABLE" | "WALLET_NOT_ALLOWED" };

/**
 * Phase 18 — wallet-funded booking checkout, built on the EXISTING ledger primitives
 * (no new financial tables). Paying a booking from wallet balance reclassifies the
 * customer's prepaid funds from the wallet liability into booking escrow:
 *
 *   Debit  CUSTOMER_WALLET   (we owe the customer less)
 *   Credit PLATFORM_ESCROW   (funds now held for the booking)
 *
 * The matching WalletTransaction(DEBIT) keeps `SUM(user.walletBalance)` equal to the
 * CUSTOMER_WALLET ledger balance, and the journal is keyed `wallet_debit:<txnId>` so
 * the financial-integrity validator's "completed debit must have a WALLET_DEBIT
 * journal" invariant holds. Idempotent per booking; concurrency-safe via advisory
 * lock + FOR UPDATE on the wallet row.
 */
export const walletCheckoutService = {
  async quote(userId: string, bookingId: string): Promise<WalletCheckoutQuote | { error: "BOOKING_NOT_FOUND" }> {
    const booking = await prisma.booking.findFirst({
      where: { id: bookingId, userId },
      select: { finalAmount: true, taxes: true, paymentStatus: true },
    });
    if (!booking) return { error: "BOOKING_NOT_FOUND" };

    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { walletBalance: true } });
    const final = booking.finalAmount;
    const walletApplicable = round2(Math.min(user.walletBalance, final));
    const remainder = round2(Math.max(0, final - walletApplicable));
    return {
      bookingId,
      bookingAmount: final,
      taxes: booking.taxes ?? 0,
      finalAmount: final,
      walletBalance: user.walletBalance,
      walletApplicable,
      razorpayRequired: remainder,
      remainderDue: remainder,
      fullyPayableFromWallet: user.walletBalance >= final,
      alreadyPaid: booking.paymentStatus === "SUCCESS",
    };
  },

  /** Pay a booking IN FULL from wallet balance. Returns ALREADY_PAID if settled, or
   *  INSUFFICIENT_WALLET_BALANCE if the wallet cannot cover finalAmount. */
  async payBookingFromWallet(userId: string, bookingId: string): Promise<PayResult> {
    const cfg = await paymentConfigForBooking(bookingId);
    const blocked = assertWalletAllowed(cfg);
    if (blocked) {
      incCounter("service_payment_policy_rejected_total", { reason: "wallet" });
      return { error: "WALLET_NOT_ALLOWED" };
    }
    const result = await withTxRetry(() =>
      prisma.$transaction(
        async (tx) => {
          // Serialize concurrent debits for this wallet across processes.
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"wallet_pay:" + userId}))`;

          // Idempotency: a prior completed wallet payment for this booking → no double charge.
          const prior = await tx.walletTransaction.findFirst({
            where: { userId, referenceType: "booking_wallet_payment", referenceId: bookingId, status: WalletTxnStatus.COMPLETED },
            select: { id: true, walletBalanceAfter: true, amount: true },
          });
          if (prior) {
            return { ok: true, alreadyPaid: true, walletTransactionId: prior.id, amountPaid: prior.amount, balance: prior.walletBalanceAfter } satisfies PayResult;
          }

          // Locked: serialises with cancel, which re-checks payment_status before it commits.
          await tx.$executeRaw`SELECT id FROM bookings WHERE id = ${bookingId} AND user_id = ${userId} FOR UPDATE`;
          const booking = await tx.booking.findFirst({
            where: { id: bookingId, userId },
            select: { id: true, finalAmount: true, paymentStatus: true, providerId: true, bookingNumber: true, status: true },
          });
          if (!booking) return { error: "BOOKING_NOT_FOUND" } satisfies PayResult;
          if (booking.paymentStatus === "SUCCESS") return { error: "ALREADY_PAID" } satisfies PayResult;
          if (!isPayableBookingStatus(booking.status)) return { error: "BOOKING_NOT_PAYABLE" } satisfies PayResult;

          const amount = booking.finalAmount;
          if (!Number.isFinite(amount) || amount <= 0) return { error: "INVALID_AMOUNT" } satisfies PayResult;

          // Lock the wallet row and read the authoritative balance.
          const rows = await tx.$queryRaw<Array<{ wallet_balance: number }>>`
            SELECT wallet_balance FROM users WHERE id = ${userId} FOR UPDATE`;
          const before = Number(rows[0]?.wallet_balance ?? 0);
          if (before < amount) return { error: "INSUFFICIENT_WALLET_BALANCE" } satisfies PayResult;
          const after = Math.round((before - amount) * 100) / 100;

          const txn = await tx.walletTransaction.create({
            data: {
              transactionNumber: await nextWalletTxnNumber(tx),
              userId,
              amount,
              amountPaise: toPaise(amount),
              walletBalanceBefore: before,
              walletBalanceBeforePaise: toPaise(before),
              walletBalanceAfter: after,
              walletBalanceAfterPaise: toPaise(after),
              type: WalletTxnType.DEBIT,
              status: WalletTxnStatus.COMPLETED,
              description: `Wallet payment for booking ${booking.bookingNumber}`,
              referenceId: bookingId,
              referenceType: "booking_wallet_payment",
              completedAt: new Date(),
            },
          });

          await tx.user.update({
            where: { id: userId },
            data: { walletBalance: after, walletBalancePaise: toPaise(after) },
          });

          // Reclassify wallet liability → booking escrow. Keyed wallet_debit:<txnId> so
          // the integrity validator finds the required WALLET_DEBIT journal.
          await financialLedgerService.recordJournalInTransaction(tx, {
            type: JournalEntryType.WALLET_DEBIT,
            referenceId: txn.id,
            referenceType: "wallet_transaction",
            idempotencyKey: `wallet_debit:${txn.id}`,
            description: `Wallet payment for booking ${booking.bookingNumber}`,
            lines: [
              { accountCode: "CUSTOMER_WALLET", debit: amount, credit: 0 },
              { accountCode: "PLATFORM_ESCROW", debit: 0, credit: amount },
            ],
          });

          await applyBookingPaymentSuccess(tx, bookingId, { capturedAmount: amount, source: "wallet", paymentMethod: "wallet" });

          recordFeatureEvent("checkout", "wallet_paid");
          // Reuse the existing financial counters (rendered by financial-metrics) — no duplicate names.
          recordFinancialMetric("payment_success_total", 1);
          recordFinancialMetric("wallet_debit_total", 1);
          return { ok: true, alreadyPaid: false, walletTransactionId: txn.id, amountPaid: amount, balance: after } satisfies PayResult;
        },
        { isolationLevel: "Serializable" },
      ),
    );
    if ("ok" in result && result.ok && !result.alreadyPaid) {
      onBookingPaymentSettledBackground(bookingId, "wallet");
    }
    return result;
  },

  /**
   * Phase 18.2 — start a wallet + Razorpay SPLIT. `walletAmount` is applied from wallet,
   * the remainder (finalAmount − walletAmount) becomes a Razorpay order. Wallet is NOT
   * debited yet (no customer reserved-balance column exists; debiting now would create a
   * WALLET_LIABILITY_MISMATCH window) — both legs commit atomically in `verifySplit`.
   * If walletAmount covers the whole booking, falls through to the wallet-only path.
   */
  async initiateSplit(userId: string, bookingId: string, walletAmount: number): Promise<SplitInitResult> {
    const booking = await prisma.booking.findFirst({
      where: { id: bookingId, userId },
      select: { id: true, finalAmount: true, paymentStatus: true, bookingNumber: true, status: true },
    });
    if (!booking) return { error: "BOOKING_NOT_FOUND" };
    if (booking.paymentStatus === "SUCCESS") return { error: "ALREADY_PAID" };
    if (!isPayableBookingStatus(booking.status)) return { error: "BOOKING_NOT_PAYABLE" };
    const cfg = await paymentConfigForBooking(bookingId);
    if (assertWalletAllowed(cfg)) {
      incCounter("service_payment_policy_rejected_total", { reason: "wallet" });
      return { error: "WALLET_NOT_ALLOWED" };
    }
    if (assertSplitAllowed(cfg)) {
      incCounter("service_payment_policy_rejected_total", { reason: "split" });
      return { error: "SPLIT_NOT_ALLOWED" };
    }

    const final = booking.finalAmount;
    const wallet = round2(walletAmount);
    if (!Number.isFinite(wallet) || wallet < 0 || wallet > final) return { error: "INVALID_AMOUNT" };

    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { walletBalance: true } });
    if (wallet > user.walletBalance) return { error: "INSUFFICIENT_WALLET_BALANCE" };

    const remainder = round2(final - wallet);
    if (remainder <= 0) {
      const r = await this.payBookingFromWallet(userId, bookingId);
      if ("error" in r) return { error: r.error };
      return { mode: "wallet_only", status: "SUCCESS", walletTransactionId: r.walletTransactionId, amountPaid: r.amountPaid, balance: r.balance };
    }

    // Idempotent: one Payment per booking (bookingId is @unique).
    const existing = await prisma.payment.findUnique({ where: { bookingId } });
    if (existing) {
      if (existing.status === PaymentStatus.SUCCESS) return { error: "ALREADY_PAID" };
      if (existing.status === PaymentStatus.FAILED) {
        // A failed split is retried through the one retry path (which keeps the wallet share and
        // charges the gateway only the remainder) instead of handing back the dead order.
        const { paymentService } = await import("./payment.service");
        const retried = await paymentService.createOrder(userId, bookingId);
        if (!retried || "error" in retried) return { error: "RETRY_CONFLICT" };
        const fresh = await prisma.payment.findUniqueOrThrow({ where: { bookingId } });
        const w = Number((safeJson(fresh.metadata)?.walletAmount as number) ?? 0);
        return { mode: "split", razorpayOrderId: fresh.razorpayOrderId, razorpayAmount: fresh.amount, walletAmount: w, finalAmount: final, key: razorpayService.keyId };
      }
      const storedWallet = Number((safeJson(existing.metadata)?.walletAmount as number) ?? 0);
      return { mode: "split", razorpayOrderId: existing.razorpayOrderId, razorpayAmount: existing.amount, walletAmount: storedWallet, finalAmount: final, key: razorpayService.keyId };
    }

    const order = await razorpayService.createOrder(remainder, booking.bookingNumber, { bookingId });
    try {
      const created = await prisma.payment.create({
        data: {
          bookingId,
          userId,
          amount: remainder,
          amountPaise: toPaise(remainder),
          paymentMethod: "wallet_razorpay_split",
          razorpayOrderId: order.orderId,
          status: PaymentStatus.INITIATED,
          idempotencyKey: `split:${bookingId}`,
          metadata: JSON.stringify({ walletAmount: wallet, finalAmount: final }),
        },
      });
      // §27 — record the gateway world the split's gateway leg belongs to (probe-guarded, never throws).
      await stampPaymentEnvironment(prisma, created.id, order.orderId);
    } catch (e: unknown) {
      // Lost the create race — return the winner's order.
      const raced = await prisma.payment.findUnique({ where: { bookingId } });
      if (raced) {
        const w = Number((safeJson(raced.metadata)?.walletAmount as number) ?? 0);
        return { mode: "split", razorpayOrderId: raced.razorpayOrderId, razorpayAmount: raced.amount, walletAmount: w, finalAmount: final, key: razorpayService.keyId };
      }
      throw e;
    }
    await prisma.booking.update({ where: { id: bookingId }, data: { paymentStatus: PaymentStatus.INITIATED } });
    return { mode: "split", razorpayOrderId: order.orderId, razorpayAmount: remainder, walletAmount: wallet, finalAmount: final, key: razorpayService.keyId };
  },

  /**
   * Phase 18.2 — verify the Razorpay leg (client signature) and settle both legs atomically.
   * The settlement itself is `settleSplitCapture`, shared with the webhook.
   */
  async verifySplit(
    userId: string,
    body: { razorpayOrderId: string; razorpayPaymentId: string; razorpaySignature: string },
  ): Promise<SplitVerifyResult> {
    const payment = await prisma.payment.findFirst({
      where: { razorpayOrderId: body.razorpayOrderId, userId },
      select: { id: true },
    });
    if (!payment) return { error: "NOT_FOUND" };
    if (!razorpayService.verifyPaymentSignature(body.razorpayOrderId, body.razorpayPaymentId, body.razorpaySignature)) {
      return { error: "INVALID_SIGNATURE" };
    }
    return this.settleSplitCapture(payment.id, body.razorpayPaymentId, body.razorpaySignature, "wallet_razorpay_split");
  },

  /** Webhook `payment.captured` for a split order (the webhook signature is already verified). */
  async settleSplitFromWebhook(paymentId: string, razorpayPaymentId: string): Promise<{ handled: boolean; reason: string }> {
    const r = await this.settleSplitCapture(paymentId, razorpayPaymentId, null, "razorpay_webhook_split");
    if ("ok" in r) return { handled: true, reason: "RECONCILED" };
    if (r.error === "WALLET_DEBIT_FAILED") return { handled: true, reason: "SPLIT_WALLET_SHORTFALL_REFUNDING" };
    return { handled: false, reason: r.error };
  },

  /**
   * Settle a captured split order. The gateway money has ARRIVED, so it is always recorded
   * (payment SUCCESS + journal), whatever else happens:
   *
   *  - booking servable + wallet covers its share → debit the wallet leg; booking paid.
   *  - booking cancelled/rejected → the wallet leg is NOT charged; the captured gateway leg is
   *    marked for a full refund (applyBookingPaymentSuccess) and the booking stays terminal.
   *  - the wallet no longer covers its share → the wallet is not touched, the booking stays unpaid
   *    (payment_status FAILED) and the captured gateway leg is refunded in full. Before, the whole
   *    transaction rolled back: the captured money was recorded nowhere and never returned.
   */
  async settleSplitCapture(
    paymentId: string,
    razorpayPaymentId: string,
    razorpaySignature: string | null,
    source: string,
  ): Promise<SplitVerifyResult> {
    const payment = await prisma.payment.findUnique({
      where: { id: paymentId },
      include: { booking: { select: { bookingNumber: true } } },
    });
    if (!payment || !payment.userId) return { error: "NOT_FOUND" };
    const userId = payment.userId;
    if (isCapturedPaymentStatus(payment.status)) {
      return payment.razorpayPaymentId === razorpayPaymentId
        ? { ok: true, status: "SUCCESS", bookingId: payment.bookingId, walletApplied: 0, razorpayApplied: payment.amount, balance: 0 }
        : { error: "ALREADY_SETTLED" };
    }

    const walletAmount = round2(Number((safeJson(payment.metadata)?.walletAmount as number) ?? 0));
    const remainder = payment.amount;

    type Settled = SplitVerifyResult | { shortfall: true };
    let result: Settled;
    try {
      result = await withTxRetry(() =>
        prisma.$transaction(
          async (tx): Promise<Settled> => {
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"wallet_pay:" + userId}))`;
            await tx.$executeRaw`SELECT id FROM payments WHERE id = ${payment.id} FOR UPDATE`;

            const locked = await tx.payment.findUniqueOrThrow({ where: { id: payment.id } });
            if (isCapturedPaymentStatus(locked.status)) {
              if (locked.razorpayPaymentId === razorpayPaymentId) {
                return { ok: true, status: "SUCCESS", bookingId: payment.bookingId, walletApplied: walletAmount, razorpayApplied: remainder, balance: 0 };
              }
              throw new Error("ALREADY_SETTLED");
            }
            const reused = await tx.payment.findFirst({ where: { razorpayPaymentId, NOT: { id: payment.id } }, select: { id: true } });
            if (reused) throw new Error("ALREADY_SETTLED");

            const bookingRows = await tx.$queryRaw<Array<{ status: string }>>`
              SELECT status FROM bookings WHERE id = ${payment.bookingId} FOR UPDATE`;
            const servable = paymentDispositionFor(bookingRows[0]?.status ?? "") === "APPLY";

            let newBalance = 0;
            let walletApplied = 0;
            let shortfall = false;
            // --- wallet leg (only for a booking that can still be served) ---
            if (servable && walletAmount > 0) {
              const rows = await tx.$queryRaw<Array<{ wallet_balance: number }>>`SELECT wallet_balance FROM users WHERE id = ${userId} FOR UPDATE`;
              const before = Number(rows[0]?.wallet_balance ?? 0);
              if (before < walletAmount) {
                shortfall = true;
              } else {
                newBalance = round2(before - walletAmount);
                const wtxn = await tx.walletTransaction.create({
                  data: {
                    transactionNumber: await nextWalletTxnNumber(tx),
                    userId,
                    amount: walletAmount,
                    amountPaise: toPaise(walletAmount),
                    walletBalanceBefore: before,
                    walletBalanceBeforePaise: toPaise(before),
                    walletBalanceAfter: newBalance,
                    walletBalanceAfterPaise: toPaise(newBalance),
                    type: WalletTxnType.DEBIT,
                    status: WalletTxnStatus.COMPLETED,
                    description: `Wallet share of split payment for booking ${payment.booking.bookingNumber}`,
                    referenceId: payment.bookingId,
                    referenceType: "booking_wallet_payment",
                    completedAt: new Date(),
                  },
                });
                await tx.user.update({ where: { id: userId }, data: { walletBalance: newBalance, walletBalancePaise: toPaise(newBalance) } });
                await financialLedgerService.recordJournalInTransaction(tx, {
                  type: JournalEntryType.WALLET_DEBIT,
                  referenceId: wtxn.id,
                  referenceType: "wallet_transaction",
                  idempotencyKey: `wallet_debit:${wtxn.id}`,
                  description: `Wallet share of split for booking ${payment.booking.bookingNumber}`,
                  lines: [
                    { accountCode: "CUSTOMER_WALLET", debit: walletAmount, credit: 0 },
                    { accountCode: "PLATFORM_ESCROW", debit: 0, credit: walletAmount },
                  ],
                });
                walletApplied = walletAmount;
              }
            }

            // --- razorpay leg: captured at the gateway, so recorded whatever happens next ---
            await tx.payment.update({
              where: { id: payment.id },
              data: {
                razorpayPaymentId,
                ...(razorpaySignature ? { razorpaySignature } : {}),
                status: PaymentStatus.SUCCESS,
                amountPaid: remainder,
                amountPaidPaise: toPaise(remainder),
                completedAt: new Date(),
              },
            });
            if (remainder > 0) {
              await financialLedgerService.recordJournalInTransaction(tx, financialLedgerService.journalForBookingPayment(payment.id, remainder));
            }

            if (shortfall) {
              await tx.booking.update({ where: { id: payment.bookingId }, data: { paymentStatus: PaymentStatus.FAILED } });
              return { shortfall: true };
            }

            await applyBookingPaymentSuccess(tx, payment.bookingId, {
              capturedAmount: remainder,
              source,
              paymentMethod: "wallet_razorpay_split",
            });
            return { ok: true, status: "SUCCESS", bookingId: payment.bookingId, walletApplied, razorpayApplied: remainder, balance: newBalance };
          },
          { isolationLevel: "Serializable" },
        ),
      );
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg === "ALREADY_SETTLED") return { error: "ALREADY_SETTLED" };
      throw e;
    }

    if ("shortfall" in result) {
      incCounter("split_wallet_shortfall_total", { source });
      logger.warn("split_wallet_shortfall_refunding_gateway_leg", { category: "PAYMENT", paymentId: payment.id, bookingId: payment.bookingId, walletAmount });
      void this.refundSplitShortfall(payment.id).catch(() => undefined);
      return { error: "WALLET_DEBIT_FAILED" };
    }
    if ("ok" in result && result.ok) {
      onBookingPaymentSettledBackground(payment.bookingId, source);
    }
    return result;
  },

  /** Return a split's captured gateway leg in full when its wallet share could not be charged. */
  async refundSplitShortfall(paymentId: string) {
    const payment = await prisma.payment.findUnique({ where: { id: paymentId }, select: { amountPaid: true, amount: true } });
    if (!payment) return { error: "NOT_FOUND" as const };
    const { refundOrchestratorService } = await import("./refund-orchestrator.service");
    return refundOrchestratorService.executeRefund({
      paymentId,
      amount: payment.amountPaid || payment.amount,
      reason: "Split payment: wallet share could not be charged — gateway leg returned",
      actorUserId: "system",
      isAdmin: true,
      source: "workflow",
      idempotencyKey: `split-shortfall:${paymentId}`,
    });
  },

  /**
   * Durable backstop for `refundSplitShortfall`: a split whose gateway leg was captured while the
   * booking stayed unpaid, and whose shortfall refund never started (the process died after commit).
   */
  async recoverSplitShortfallRefunds(limit = 25): Promise<{ scanned: number; started: number }> {
    const rows = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT p.id FROM payments p
      JOIN bookings b ON b.id = p.booking_id
      WHERE p.payment_method = 'wallet_razorpay_split'
        AND p.status::text = 'SUCCESS'
        AND b.payment_status::text = 'FAILED'
        AND p.completed_at < NOW() - INTERVAL '60 seconds'
        AND NOT EXISTS (SELECT 1 FROM refund_requests r WHERE r.idempotency_key = 'split-shortfall:' || p.id)
      ORDER BY p.completed_at ASC
      LIMIT ${limit}`;
    let started = 0;
    for (const r of rows) {
      const res = await this.refundSplitShortfall(r.id);
      if (!("error" in res)) started++;
    }
    return { scanned: rows.length, started };
  },

  /**
   * Phase 18.3 — multi-source allocation PREVIEW (read-only). Applies the priority
   * Gift Card → HCoin → Wallet → Razorpay against the booking's finalAmount and returns
   * how much each source would cover. No redemption happens here.
   */
  async multiSourceQuote(
    userId: string,
    bookingId: string,
    opts: { giftCardCode?: string; hCoinCoins?: number },
  ): Promise<MultiSourceQuote | { error: "BOOKING_NOT_FOUND" }> {
    const booking = await prisma.booking.findFirst({ where: { id: bookingId, userId }, select: { finalAmount: true, paymentStatus: true } });
    if (!booking) return { error: "BOOKING_NOT_FOUND" };
    const final = booking.finalAmount;

    let giftCardAvailable = 0;
    if (opts.giftCardCode) {
      const card = await prisma.giftCard.findUnique({ where: { code: opts.giftCardCode.trim().toUpperCase() }, select: { status: true, balance: true, expiresAt: true } });
      if (card && card.status === "ACTIVE" && (!card.expiresAt || card.expiresAt > new Date())) giftCardAvailable = card.balance;
    }
    const giftCardUsed = round2(Math.min(giftCardAvailable, final));
    let remaining = round2(final - giftCardUsed);

    const hcoin = await hcoinService.wallet(userId);
    const maxHCoinRupees = Math.floor(hcoin.balance * COIN_TO_RUPEE);
    const requestedHCoinRupees = opts.hCoinCoins ? Math.floor(opts.hCoinCoins * COIN_TO_RUPEE) : maxHCoinRupees;
    const hCoinUsed = round2(Math.min(requestedHCoinRupees, maxHCoinRupees, remaining));
    remaining = round2(remaining - hCoinUsed);

    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { walletBalance: true } });
    const walletUsed = round2(Math.min(user.walletBalance, remaining));
    const gatewayUsed = round2(remaining - walletUsed);

    return {
      bookingId,
      finalAmount: final,
      giftCardUsed,
      hCoinUsed,
      walletUsed,
      gatewayUsed,
      giftCardAvailable,
      hCoinRedeemableRupees: maxHCoinRupees,
      walletBalance: user.walletBalance,
      alreadyPaid: booking.paymentStatus === "SUCCESS",
    };
  },

  /**
   * Phase 18.3 — execute multi-source payment. Redeems the gift card + HCoins into the
   * wallet (each via its OWN already-certified, integrity-safe path) so the priority
   * collapses to wallet + Razorpay, then runs the certified 18.2 split. Returns the
   * source breakdown plus either a wallet-only success or a Razorpay order for the
   * remainder. Redemptions persist to the wallet even if the gateway leg is abandoned.
   */
  async payMultiSource(
    userId: string,
    bookingId: string,
    opts: { giftCardCode?: string; hCoinCoins?: number; useWallet?: boolean },
  ): Promise<MultiSourcePayResult> {
    const booking = await prisma.booking.findFirst({ where: { id: bookingId, userId }, select: { finalAmount: true, paymentStatus: true, status: true } });
    if (!booking) return { error: "BOOKING_NOT_FOUND" };
    if (booking.paymentStatus === "SUCCESS") return { error: "ALREADY_PAID" };
    // Before any gift card or H-Coin is redeemed for it.
    if (!isPayableBookingStatus(booking.status)) return { error: "BOOKING_NOT_PAYABLE" };
    const final = booking.finalAmount;

    let giftCardUsed = 0;
    let hCoinUsed = 0;

    // 1) Gift card → wallet (full-card redeem; excess stays in wallet). One-time &
    //    concurrency-safe via the gift-card service's optimistic lock (ALREADY_REDEEMED).
    if (opts.giftCardCode) {
      const r = await giftCardService.redeem(userId, opts.giftCardCode);
      if ("error" in r) return { error: `GIFT_CARD_${r.error}` };
      giftCardUsed = r.amount;
    }

    // 2) HCoins → wallet (rupee credit).
    if (opts.hCoinCoins && opts.hCoinCoins > 0) {
      const r = await hcoinService.redeem(userId, opts.hCoinCoins);
      if ("error" in r) return { error: `HCOIN_${r.error}` };
      hCoinUsed = r.rupees;
    }

    // 3) Wallet (incl. just-redeemed credits) + Razorpay remainder via the certified split.
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { walletBalance: true } });
    const walletAmount = opts.useWallet === false ? 0 : round2(Math.min(user.walletBalance, final));
    const split = await this.initiateSplit(userId, bookingId, walletAmount);
    if ("error" in split) return { error: split.error };

    const sources = { giftCardUsed, hCoinUsed, walletUsed: round2(Math.max(0, walletAmount - giftCardUsed - hCoinUsed)), gatewayUsed: round2(final - Math.min(walletAmount, final)) };
    return { ok: true, sources, ...split };
  },
};

type MultiSourceQuote = {
  bookingId: string;
  finalAmount: number;
  giftCardUsed: number;
  hCoinUsed: number;
  walletUsed: number;
  gatewayUsed: number;
  giftCardAvailable: number;
  hCoinRedeemableRupees: number;
  walletBalance: number;
  alreadyPaid: boolean;
};

type MultiSourcePayResult =
  | ({ ok: true; sources: { giftCardUsed: number; hCoinUsed: number; walletUsed: number; gatewayUsed: number } } & (
      | { mode: "wallet_only"; status: "SUCCESS"; walletTransactionId: string | null; amountPaid: number; balance: number }
      | { mode: "split"; razorpayOrderId: string; razorpayAmount: number; walletAmount: number; finalAmount: number; key: string | undefined }
    ))
  | { error: string };

function safeJson(s: string | null): Record<string, unknown> | null {
  if (!s) return null;
  try {
    return JSON.parse(s) as Record<string, unknown>;
  } catch {
    return null;
  }
}

type SplitInitResult =
  | { mode: "wallet_only"; status: "SUCCESS"; walletTransactionId: string | null; amountPaid: number; balance: number }
  | { mode: "split"; razorpayOrderId: string; razorpayAmount: number; walletAmount: number; finalAmount: number; key: string | undefined }
  | { error: "BOOKING_NOT_FOUND" | "ALREADY_PAID" | "INVALID_AMOUNT" | "INSUFFICIENT_WALLET_BALANCE" | "BOOKING_NOT_PAYABLE" | "WALLET_NOT_ALLOWED" | "SPLIT_NOT_ALLOWED" | "RETRY_CONFLICT" };

type SplitVerifyResult =
  | { ok: true; status: "SUCCESS"; bookingId: string; walletApplied: number; razorpayApplied: number; balance: number }
  | { error: "NOT_FOUND" | "INVALID_SIGNATURE" | "ALREADY_SETTLED" | "WALLET_DEBIT_FAILED" };
