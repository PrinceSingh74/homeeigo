import { isWalletTender, refundTenderLabel } from "../lib/refund-tender";
import { PaymentStatus, Prisma, RefundRequestStatus, WalletTxnStatus, WalletTxnType } from "@prisma/client";
import prisma from "../lib/prisma";
import { nextWalletTxnNumber } from "../lib/booking-number";
import { rupeesToPaise } from "../lib/money-paise";
import { recordFinancialMetric } from "../lib/financial-metrics";
import { validateAdminRefundAmount } from "../lib/payment-refund-rules";
import { financialLedgerService } from "./financial-ledger.service";
import { refundOrchestratorService, type ReserveResult } from "./refund-orchestrator.service";
import {
  cancellationPolicyService,
  cancellationPolicyFromSnapshot,
  type CancellationActor,
} from "./cancellation-policy.service";
import { AuditLogService, type SecurityEvent } from "./audit-log.service";
import { cashbackService } from "./cashback.service";
import { notificationService } from "./notification.service";
import { refundLedgerSyncService } from "./refund-ledger-sync.service";

const MAX_REFUND_RETRIES = 5;

/**
 * ── OWNER DECISION #8: the refund retry backoff schedule ───────────────────
 *
 * With no backoff all five attempts are spent within 25 minutes, one per maintenance tick. A
 * gateway outage lasting half an hour therefore burns every attempt on every refund in flight, and
 * those customers then need a human to notice and intervene before their money moves. That is the
 * failure worth designing against: not a slow refund, but a refund that has quietly run out of
 * chances while nobody was looking.
 *
 * The schedule is exponential from a base equal to the maintenance interval, with the FIRST retry
 * left immediate. That last detail is what makes this safe to adopt: `runRefundRetry` already ticks
 * every five minutes, so a refund that fails is retried on the next tick exactly as it always was —
 * no customer waits longer for their first second chance. Only the tail spreads:
 *
 *     attempt 1 -> next tick        (unchanged)
 *     attempt 2 -> +5 minutes
 *     attempt 3 -> +10 minutes
 *     attempt 4 -> +20 minutes
 *     attempt 5 -> +40 minutes
 *
 * The budget now spans roughly 75 minutes rather than 25, so an outage has to last over an hour
 * before a refund is exhausted, and the fast path is untouched. Set REFUND_RETRY_BACKOFF_SEC to
 * override the base, or 0 to restore the old flat cadence.
 */
const REFUND_RETRY_BACKOFF_SEC = Number(process.env.REFUND_RETRY_BACKOFF_SEC ?? 300);

/**
 * Earliest instant an attempt may be repeated. `null` means "eligible on the next tick".
 *
 * `attempt` is the attempt that was just made, so attempt 1 returning null is the first retry
 * keeping today's latency.
 */
export function nextRefundRetryAt(attempt: number, now = new Date()): Date | null {
  if (REFUND_RETRY_BACKOFF_SEC <= 0) return null;
  if (attempt < 2) return null;
  const delaySec = REFUND_RETRY_BACKOFF_SEC * 2 ** (attempt - 2);
  return new Date(now.getTime() + delaySec * 1000);
}

/**
 * How long a gateway refund may sit in REFUNDING (or INDETERMINATE) before recovery asks the gateway
 * what happened. Far above the 30s gateway timeout, so a live attempt is never mistaken for a dead one.
 */
const STALE_REFUND_MS = Number(process.env.REFUND_STALE_RECOVERY_SEC ?? 300) * 1000;

/** Split checkout: part paid from the wallet, the rest through the gateway. */
export const SPLIT_PAYMENT_METHOD = "wallet_razorpay_split";

/** Booking payment states in which money was actually taken. */
export const PAID_BOOKING_STATUSES: ReadonlySet<string> = new Set(["SUCCESS", "REFUNDING", "PARTIALLY_REFUNDED", "REFUNDED"]);
/** What a cancellation — and the quote that previews it — says when nothing was paid. */
export const UNPAID_CANCEL_MESSAGE = "No payment was completed for this booking, so there is nothing to refund.";

// Refund tender follows how the money ARRIVED, never the payment-method label: `lib/refund-tender`.
export { arrivedThroughGateway, isWalletTender, refundTenderLabel } from "../lib/refund-tender";

export type SplitAllocation =
  | { gatewayPaise: bigint; walletPaise: bigint }
  | { error: "INVALID_AMOUNT" | "NOTHING_PAID" | "AMOUNT_EXCEEDS_REFUNDABLE" };

/**
 * ── OWNER DECISION: split refunds are proportional to the original tender ─────────────────────
 *
 * A refund of a booking paid partly from the wallet and partly through the gateway is divided in the
 * ratio the customer originally paid: ₹1,000 paid ₹400 wallet + ₹600 gateway refunds ₹500 as ₹200 to
 * the wallet and ₹300 to the gateway. All arithmetic is integer paise. The gateway share is the floor
 * of the exact proportion and the wallet takes the remainder, so the legs always sum to the request
 * exactly and the rounding residual (at most one paisa) deterministically lands in the wallet.
 *
 * Each leg is then clamped to what that leg can still refund, moving any excess to the other leg —
 * which only matters when earlier refunds were not proportional (a gateway-only admin refund issued
 * before this rule existed). The sum is never changed, and a request larger than both legs together
 * is refused rather than trimmed.
 */
export function allocateSplitRefund(
  requestedPaise: bigint,
  original: { gatewayPaise: bigint; walletPaise: bigint },
  remaining: { gatewayPaise: bigint; walletPaise: bigint },
): SplitAllocation {
  const total = original.gatewayPaise + original.walletPaise;
  if (requestedPaise <= 0n) return { error: "INVALID_AMOUNT" };
  if (total <= 0n) return { error: "NOTHING_PAID" };
  const gatewayRemaining = remaining.gatewayPaise > 0n ? remaining.gatewayPaise : 0n;
  const walletRemaining = remaining.walletPaise > 0n ? remaining.walletPaise : 0n;
  if (requestedPaise > gatewayRemaining + walletRemaining) return { error: "AMOUNT_EXCEEDS_REFUNDABLE" };

  let gatewayPaise = (requestedPaise * original.gatewayPaise) / total;
  let walletPaise = requestedPaise - gatewayPaise;
  if (gatewayPaise > gatewayRemaining) {
    walletPaise += gatewayPaise - gatewayRemaining;
    gatewayPaise = gatewayRemaining;
  }
  if (walletPaise > walletRemaining) {
    gatewayPaise += walletPaise - walletRemaining;
    walletPaise = walletRemaining;
  }
  return { gatewayPaise, walletPaise };
}

const paiseToRupees = (p: bigint): number => Number(p) / 100;

/** Thrown inside the split planning transaction to roll back a leg that must not stand alone. */
class SplitRefundRefused extends Error {}

export class BookingRefundService {
  async quoteForBooking(bookingId: string, cancelledBy: CancellationActor) {
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: {
        userId: true,
        finalAmount: true,
        scheduledDate: true,
        status: true,
        paymentStatus: true,
        paymentMethod: true,
        // The terms the booking was sold under: the quote the customer is shown must be computed
        // from the same policy the cancellation will charge against, or the two can disagree.
        serviceConfigSnapshot: true,
      },
    });
    if (!booking) return null;

    const payment = await prisma.payment.findUnique({
      where: { bookingId },
      select: { paymentMethod: true, razorpayPaymentId: true },
    });
    // What is still refundable across every tender (gateway + wallet), net of earlier refunds. The
    // cancellation itself computes its refund from the same function, so the two cannot disagree.
    const remaining = booking.userId ? await this.refundableRemaining(bookingId, booking.userId) : null;

    const quote = cancellationPolicyService.calculate({
      paidAmount: remaining ?? booking.finalAmount,
      scheduledDate: booking.scheduledDate,
      bookingStatus: booking.status,
      cancelledBy,
      paymentMethod: refundTenderLabel(payment, booking.paymentMethod),
      policy: cancellationPolicyFromSnapshot(booking.serviceConfigSnapshot),
    });

    // Nothing refundable AND no paid status: no capture, no wallet debit. The policy's numbers above
    // were computed on the PRICE, and the cancellation this previews refunds ₹0 and keeps no fee
    // (booking.service `nothingPaid`). An interrupted checkout (payment INITIATED) was quoted
    // "Paid ₹550 · You get back ₹550" on the mobile cancel dialog — coding-phase certification
    // 2026-09-28. A legacy paid booking without a payments row keeps the price fallback.
    if (remaining === null && !PAID_BOOKING_STATUSES.has(booking.paymentStatus)) {
      return { ...quote, paidAmount: 0, feeAmount: 0, feePercent: 0, refundAmount: 0, message: UNPAID_CANCEL_MESSAGE };
    }
    return quote;
  }

  /**
   * Process cancellation refund (idempotent). Wallet = instant credit; gateway = Razorpay + retry on fail.
   */
  async processCancellationRefund(opts: {
    bookingId: string;
    userId: string;
    actorUserId: string;
    reason: string;
    cancelledBy: CancellationActor;
    refundAmount: number;
  }): Promise<{ amount: number; status: string; failureReason?: string }> {
    const amount = Math.round(opts.refundAmount * 100) / 100;
    if (amount <= 0) return { amount: 0, status: "none" };

    const idempotencyKey = refundOrchestratorService.cancellationIdempotencyKey(opts.bookingId);
    const payment = await prisma.payment.findUnique({ where: { bookingId: opts.bookingId } });

    // Before any payment-status check: a split whose gateway leg is fully refunded may still owe its
    // wallet leg, and only the split path knows how to tell.
    if (payment?.paymentMethod === SPLIT_PAYMENT_METHOD) {
      return this.processSplitRefund({
        bookingId: opts.bookingId,
        userId: opts.userId,
        actorUserId: opts.actorUserId,
        reason: opts.reason,
        amount,
        source: "cancellation",
        gatewayKey: idempotencyKey,
        walletKey: `wallet-cancel-refund:${opts.bookingId}`,
        walletReferenceType: "booking_cancel_refund",
        walletDescription: "Booking cancellation refund (wallet share)",
        walletJournal: (walletAmount) => financialLedgerService.journalForWalletBookingRefund(opts.bookingId, walletAmount),
        auditAction: "BOOKING_CANCEL_REFUND",
      });
    }

    /**
     * ── Wallet-funded bookings have no payments row ────────────────────────────
     *
     * `walletCheckoutService.payBookingFromWallet` settles a booking with a wallet DEBIT and a
     * WALLET_DEBIT journal and deliberately writes no `payments` row. This branch used to return
     * `{0, "none"}` for every such booking, so a customer quoted "Free cancellation — full refund"
     * received ₹0 and the funds stayed in PLATFORM_ESCROW. The refund is now credited against the
     * booking's own wallet debits (see `creditWalletRefund`), with the same keys and journal the
     * payment-row wallet path uses.
     */
    if (!payment) {
      if (!(await this.isWalletFundedBooking(opts.bookingId, opts.userId))) return { amount: 0, status: "none" };
      return this.creditWalletRefund({
        bookingId: opts.bookingId,
        userId: opts.userId,
        paymentId: null,
        amount,
        reason: opts.reason,
        actorUserId: opts.actorUserId,
        idempotencyKey,
      });
    }
    if (payment.status !== PaymentStatus.SUCCESS && payment.status !== PaymentStatus.PARTIALLY_REFUNDED) {
      return { amount: 0, status: "none" };
    }
    const existing = await prisma.refundRequest.findUnique({ where: { idempotencyKey } });
    if (existing?.status === RefundRequestStatus.COMPLETED) {
      return { amount: existing.amount, status: "processed" };
    }

    // Evidence, not label: see `isWalletTender`.
    const isWallet = isWalletTender(payment);
    if (isWallet) {
      return this.creditWalletRefund({
        bookingId: opts.bookingId,
        userId: opts.userId,
        paymentId: payment.id,
        amount,
        reason: opts.reason,
        actorUserId: opts.actorUserId,
        idempotencyKey,
      });
    }

    if (!payment.razorpayPaymentId) {
      await this.markRefundPending(idempotencyKey, payment.id, opts.userId, amount, opts.reason, opts.actorUserId);
      return { amount, status: "pending" };
    }

    const result = await refundOrchestratorService.executeRefund({
      paymentId: payment.id,
      amount,
      reason: opts.reason,
      actorUserId: opts.actorUserId,
      isAdmin: true,
      source: "cancellation",
      idempotencyKey,
      bookingId: opts.bookingId,
    });

    if ("error" in result) {
      if (result.error === "REFUND_IN_PROGRESS") {
        return { amount, status: "processing" };
      }
      recordFinancialMetric("refund_failure_total", 1);
      return { amount, status: "pending" };
    }

    void this.notifyCustomerRefund(opts.userId, opts.bookingId, amount, "gateway");
    return { amount: result.amount, status: result.status === "processed" ? "processed" : "processing" };
  }

  /**
   * Admin-initiated, possibly partial, refund of a settled booking payment.
   *
   * Server-authoritative on amount: validated against `amountPaid − refundedAmount` before the
   * gateway call and again under a row lock inside the wallet transaction, so two concurrent admin
   * refunds cannot together exceed what the customer paid. The idempotency key is per
   * (booking, amount, admin): a retried identical request is a no-op, while a second *different*
   * partial refund is allowed and re-validated against the remaining balance.
   */
  async processAdminRefund(opts: {
    bookingId: string;
    userId: string;
    adminId: string;
    amount: number;
    reason: string;
    /**
     * §11: an operation-scoped identity instead of (booking, amount, admin) — a complaint case passes
     * `case-refund:<caseId>` so a second refund for the same case, by any admin and of any amount,
     * replays the first instead of becoming a new refund.
     */
    keys?: { idempotencyKey: string; walletKey: string };
  }): Promise<{ amount: number; status: string; idempotencyKey: string } | { error: string }> {
    const amount = Math.round(opts.amount * 100) / 100;
    if (!Number.isFinite(amount) || amount <= 0) return { error: "INVALID_AMOUNT" };

    const payment = await prisma.payment.findUnique({ where: { bookingId: opts.bookingId } });
    const amountPaise = rupeesToPaise(amount);
    const idempotencyKey = opts.keys?.idempotencyKey ?? `admin-refund:${opts.bookingId}:${amountPaise}:${opts.adminId}`;
    const adminWalletKey = opts.keys?.walletKey ?? `wallet-admin-refund:${opts.bookingId}:${amountPaise}:${opts.adminId}`;

    if (!payment) {
      // Wallet-funded booking: no payments row by design. The ceiling is enforced under lock inside
      // `creditWalletRefund` against the booking's own wallet debits and earlier wallet refunds.
      if (!(await this.isWalletFundedBooking(opts.bookingId, opts.userId))) return { error: "NO_PAYMENT" };
      const result = await this.creditWalletRefund({
        bookingId: opts.bookingId,
        userId: opts.userId,
        paymentId: null,
        amount,
        reason: opts.reason,
        actorUserId: opts.adminId,
        idempotencyKey,
        walletKey: adminWalletKey,
        referenceType: "booking_admin_refund",
        description: "Refund issued by support",
        journal: financialLedgerService.journalForWalletAdminRefund(opts.bookingId, amount, idempotencyKey),
        auditAction: "PAYMENT_REFUND",
      });
      if (result.status === "pending") return { error: result.failureReason ?? "WALLET_REFUND_FAILED" };
      return { amount: result.amount, status: result.status, idempotencyKey };
    }

    if (payment.paymentMethod === SPLIT_PAYMENT_METHOD) {
      const result = await this.processSplitRefund({
        bookingId: opts.bookingId,
        userId: opts.userId,
        actorUserId: opts.adminId,
        reason: opts.reason,
        amount,
        source: "admin",
        gatewayKey: idempotencyKey,
        walletKey: adminWalletKey,
        walletReferenceType: "booking_admin_refund",
        walletDescription: "Refund issued by support (wallet share)",
        walletJournal: (walletAmount) =>
          financialLedgerService.journalForWalletAdminRefund(opts.bookingId, walletAmount, idempotencyKey),
        auditAction: "PAYMENT_REFUND",
      });
      if (result.status === "pending") return { error: result.failureReason ?? "SPLIT_REFUND_FAILED" };
      return { amount: result.amount, status: result.status, idempotencyKey };
    }

    const validation = validateAdminRefundAmount(amount, payment);
    if (!validation.ok) return { error: validation.reason };

    // Evidence, not label: see `isWalletTender`.
    if (isWalletTender(payment)) {
      const result = await this.creditWalletRefund({
        bookingId: opts.bookingId,
        userId: opts.userId,
        paymentId: payment.id,
        amount,
        reason: opts.reason,
        actorUserId: opts.adminId,
        idempotencyKey,
        walletKey: adminWalletKey,
        referenceType: "booking_admin_refund",
        description: "Refund issued by support",
        journal: financialLedgerService.journalForWalletAdminRefund(opts.bookingId, amount, idempotencyKey),
        auditAction: "PAYMENT_REFUND",
      });
      if (result.status === "pending") return { error: result.failureReason ?? "WALLET_REFUND_FAILED" };
      return { amount: result.amount, status: result.status, idempotencyKey };
    }

    if (!payment.razorpayPaymentId) return { error: "GATEWAY_PAYMENT_ID_MISSING" };

    const result = await refundOrchestratorService.executeRefund({
      paymentId: payment.id,
      amount,
      reason: opts.reason,
      actorUserId: opts.adminId,
      isAdmin: true,
      source: "admin",
      idempotencyKey,
      bookingId: opts.bookingId,
    });
    if ("error" in result) return { error: result.error };

    void this.notifyCustomerRefund(opts.userId, opts.bookingId, result.amount, "gateway");
    return {
      amount: result.amount,
      status: result.status === "processed" ? "processed" : "processing",
      idempotencyKey,
    };
  }

  /**
   * ── Split refunds: one request, two legs ─────────────────────────────────────────────────────
   *
   * `verifySplit` stores only the gateway share in `payments`; the wallet share exists as the booking's
   * wallet DEBIT (and its WALLET_DEBIT journal into PLATFORM_ESCROW). Refunding from the payment row
   * alone therefore returned the gateway share and left the wallet share in escrow for good.
   *
   * The whole decision is made in ONE transaction holding the wallet advisory lock, the booking row
   * and the payment row — the same locks the wallet-only refund and the gateway reservation take — so
   * every concurrent refund of this booking sees a consistent state and the next one sees what this
   * one consumed. In that transaction the wallet leg is credited and the gateway leg is reserved
   * (refund request + payment REFUNDING); either both commit or neither does. The gateway call then
   * runs outside it through the orchestrator's own completion path.
   *
   * Allocation is computed from the ORIGINAL tender minus refunds made by OTHER requests, so a retry
   * of this request — after a crash, a timeout, or a lost response — recomputes exactly the same two
   * legs, and each leg is skipped if its own idempotency key already shows it done.
   */
  private async processSplitRefund(opts: {
    bookingId: string;
    userId: string;
    actorUserId: string;
    reason: string;
    amount: number;
    source: "cancellation" | "admin";
    gatewayKey: string;
    walletKey: string;
    walletReferenceType: string;
    walletDescription: string;
    walletJournal: (walletAmount: number) => ReturnType<typeof financialLedgerService.journalForWalletBookingRefund>;
    auditAction: SecurityEvent;
  }): Promise<{ amount: number; status: string; failureReason?: string; gatewayAmount?: number; walletAmount?: number }> {
    const requestedPaise = rupeesToPaise(opts.amount);
    type Plan =
      | { kind: "in_progress" }
      | { kind: "busy" }
      | { kind: "refused"; reason: string }
      | {
          kind: "planned";
          gatewayPaise: bigint;
          walletPaise: bigint;
          walletCredited: boolean;
          gatewayAlreadyDone: boolean;
          reservation: Extract<ReserveResult, { proceed: true }> | null;
        };

    let plan: Plan;
    try {
      plan = await prisma.$transaction(
        async (tx): Promise<Plan> => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"wallet_pay:" + opts.userId}))`;
          await tx.$executeRaw`SELECT id FROM bookings WHERE id = ${opts.bookingId} FOR UPDATE`;
          await tx.$executeRaw`SELECT id FROM payments WHERE booking_id = ${opts.bookingId} FOR UPDATE`;
          const payment = await tx.payment.findUniqueOrThrow({ where: { bookingId: opts.bookingId } });
          const ownGateway = await tx.refundRequest.findUnique({ where: { idempotencyKey: opts.gatewayKey } });
          const ownWallet = await tx.walletTransaction.findUnique({ where: { idempotencyKey: opts.walletKey } });

          // This request's gateway leg is already at the gateway: report it, never start a second one.
          if (
            ownGateway &&
            (ownGateway.status === RefundRequestStatus.REFUNDING ||
              ownGateway.status === RefundRequestStatus.PROCESSING ||
              ownGateway.status === RefundRequestStatus.INDETERMINATE)
          ) {
            return { kind: "in_progress" };
          }
          // Some OTHER refund holds the gateway leg. Its amount is not settled yet, so no ceiling can
          // be computed honestly. This request did nothing, and must not say otherwise: an admin told
          // "processing" here would believe a refund was issued. The cancellation's intent row stays
          // pending and is finished by the stranded-refund sweep once the other refund resolves.
          if (payment.status === PaymentStatus.REFUNDING) return { kind: "busy" };

          const gatewayDone = ownGateway?.status === RefundRequestStatus.COMPLETED;
          const walletDone = ownWallet?.status === WalletTxnStatus.COMPLETED;
          const ownGatewayPaise = gatewayDone ? rupeesToPaise(ownGateway!.amount) : 0n;
          const ownWalletPaise = walletDone ? rupeesToPaise(ownWallet!.amount) : 0n;

          const wallet = await this.walletFundedRefundable(tx, opts.bookingId, opts.userId);
          const gatewayPaid =
            payment.status === PaymentStatus.SUCCESS ||
            payment.status === PaymentStatus.PARTIALLY_REFUNDED ||
            payment.status === PaymentStatus.REFUNDED;
          const gatewayOriginal = gatewayPaid ? rupeesToPaise(payment.amountPaid || payment.amount) : 0n;
          const gatewayRefunded = rupeesToPaise(payment.refundedAmount ?? 0);

          const alloc = allocateSplitRefund(
            requestedPaise,
            { gatewayPaise: gatewayOriginal, walletPaise: wallet.paidPaise },
            {
              gatewayPaise: gatewayOriginal - (gatewayRefunded - ownGatewayPaise),
              walletPaise: wallet.paidPaise - (wallet.refundedPaise - ownWalletPaise),
            },
          );
          if ("error" in alloc) return { kind: "refused", reason: alloc.error };

          let walletCredited = false;
          if (alloc.walletPaise > 0n && !walletDone) {
            const walletAmount = paiseToRupees(alloc.walletPaise);
            await this.applyWalletRefundInTx(tx, {
              bookingId: opts.bookingId,
              userId: opts.userId,
              paymentId: null,
              amount: walletAmount,
              reason: opts.reason,
              actorUserId: opts.actorUserId,
              idempotencyKey: opts.gatewayKey,
              walletKey: opts.walletKey,
              referenceType: opts.walletReferenceType,
              description: opts.walletDescription,
              journal: opts.walletJournal(walletAmount),
            });
            walletCredited = true;
          }

          let reservation: Extract<ReserveResult, { proceed: true }> | null = null;
          if (alloc.gatewayPaise > 0n && !gatewayDone) {
            const reserved = await refundOrchestratorService.reserveInTx(tx, {
              paymentId: payment.id,
              amount: paiseToRupees(alloc.gatewayPaise),
              reason: opts.reason,
              actorUserId: opts.actorUserId,
              source: opts.source,
              idempotencyKey: opts.gatewayKey,
            });
            // A leg that cannot be reserved must not leave the other leg standing alone.
            if (!reserved.proceed) {
              const r = reserved.result;
              throw new SplitRefundRefused("error" in r ? r.error : "GATEWAY_LEG_NOT_RESERVED");
            }
            reservation = reserved;
          }

          return {
            kind: "planned",
            gatewayPaise: alloc.gatewayPaise,
            walletPaise: alloc.walletPaise,
            walletCredited,
            gatewayAlreadyDone: gatewayDone,
            reservation,
          };
        },
        { maxWait: 10_000, timeout: 20_000 },
      );
    } catch (err) {
      const reason = err instanceof Error ? err.message : "split_refund_failed";
      recordFinancialMetric("refund_failure_total", 1);
      void AuditLogService.failure(opts.auditAction, { userId: opts.actorUserId, bookingId: opts.bookingId, reason });
      return { amount: opts.amount, status: "pending", failureReason: reason };
    }

    if (plan.kind === "in_progress") return { amount: opts.amount, status: "processing" };
    if (plan.kind === "busy") return { amount: opts.amount, status: "pending", failureReason: "REFUND_IN_PROGRESS" };
    if (plan.kind === "refused") {
      recordFinancialMetric("refund_failure_total", 1);
      return { amount: opts.amount, status: "pending", failureReason: plan.reason };
    }

    const walletAmount = paiseToRupees(plan.walletPaise);
    const gatewayAmount = paiseToRupees(plan.gatewayPaise);
    if (plan.walletCredited) {
      this.afterWalletRefund({ bookingId: opts.bookingId, userId: opts.userId, actorUserId: opts.actorUserId, amount: walletAmount }, opts.auditAction);
    }

    let gatewayStatus = plan.gatewayPaise === 0n || plan.gatewayAlreadyDone ? "processed" : "pending";
    if (plan.reservation) {
      const result = await refundOrchestratorService.completeReserved({
        payment: plan.reservation.payment,
        refundRequestId: plan.reservation.refundRequestId,
        amount: gatewayAmount,
        reason: opts.reason,
        actorUserId: opts.actorUserId,
        source: opts.source,
        idempotencyKey: opts.gatewayKey,
        bookingId: opts.bookingId,
      });
      if ("error" in result) {
        // REJECTED is recorded FAILED (retried with backoff for cancellations); an unknown outcome is
        // INDETERMINATE and settled by reconciliation. Either way the wallet leg already stands.
        recordFinancialMetric("refund_failure_total", 1);
        return { amount: opts.amount, status: "pending", failureReason: result.error, gatewayAmount, walletAmount };
      }
      void this.notifyCustomerRefund(opts.userId, opts.bookingId, gatewayAmount, "gateway");
      gatewayStatus = result.status === "processed" ? "processed" : "processing";
    }

    return { amount: opts.amount, status: gatewayStatus, gatewayAmount, walletAmount };
  }

  /** Settled from the wallet in full: `payBookingFromWallet` marks it so and writes no payments row. */
  private async isWalletFundedBooking(bookingId: string, userId: string): Promise<boolean> {
    const booking = await prisma.booking.findFirst({
      where: { id: bookingId, userId },
      select: { paymentMethod: true, paymentStatus: true },
    });
    return booking?.paymentMethod === "wallet" && booking.paymentStatus === PaymentStatus.SUCCESS;
  }

  /**
   * What a wallet-funded booking can still refund, in paise: its completed wallet debits minus the
   * wallet refunds already credited against it. Read inside the caller's locks.
   */
  private async walletFundedRefundable(
    tx: Pick<Prisma.TransactionClient, "$queryRaw">,
    bookingId: string,
    userId: string,
  ): Promise<{ paidPaise: bigint; refundedPaise: bigint }> {
    const rows = await tx.$queryRaw<Array<{ paid: bigint; refunded: bigint }>>`
      SELECT
        coalesce(sum(amount_paise) FILTER (
          WHERE type::text = 'DEBIT' AND reference_type = 'booking_wallet_payment'), 0)::bigint AS paid,
        coalesce(sum(amount_paise) FILTER (
          WHERE type::text = 'REFUND' AND reference_type IN ('booking_cancel_refund', 'booking_admin_refund')), 0)::bigint AS refunded
      FROM wallet_transactions
      WHERE reference_id = ${bookingId} AND user_id = ${userId} AND status::text = 'COMPLETED'
    `;
    return { paidPaise: rows[0]?.paid ?? 0n, refundedPaise: rows[0]?.refunded ?? 0n };
  }

  /**
   * Credit a refund to the customer's wallet.
   *
   * `paymentId` is null for a wallet-funded booking, which has no payments row. The refundable ceiling
   * then comes from the booking's own wallet debits, serialized by the same per-user advisory lock
   * wallet checkout takes plus the booking row lock, and no refund_requests / payments rows are
   * written (refund_requests.payment_id would have nothing true to point at). The wallet transaction,
   * its idempotency key and the REFUND journal are exactly those of the payment-row path.
   */
  private async creditWalletRefund(opts: {
    bookingId: string;
    userId: string;
    paymentId: string | null;
    amount: number;
    reason: string;
    actorUserId: string;
    idempotencyKey: string;
    /** Wallet-transaction idempotency key; defaults to the per-booking cancellation key. */
    walletKey?: string;
    referenceType?: string;
    description?: string;
    journal?: ReturnType<typeof financialLedgerService.journalForWalletBookingRefund>;
    auditAction?: SecurityEvent;
  }): Promise<{ amount: number; status: string; failureReason?: string }> {
    const walletKey = opts.walletKey ?? `wallet-cancel-refund:${opts.bookingId}`;
    const auditAction = opts.auditAction ?? "BOOKING_CANCEL_REFUND";
    const existingTxn = await prisma.walletTransaction.findUnique({
      where: { idempotencyKey: walletKey },
    });
    if (existingTxn?.status === WalletTxnStatus.COMPLETED) {
      return { amount: opts.amount, status: "processed" };
    }

    try {
      await prisma.$transaction((tx) => this.applyWalletRefundInTx(tx, { ...opts, walletKey }), {
        maxWait: 10_000,
        timeout: 20_000,
      });
    } catch (err) {
      /**
       * Losing a race to an identical refund is not a failure. The winner's wallet credit (same
       * idempotency key) is the refund; reporting "pending" here let a concurrent caller write
       * refundStatus "pending" back over a booking whose refund had already been credited.
       */
      const done = await prisma.walletTransaction
        .findUnique({ where: { idempotencyKey: walletKey }, select: { status: true, amount: true } })
        .catch(() => null);
      if (done?.status === WalletTxnStatus.COMPLETED) return { amount: done.amount, status: "processed" };

      recordFinancialMetric("refund_failure_total", 1);
      const failureReason = err instanceof Error ? err.message : "wallet_refund_failed";
      void AuditLogService.failure(auditAction, {
        userId: opts.actorUserId,
        bookingId: opts.bookingId,
        reason: failureReason,
      });
      return { amount: opts.amount, status: "pending", failureReason };
    }

    this.afterWalletRefund(opts, auditAction);
    return { amount: opts.amount, status: "processed" };
  }

  /** Side effects of a committed wallet refund. Detached: none of them may undo or block the credit. */
  private afterWalletRefund(
    opts: { bookingId: string; userId: string; actorUserId: string; amount: number },
    auditAction: SecurityEvent,
  ) {
    void cashbackService.reverseOnRefund(opts.bookingId).catch(() => undefined);
    void AuditLogService.success(auditAction, {
      userId: opts.actorUserId,
      bookingId: opts.bookingId,
      details: { amount: opts.amount, channel: "wallet" },
    });
    void this.notifyCustomerRefund(opts.userId, opts.bookingId, opts.amount, "wallet");
    recordFinancialMetric("refund_success_total", 1);
  }

  /**
   * The wallet credit itself, inside the caller's transaction: ceiling re-checked under lock, wallet
   * row locked and measured, REFUND wallet transaction, and the REFUND journal (skipped if its key
   * already exists — the same rule `executeWithLedger` applies). With a `paymentId` it also records the
   * refund request and accumulates onto the payment; without one (wallet-funded booking, or the wallet
   * leg of a split) the ceiling is the booking's own wallet debits and neither table is touched.
   */
  private async applyWalletRefundInTx(
    tx: Prisma.TransactionClient,
    opts: {
      bookingId: string;
      userId: string;
      paymentId: string | null;
      amount: number;
      reason: string;
      actorUserId: string;
      idempotencyKey: string;
      walletKey: string;
      referenceType?: string;
      description?: string;
      journal?: ReturnType<typeof financialLedgerService.journalForWalletBookingRefund>;
    },
  ) {
    const walletKey = opts.walletKey;
    let fullyRefunded = false;
    if (opts.paymentId) {
      // Lock the payment row and re-validate under the lock: the pre-check outside the
      // transaction cannot see a concurrent refund that commits between check and credit.
      await tx.$executeRaw`SELECT id FROM payments WHERE id = ${opts.paymentId} FOR UPDATE`;
      const lockedPayment = await tx.payment.findUnique({
        where: { id: opts.paymentId },
        select: { amount: true, amountPaid: true, refundedAmount: true, status: true },
      });
      if (!lockedPayment) throw new Error("PAYMENT_NOT_FOUND");
      const paid = lockedPayment.amountPaid || lockedPayment.amount;
      const alreadyRefunded = lockedPayment.refundedAmount ?? 0;
      if (opts.amount > round2(paid - alreadyRefunded) + 0.005) {
        throw new Error("AMOUNT_EXCEEDS_REFUNDABLE");
      }
      const totalRefunded = round2(alreadyRefunded + opts.amount);
      fullyRefunded = totalRefunded >= paid - 0.005;
    } else {
      // Same advisory lock as wallet checkout, then the booking row: concurrent refunds of one
      // booking serialize here, and the loser sees the winner's credit in the ceiling below.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"wallet_pay:" + opts.userId}))`;
      await tx.$executeRaw`SELECT id FROM bookings WHERE id = ${opts.bookingId} FOR UPDATE`;
      const done = await tx.walletTransaction.findUnique({ where: { idempotencyKey: walletKey } });
      if (done?.status === WalletTxnStatus.COMPLETED) throw new Error("ALREADY_REFUNDED");
      const { paidPaise, refundedPaise } = await this.walletFundedRefundable(tx, opts.bookingId, opts.userId);
      if (paidPaise <= 0n) throw new Error("NOT_WALLET_FUNDED");
      if (rupeesToPaise(opts.amount) > paidPaise - refundedPaise) {
        throw new Error("AMOUNT_EXCEEDS_REFUNDABLE");
      }
    }

    // Measured, not derived: the balance snapshot on the wallet row must be read under lock.
    await tx.$executeRaw`SELECT id FROM users WHERE id = ${opts.userId} FOR UPDATE`;
    const user = await tx.user.findUnique({
      where: { id: opts.userId },
      select: { walletBalance: true },
    });
    if (!user) throw new Error("USER_NOT_FOUND");

    const balanceBefore = user.walletBalance;
    const balanceAfter = round2(balanceBefore + opts.amount);
    const creditPaise = rupeesToPaise(opts.amount);

    await tx.user.update({
      where: { id: opts.userId },
      data: {
        walletBalance: { increment: opts.amount },
        walletBalancePaise: { increment: creditPaise },
      },
    });

    const walletTxn = await tx.walletTransaction.create({
      data: {
        transactionNumber: await nextWalletTxnNumber(tx),
        userId: opts.userId,
        amount: opts.amount,
        walletBalanceBefore: balanceBefore,
        walletBalanceAfter: balanceAfter,
        type: WalletTxnType.REFUND,
        description: opts.description ?? `Booking cancellation refund`,
        referenceId: opts.bookingId,
        referenceType: opts.referenceType ?? "booking_cancel_refund",
        status: WalletTxnStatus.COMPLETED,
        idempotencyKey: walletKey,
      },
    });

    if (opts.paymentId) {
      await tx.refundRequest.upsert({
        where: { idempotencyKey: opts.idempotencyKey },
        create: {
          paymentId: opts.paymentId,
          userId: opts.userId,
          amount: opts.amount,
          reason: opts.reason,
          status: RefundRequestStatus.COMPLETED,
          requestedBy: opts.actorUserId,
          idempotencyKey: opts.idempotencyKey,
          gatewayRefundId: `wallet:${walletTxn.id}`,
          processedAt: new Date(),
          audits: {
            create: { action: "COMPLETED", actorId: opts.actorUserId, details: "wallet_instant" },
          },
        },
        update: {
          status: RefundRequestStatus.COMPLETED,
          processedAt: new Date(),
          gatewayRefundId: `wallet:${walletTxn.id}`,
        },
      });

      await tx.payment.update({
        where: { id: opts.paymentId },
        data: {
          // Accumulate, never overwrite: a partial refund followed by a cancellation refund
          // must add up, and the status must say PARTIALLY_REFUNDED until it does.
          status: fullyRefunded ? PaymentStatus.REFUNDED : PaymentStatus.PARTIALLY_REFUNDED,
          refundedAmount: { increment: opts.amount },
          refundedAmountPaise: { increment: creditPaise },
          refundReason: opts.reason,
          refundStatus: "processed",
        },
      });
    }

    const journal = opts.journal ?? financialLedgerService.journalForWalletBookingRefund(opts.bookingId, opts.amount);
    const journalExists = await tx.journalEntry.findUnique({ where: { idempotencyKey: journal.idempotencyKey }, select: { id: true } });
    if (!journalExists) await financialLedgerService.recordJournalInTransaction(tx, journal);
    return walletTxn;
  }

  private async markRefundPending(
    idempotencyKey: string,
    paymentId: string,
    userId: string,
    amount: number,
    reason: string,
    actorUserId: string,
  ) {
    await prisma.refundRequest.upsert({
      where: { idempotencyKey },
      create: {
        paymentId,
        userId,
        amount,
        reason,
        status: RefundRequestStatus.FAILED,
        requestedBy: actorUserId,
        idempotencyKey,
        audits: { create: { action: "FAILED", actorId: actorUserId, details: "awaiting_retry" } },
      },
      update: {
        status: RefundRequestStatus.FAILED,
        audits: { create: { action: "FAILED", actorId: actorUserId, details: "retry_scheduled" } },
      },
    });
  }

  /**
   * Retry cancellation refunds whose gateway call failed.
   *
   * ── Why this reads the row instead of counting audits ────────────────────────
   *
   * Eligibility used to be derived by counting each candidate's RETRY audit rows, AFTER the
   * candidates had already been chosen. A refund that had spent its attempts was then skipped with
   * `continue` — before anything wrote to it — so its `updated_at` froze while every row still being
   * retried kept having its refreshed. Exhausted rows drifted to the front of the `updated_at asc`
   * ordering and stayed there. Once `limit` of them existed they owned the window permanently, and a
   * customer whose refund failed afterwards was never retried again: no error, no alert, money
   * simply stopped moving.
   *
   * `retryCount` now lives on the row, so exhausted refunds are excluded by the WHERE clause and can
   * never occupy a slot. That also removes the audit-count query per candidate, and the booking reads
   * are batched — the scan went from 2N+1 queries to 3.
   */
  async retryFailedRefunds(limit = 20, now = new Date()): Promise<{ scanned: number; succeeded: number }> {
    const rows = await prisma.refundRequest.findMany({
      where: {
        status: RefundRequestStatus.FAILED,
        idempotencyKey: { startsWith: "cancel-refund:" },
        retryCount: { lt: MAX_REFUND_RETRIES },
        OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: now } }],
      },
      take: limit,
      orderBy: { updatedAt: "asc" },
    });
    if (rows.length === 0) return { scanned: 0, succeeded: 0 };

    // One read for every candidate's booking, not one per candidate.
    const bookingIds = rows.map((row) => row.idempotencyKey.replace("cancel-refund:", ""));
    const bookings = await prisma.booking.findMany({
      where: { id: { in: bookingIds } },
      select: { id: true, userId: true, cancellationReason: true, cancelledBy: true, refundAmount: true, paymentMethod: true },
    });
    const bookingById = new Map(bookings.map((b) => [b.id, b]));

    let succeeded = 0;
    for (const row of rows) {
      const bookingId = row.idempotencyKey.replace("cancel-refund:", "");
      const booking = bookingById.get(bookingId);
      if (!booking?.userId) continue;

      const attempt = row.retryCount + 1;
      /**
       * Claim the attempt before making it. If the process dies mid-refund the attempt is still
       * spent, which is the safe direction: a refund that may already have reached the gateway must
       * not be retried as though it never happened.
       */
      await prisma.refundRequest.update({
        where: { id: row.id },
        data: { retryCount: attempt, nextRetryAt: nextRefundRetryAt(attempt, now) },
      });
      await prisma.refundAudit.create({
        data: { refundRequestId: row.id, action: "RETRY", actorId: "system", details: `attempt_${attempt}` },
      });

      const result = await this.processCancellationRefund({
        bookingId,
        userId: booking.userId,
        actorUserId: "system",
        reason: booking.cancellationReason ?? "Cancellation refund retry",
        cancelledBy: booking.cancelledBy === "provider" ? "provider" : "user",
        // A split's request row carries only its gateway leg; the cancellation's refund is the booking's
        // total, which the split path divides again — deterministically, so the wallet leg already
        // credited is recognised and skipped.
        refundAmount: booking.paymentMethod === SPLIT_PAYMENT_METHOD ? (booking.refundAmount ?? row.amount) : row.amount,
      });

      if (result.status === "processed" || result.status === "processing") {
        succeeded++;
        await prisma.booking.updateMany({
          where: { id: bookingId },
          data: { refundStatus: result.status, refundAmount: result.amount },
        });
      }
    }

    return { scanned: rows.length, succeeded };
  }

  /**
   * Rupees this booking can still refund across every tender, or null if nothing was paid.
   *
   *   gateway leg = payments.amountPaid − refundedAmount − gateway refunds still in flight
   *   wallet leg  = the booking's wallet debits − wallet refunds (wallet-only bookings, and the wallet
   *                 share of a split; a legacy wallet payments row carries its wallet money in the
   *                 gateway formula instead, so it is not counted twice)
   *
   * Quotes and cancellations use it so a customer is promised exactly what the refund path can pay.
   */
  async refundableRemaining(bookingId: string, userId: string): Promise<number | null> {
    const payment = await prisma.payment.findUnique({ where: { bookingId } });
    const wallet = await this.walletFundedRefundable(prisma, bookingId, userId);
    const walletRemaining = wallet.paidPaise - wallet.refundedPaise > 0n ? wallet.paidPaise - wallet.refundedPaise : 0n;

    if (!payment) {
      if (!(await this.isWalletFundedBooking(bookingId, userId))) return null;
      return paiseToRupees(walletRemaining);
    }

    const gatewayPaid =
      payment.status === PaymentStatus.SUCCESS ||
      payment.status === PaymentStatus.PARTIALLY_REFUNDED ||
      payment.status === PaymentStatus.REFUNDED ||
      payment.status === PaymentStatus.REFUNDING;
    const isSplit = payment.paymentMethod === SPLIT_PAYMENT_METHOD;
    if (!gatewayPaid && !(isSplit && wallet.paidPaise > 0n)) return null;

    let gatewayRemaining = 0n;
    if (gatewayPaid) {
      const inFlight = await prisma.refundRequest.aggregate({
        where: {
          paymentId: payment.id,
          status: { in: [RefundRequestStatus.REFUNDING, RefundRequestStatus.PROCESSING, RefundRequestStatus.INDETERMINATE] },
        },
        _sum: { amount: true },
      });
      gatewayRemaining =
        rupeesToPaise(payment.amountPaid || payment.amount) -
        rupeesToPaise(payment.refundedAmount ?? 0) -
        rupeesToPaise(inFlight._sum.amount ?? 0);
      if (gatewayRemaining < 0n) gatewayRemaining = 0n;
    }
    return paiseToRupees(gatewayRemaining + (isSplit ? walletRemaining : 0n));
  }

  /**
   * ── D2-A: finish cancellation refunds a crash left behind ─────────────────────────────────────
   *
   * `bookingService.cancel` commits the cancellation together with its refund intent — refundStatus
   * "pending" and refundAmount = the quoted refund, in the same transaction as the status change — and
   * only then starts the refund, detached. That committed row IS the durable intent: a process that
   * dies before the detached refund starts leaves it behind, and this scan finishes it. It covers every
   * tender (wallet-only, split, gateway-only); before, only wallet-only bookings were swept, and a
   * gateway refund lost this way was never attempted at all.
   *
   * Bookings whose cancellation refund already has a refund request are left to the paths that own
   * that request (`retryFailedRefunds` for FAILED, `recoverStaleGatewayRefunds` for REFUNDING /
   * INDETERMINATE). Everything repeated here is idempotent, so racing the detached call is safe.
   * Refusals that cannot change on a retry are marked "failed" so they leave the scan and stay visible.
   */
  async recoverStrandedCancellationRefunds(
    limit = 25,
    now = new Date(),
    graceMs = 60_000,
  ): Promise<{ scanned: number; recovered: number; failed: number }> {
    const cutoff = new Date(now.getTime() - graceMs);
    const rows = await prisma.$queryRaw<
      Array<{ id: string; user_id: string; refund_amount: number; cancellation_reason: string | null; cancelled_by: string | null }>
    >`
      SELECT b.id, b.user_id, b.refund_amount::float AS refund_amount, b.cancellation_reason, b.cancelled_by
      FROM bookings b
      WHERE b.refund_status = 'pending'
        AND b.payment_status::text = 'SUCCESS'
        AND b.status::text IN ('CANCELLED_BY_USER', 'CANCELLED_BY_PROVIDER', 'REJECTED', 'CUSTOMER_NO_SHOW', 'PROVIDER_NO_SHOW')
        AND b.refund_amount > 0
        AND COALESCE(b.cancelled_at, b.updated_at) < ${cutoff}
        AND NOT EXISTS (SELECT 1 FROM refund_requests r WHERE r.idempotency_key = 'cancel-refund:' || b.id)
      ORDER BY b.cancelled_at ASC
      LIMIT ${limit}
    `;

    let recovered = 0;
    let failed = 0;
    for (const row of rows) {
      const result = await this.processCancellationRefund({
        bookingId: row.id,
        userId: row.user_id,
        actorUserId: "system",
        reason: row.cancellation_reason ?? "Cancellation refund recovery",
        cancelledBy: row.cancelled_by === "provider" ? "provider" : "user",
        refundAmount: row.refund_amount,
      });
      if (result.status === "processed" || result.status === "processing") {
        recovered++;
        await prisma.booking.updateMany({
          where: { id: row.id, refundStatus: "pending" },
          data: { refundStatus: result.status, refundAmount: result.amount },
        });
      } else if (
        result.failureReason === "AMOUNT_EXCEEDS_REFUNDABLE" ||
        result.failureReason === "NOT_WALLET_FUNDED" ||
        result.failureReason === "USER_NOT_FOUND" ||
        result.failureReason === "NOTHING_PAID"
      ) {
        failed++;
        await prisma.booking.updateMany({
          where: { id: row.id, refundStatus: "pending" },
          data: { refundStatus: "failed" },
        });
      }
    }
    return { scanned: rows.length, recovered, failed };
  }

  /**
   * ── D2-B: settle gateway refunds whose outcome nobody recorded ────────────────────────────────
   *
   * A process that dies during the gateway call leaves the refund request and the payment in
   * REFUNDING. Nothing moved them on: the orchestrator treats REFUNDING as "in progress" forever, and
   * every retry of the booking returned ₹0. Blindly calling the gateway again is not an option — the
   * first call may have succeeded.
   *
   * Recovery therefore never re-attempts anything itself. A REFUNDING request older than the stale
   * window is moved to INDETERMINATE — the honest description of an attempt whose outcome was lost —
   * and settled by `reconcileIndeterminateRefund`, the existing read-only path that asks the gateway
   * what it holds for this exact operation key:
   *   - the gateway has it   → recorded through the single "a refund became real" path (journal,
   *                            payment, request COMPLETED); the booking is marked processed;
   *   - the gateway lacks it → FAILED and the payment released; a cancellation refund is then retried
   *                            by `retryFailedRefunds` with its backoff, under the SAME operation key,
   *                            which Razorpay de-duplicates (X-Refund-Idempotency).
   * INDETERMINATE requests past the window are reconciled the same way (previously only a webhook could).
   *
   * Each row is claimed with a compare-and-swap on (status, updated_at), so concurrent workers — two
   * instances, a restart mid-scan — settle any one request at most once per window.
   */
  async recoverStaleGatewayRefunds(
    limit = 25,
    now = new Date(),
    staleMs = STALE_REFUND_MS,
  ): Promise<{ scanned: number; confirmed: number; notAtGateway: number; unresolved: number }> {
    const cutoff = new Date(now.getTime() - staleMs);
    const rows = await prisma.refundRequest.findMany({
      where: {
        status: { in: [RefundRequestStatus.REFUNDING, RefundRequestStatus.INDETERMINATE] },
        updatedAt: { lt: cutoff },
      },
      select: { id: true, status: true, updatedAt: true, idempotencyKey: true },
      orderBy: { updatedAt: "asc" },
      take: limit,
    });

    let confirmed = 0;
    let notAtGateway = 0;
    let unresolved = 0;
    for (const row of rows) {
      const claim = await prisma.refundRequest.updateMany({
        where: { id: row.id, status: row.status, updatedAt: row.updatedAt },
        data: { status: RefundRequestStatus.INDETERMINATE },
      });
      if (claim.count !== 1) continue; // another worker has it
      await prisma.refundAudit.create({
        data: {
          refundRequestId: row.id,
          action: "RECOVERY_CLAIMED",
          actorId: "system:refund-recovery",
          details:
            row.status === RefundRequestStatus.REFUNDING
              ? "stale REFUNDING: gateway outcome was never recorded; reconciling with the gateway"
              : "stale INDETERMINATE: reconciling with the gateway",
        },
      });

      try {
        const result = await refundLedgerSyncService.reconcileIndeterminateRefund(row.id);
        if (result.outcome === "CONFIRMED") {
          confirmed++;
          if (row.idempotencyKey.startsWith("cancel-refund:")) {
            await prisma.booking.updateMany({
              where: { id: row.idempotencyKey.slice("cancel-refund:".length), refundStatus: { in: ["pending", "processing"] } },
              data: { refundStatus: "processed" },
            });
          }
        } else if (result.outcome === "NOT_AT_GATEWAY") {
          notAtGateway++;
        } else {
          unresolved++;
        }
      } catch (err) {
        unresolved++;
        recordFinancialMetric("refund_recovery_failed_total", 1);
        void AuditLogService.failure("PAYMENT_REFUND", {
          userId: "system:refund-recovery",
          reason: `refund recovery ${row.id}: ${err instanceof Error ? err.message : String(err)}`.slice(0, 300),
        });
      }
    }
    return { scanned: rows.length, confirmed, notAtGateway, unresolved };
  }

  /**
   * Fired `void` from three committed refund paths. It therefore must not reject: without a catch
   * each failure was an unhandled promise rejection rather than a logged event, so a refund the
   * customer was never told about left no trace anywhere.
   */
  private async notifyCustomerRefund(
    userId: string,
    bookingId: string,
    amount: number,
    channel: "wallet" | "gateway",
  ) {
    const body =
      channel === "wallet"
        ? `₹${amount} has been credited to your HOMEEIGO wallet instantly.`
        : `₹${amount} refund initiated — typically reflects in 5–7 business days on your original payment method.`;

    await notificationService.createForUserDetached({
      userId,
      type: "refund_processed",
      title: "Refund processed",
      message: body,
      referenceId: bookingId,
      referenceType: "booking",
    });
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export const bookingRefundService = new BookingRefundService();
