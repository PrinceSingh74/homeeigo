import { analyticsWhere } from "../lib/analytics-scope";
import { RefundRequestStatus } from "@prisma/client";
import prisma from "../lib/prisma";
import { refundOrchestratorService } from "./refund-orchestrator.service";
import { AuditLogService } from "./audit-log.service";
import { financialRiskService } from "./financial-risk.service";

const REASON_CODES = ["CUSTOMER_REQUEST", "SERVICE_ISSUE", "DUPLICATE_CHARGE", "FRAUD", "OTHER"] as const;

export class RefundWorkflowService {
  reasonCodes = REASON_CODES;

  async createRequest(opts: {
    paymentId: string;
    amount: number;
    reason: string;
    reasonCode?: string;
    requestedBy: string;
  }) {
    const payment = await prisma.payment.findUnique({ where: { id: opts.paymentId } });
    if (!payment) throw new Error("Payment not found");

    const idempotencyKey = `workflow-request:${opts.paymentId}:${opts.amount}:${opts.requestedBy}`;
    const req = await prisma.refundRequest.create({
      data: {
        paymentId: opts.paymentId,
        userId: payment.userId,
        amount: opts.amount,
        reason: opts.reason,
        reasonCode: opts.reasonCode,
        status: RefundRequestStatus.REQUESTED,
        requestedBy: opts.requestedBy,
        idempotencyKey,
        audits: {
          create: { action: "REQUESTED", actorId: opts.requestedBy, details: opts.reason },
        },
      },
    });

    await prisma.refundRequest.update({
      where: { id: req.id },
      data: { status: RefundRequestStatus.UNDER_REVIEW },
    });

    return req;
  }

  async approve(requestId: string, adminId: string, notes?: string) {
    const req = await prisma.refundRequest.findUnique({ where: { id: requestId } });
    if (!req) throw new Error("Refund request not found");
    if (req.status !== RefundRequestStatus.UNDER_REVIEW && req.status !== RefundRequestStatus.REQUESTED) {
      throw new Error(`Cannot approve in status ${req.status}`);
    }

    await prisma.refundRequest.update({
      where: { id: requestId },
      data: {
        status: RefundRequestStatus.APPROVED,
        reviewedBy: adminId,
        reviewNotes: notes,
        audits: { create: { action: "APPROVED", actorId: adminId, details: notes } },
      },
    });

    const workflowKey = `workflow-approve:${requestId}`;
    const result = await refundOrchestratorService.executeRefund({
      paymentId: req.paymentId,
      amount: req.amount,
      reason: req.reason,
      actorUserId: adminId,
      isAdmin: true,
      source: "workflow",
      idempotencyKey: workflowKey,
    });

    if ("error" in result) {
      if (!result.blocked) {
        await prisma.refundRequest.update({
          where: { id: requestId },
          data: {
            status: RefundRequestStatus.FAILED,
            audits: { create: { action: "FAILED", actorId: adminId, details: result.error } },
          },
        });
      }
      throw new Error(result.error);
    }

    await prisma.refundRequest.update({
      where: { id: requestId },
      data: {
        status: RefundRequestStatus.COMPLETED,
        gatewayRefundId: result.refundId,
        razorpayRefundId: result.refundId,
        processedAt: new Date(),
        audits: { create: { action: "COMPLETED", actorId: adminId, details: result.refundId } },
      },
    });

    void AuditLogService.success("PAYMENT_REFUND", {
      userId: adminId,
      details: { requestId, refundId: result.refundId, amount: req.amount, workflow: true },
    });

    void financialRiskService.detectRefundAbuse(req.userId, req.paymentId).catch(() => undefined);

    return { requestId, refundId: result.refundId, status: RefundRequestStatus.COMPLETED };
  }

  async reject(requestId: string, adminId: string, notes: string) {
    return prisma.refundRequest.update({
      where: { id: requestId },
      data: {
        status: RefundRequestStatus.REJECTED,
        reviewedBy: adminId,
        reviewNotes: notes,
        audits: { create: { action: "REJECTED", actorId: adminId, details: notes } },
      },
    });
  }

  /**
   * Everything an operator must act on. FAILED (gateway refused / no gateway payment id yet) and
   * INDETERMINATE (gateway outcome unknown) are money the customer is owed and nobody has
   * confirmed; leaving them out of the default queue made a stuck refund invisible until the
   * customer complained.
   */
  static readonly ACTIONABLE_STATUSES: RefundRequestStatus[] = [
    RefundRequestStatus.REQUESTED,
    RefundRequestStatus.UNDER_REVIEW,
    RefundRequestStatus.APPROVED,
    RefundRequestStatus.PROCESSING,
    RefundRequestStatus.FAILED,
    RefundRequestStatus.INDETERMINATE,
  ];

  /**
   * Money with an UNKNOWN outcome outranks money with a known-failed one.
   *
   * INDETERMINATE means the gateway was called and never gave a definite answer, so the customer
   * may or may not have been paid; PROCESSING is in flight. Both need a human before anything else
   * on this queue does. FAILED is unambiguous and safely retryable, which makes it lower priority
   * even when it is older.
   */
  private static readonly URGENT_STATUSES: RefundRequestStatus[] = [
    RefundRequestStatus.INDETERMINATE,
    RefundRequestStatus.PROCESSING,
  ];

  /**
   * Oldest-first across all actionable statuses used to be the whole ordering, and it hid exactly
   * the rows that mattered: on 2026-09-21 there were 303 actionable refunds, the 100-row page was
   * filled entirely by FAILED rows from June and July, and **none of the 53 INDETERMINATE refunds
   * reached an operator**. The page was not wrong about what it showed; it just never got far
   * enough down the list to show money nobody could account for.
   *
   * Urgent statuses are therefore drawn first, each bucket still oldest-first.
   */
  async listQueue(status?: RefundRequestStatus, limit = 50) {
    /**
     * `RefundRequest` has no `payment` relation — only a `paymentId` scalar — so this used to
     * `include: { payment }` and every call threw a Prisma validation error: the admin refund queue
     * answered 500. `tsc` never saw it because the `include` object was built as a variable, and
     * TypeScript only checks excess properties on fresh object literals. It stayed invisible while
     * the dev backend ran a stale build, and the tests that covered this method only read its
     * source. Found in Pass 5/6 by logging in as the demo admin and calling the endpoint.
     *
     * The payment is resolved in one batched query and attached under the same `payment` key the
     * console reads (`row.payment.bookingId` — the retry endpoint is addressed by booking).
     */
    const include = { audits: { orderBy: { createdAt: "desc" as const }, take: 3 } };

    if (status) {
      return this.withPayments(
        await prisma.refundRequest.findMany({ where: { status }, orderBy: { createdAt: "asc" }, take: limit, include }),
      );
    }

    const urgent = await prisma.refundRequest.findMany({
      where: { status: { in: RefundWorkflowService.URGENT_STATUSES } },
      orderBy: { createdAt: "asc" },
      take: limit,
      include,
    });
    if (urgent.length >= limit) return this.withPayments(urgent);

    const rest = await prisma.refundRequest.findMany({
      where: {
        status: {
          in: RefundWorkflowService.ACTIONABLE_STATUSES.filter(
            (s) => !RefundWorkflowService.URGENT_STATUSES.includes(s),
          ),
        },
      },
      orderBy: { createdAt: "asc" },
      take: limit - urgent.length,
      include,
    });
    return this.withPayments([...urgent, ...rest]);
  }

  /** One query for every row's payment, attached as `payment: { bookingId, paymentMethod } | null`. */
  private async withPayments<T extends { paymentId: string }>(rows: T[]) {
    const ids = [...new Set(rows.map((r) => r.paymentId))];
    const payments = ids.length
      ? await prisma.payment.findMany({
          where: { id: { in: ids } },
          select: { id: true, bookingId: true, paymentMethod: true },
        })
      : [];
    const byId = new Map(payments.map((p) => [p.id, { bookingId: p.bookingId, paymentMethod: p.paymentMethod }]));
    return rows.map((r) => ({ ...r, payment: byId.get(r.paymentId) ?? null }));
  }

  /**
   * Scoped to the business population.
   *
   * Every figure this returns was previously computed over the whole table, of which 97.1% is
   * certification and test data (measured 2026-09-21: 329 of 339 rows, including all 250 FAILED and
   * all 53 INDETERMINATE). The console's approval rate, failure rate and "needs retry" tile were
   * arithmetically correct descriptions of certification activity.
   *
   * `scope` names the population in the response so a reader can tell which question was answered,
   * and `excluded` makes the size of the difference visible rather than quietly disappearing it.
   */
  async analytics() {
    const scoped = analyticsWhere();
    const [total, completed, rejected, failed, pending, indeterminate, excluded] = await Promise.all([
      prisma.refundRequest.count({ where: scoped }),
      prisma.refundRequest.count({ where: { status: RefundRequestStatus.COMPLETED, ...scoped } }),
      prisma.refundRequest.count({ where: { status: RefundRequestStatus.REJECTED, ...scoped } }),
      prisma.refundRequest.count({ where: { status: RefundRequestStatus.FAILED, ...scoped } }),
      prisma.refundRequest.count({
        where: { status: { in: [RefundRequestStatus.REQUESTED, RefundRequestStatus.UNDER_REVIEW] }, ...scoped },
      }),
      /**
       * Counted here because the console used to derive "needs retry" from the returned page.
       * With 303 actionable rows behind a 100-row page that tile read 100 while the real figure
       * was 303, and every one of the 53 INDETERMINATE rows — money with no confirmed outcome —
       * was missing from both the list and the count.
       */
      prisma.refundRequest.count({ where: { status: RefundRequestStatus.INDETERMINATE, ...scoped } }),
      prisma.refundRequest.count({ where: analyticsWhere("NON_BUSINESS") }),
    ]);
    return {
      scope: "BUSINESS" as const,
      excluded,
      total,
      completed,
      rejected,
      failed,
      pending,
      indeterminate,
      /** Authoritative count for the console's "needs retry" tile — never derive it from a page. */
      needsRetry: failed + indeterminate,
      // Zero refund requests means the approval rate is undefined, not perfect. Returning 100
      // would report "every refund approved" for a platform that has approved none.
      approvalRatePct: total > 0 ? round2((completed / total) * 100) : null,
    };
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export const refundWorkflowService = new RefundWorkflowService();
