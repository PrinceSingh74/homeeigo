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

  async listQueue(status?: RefundRequestStatus, limit = 50) {
    return prisma.refundRequest.findMany({
      where: status ? { status } : { status: { in: [RefundRequestStatus.REQUESTED, RefundRequestStatus.UNDER_REVIEW, RefundRequestStatus.APPROVED, RefundRequestStatus.PROCESSING] } },
      orderBy: { createdAt: "asc" },
      take: limit,
      include: { audits: { orderBy: { createdAt: "desc" }, take: 3 } },
    });
  }

  async analytics() {
    const [total, completed, rejected, failed, pending] = await Promise.all([
      prisma.refundRequest.count(),
      prisma.refundRequest.count({ where: { status: RefundRequestStatus.COMPLETED } }),
      prisma.refundRequest.count({ where: { status: RefundRequestStatus.REJECTED } }),
      prisma.refundRequest.count({ where: { status: RefundRequestStatus.FAILED } }),
      prisma.refundRequest.count({
        where: { status: { in: [RefundRequestStatus.REQUESTED, RefundRequestStatus.UNDER_REVIEW] } },
      }),
    ]);
    return {
      total,
      completed,
      rejected,
      failed,
      pending,
      approvalRatePct: total > 0 ? round2((completed / total) * 100) : 100,
    };
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export const refundWorkflowService = new RefundWorkflowService();
