import path from "path";
import { ChargebackStatus, FinancialRiskLevel } from "@prisma/client";
import prisma from "../lib/prisma";
import { AuditLogService } from "./audit-log.service";
import { financeAlertService } from "./finance-alert.service";
import { objectStorageService } from "./object-storage.service";
import { isLikelyValidPdf } from "../lib/minimal-pdf";

const ALLOWED_EXT = new Set(["pdf", "png", "jpg", "jpeg", "zip"]);
const MAX_EVIDENCE_SIZE = 10 * 1024 * 1024;

const WORKFLOW_TRANSITIONS: Record<ChargebackStatus, ChargebackStatus[]> = {
  RECEIVED: [ChargebackStatus.OPEN, ChargebackStatus.UNDER_REVIEW, ChargebackStatus.EVIDENCE_PENDING, ChargebackStatus.CLOSED],
  OPEN: [ChargebackStatus.UNDER_REVIEW, ChargebackStatus.EVIDENCE_PENDING, ChargebackStatus.CLOSED],
  UNDER_REVIEW: [ChargebackStatus.EVIDENCE_PENDING, ChargebackStatus.RESPONDED, ChargebackStatus.WON, ChargebackStatus.LOST, ChargebackStatus.CLOSED],
  EVIDENCE_PENDING: [ChargebackStatus.UNDER_REVIEW, ChargebackStatus.RESPONDED, ChargebackStatus.CLOSED],
  RESPONDED: [ChargebackStatus.WON, ChargebackStatus.LOST, ChargebackStatus.CLOSED],
  WON: [ChargebackStatus.CLOSED],
  LOST: [ChargebackStatus.CLOSED],
  CLOSED: [],
};

export class ChargebackWorkflowService {
  displayStatus(status: ChargebackStatus): string {
    return status === ChargebackStatus.RECEIVED ? "OPEN" : status;
  }

  async getDetail(chargebackId: string) {
    const cb = await prisma.chargeback.findUnique({
      where: { id: chargebackId },
      include: {
        evidence: { orderBy: { createdAt: "desc" } },
        timeline: { orderBy: { createdAt: "asc" } },
      },
    });
    if (!cb) return null;

    const daysRemaining = cb.responseDeadline
      ? Math.max(0, Math.ceil((cb.responseDeadline.getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
      : null;

    return {
      ...cb,
      displayStatus: this.displayStatus(cb.status),
      daysRemaining,
      evidenceSubmitted: cb.evidence.length > 0,
    };
  }

  async listCases(limit = 50, status?: ChargebackStatus) {
    const rows = await prisma.chargeback.findMany({
      where: status ? { status } : undefined,
      orderBy: { receivedAt: "desc" },
      take: limit,
      include: { _count: { select: { evidence: true, timeline: true } } },
    });
    return rows.map((cb) => ({
      ...cb,
      displayStatus: this.displayStatus(cb.status),
      daysRemaining: cb.responseDeadline
        ? Math.max(0, Math.ceil((cb.responseDeadline.getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
        : null,
    }));
  }

  async assign(chargebackId: string, adminId: string) {
    return this.transition(chargebackId, ChargebackStatus.UNDER_REVIEW, adminId, "ASSIGNED", {
      assignedAdminId: adminId,
    });
  }

  async requestEvidence(chargebackId: string, adminId: string, deadlineDays = 7) {
    const deadline = new Date(Date.now() + deadlineDays * 24 * 60 * 60 * 1000);
    return this.transition(chargebackId, ChargebackStatus.EVIDENCE_PENDING, adminId, "EVIDENCE_REQUESTED", {
      responseDeadline: deadline,
    });
  }

  async submitResponse(chargebackId: string, adminId: string, responseText: string) {
    return this.transition(chargebackId, ChargebackStatus.RESPONDED, adminId, "RESPONSE_SUBMITTED", {
      responseText,
      assignedAdminId: adminId,
    });
  }

  async closeCase(chargebackId: string, adminId: string, outcome?: string) {
    return this.transition(chargebackId, ChargebackStatus.CLOSED, adminId, "CASE_CLOSED", {
      outcome: outcome ?? "closed",
      resolvedAt: new Date(),
    });
  }

  async resolveCase(chargebackId: string, adminId: string, outcome: "WON" | "LOST", notes?: string) {
    const status = outcome === "WON" ? ChargebackStatus.WON : ChargebackStatus.LOST;
    return this.transition(chargebackId, status, adminId, `CASE_${outcome}`, {
      outcome: outcome.toLowerCase(),
      resolvedAt: new Date(),
      responseText: notes ?? undefined,
    });
  }

  private parseMetadata(raw: string | null): Record<string, unknown> {
    if (!raw) return {};
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return {};
    }
  }

  private paymentInclude() {
    return {
      booking: { include: { user: true, provider: { include: { user: true } }, service: true } },
    } as const;
  }

  /** Resolve platform payment + booking for a chargeback using multiple deterministic keys. */
  async resolveLinkedPayment(cb: {
    id: string;
    paymentId: string | null;
    razorpayPaymentId: string | null;
    metadata: string | null;
    amount: number;
    amountPaise: bigint;
  }) {
    const include = this.paymentInclude();

    if (cb.paymentId) {
      return prisma.payment.findUnique({ where: { id: cb.paymentId }, include });
    }

    if (cb.razorpayPaymentId) {
      const byGateway = await prisma.payment.findFirst({
        where: { razorpayPaymentId: cb.razorpayPaymentId },
        include,
      });
      if (byGateway) return byGateway;
    }

    const meta = this.parseMetadata(cb.metadata);
    if (typeof meta.paymentId === "string") {
      const byMetaPayment = await prisma.payment.findUnique({ where: { id: meta.paymentId }, include });
      if (byMetaPayment) return byMetaPayment;
    }
    if (typeof meta.bookingId === "string") {
      const byMetaBooking = await prisma.payment.findUnique({ where: { bookingId: meta.bookingId }, include });
      if (byMetaBooking) return byMetaBooking;
    }

    const amountPaise = Number(cb.amountPaise) > 0 ? Number(cb.amountPaise) : Math.round(cb.amount * 100);
    return prisma.payment.findFirst({
      where: {
        status: "SUCCESS",
        OR: [{ amountPaise: BigInt(amountPaise) }, { amountPaid: cb.amount }],
      },
      include,
      orderBy: { createdAt: "desc" },
    });
  }

  /** Persist paymentId when resolved via gateway/metadata/amount keys. */
  async ensurePaymentLink(chargebackId: string) {
    const cb = await prisma.chargeback.findUnique({ where: { id: chargebackId } });
    if (!cb || cb.paymentId) return cb;

    const payment = await this.resolveLinkedPayment(cb);
    if (!payment) return cb;

    return prisma.chargeback.update({
      where: { id: chargebackId },
      data: {
        paymentId: payment.id,
        razorpayPaymentId: payment.razorpayPaymentId ?? cb.razorpayPaymentId,
      },
    });
  }

  async buildEvidencePackage(chargebackId: string) {
    await this.ensurePaymentLink(chargebackId);

    const cb = await prisma.chargeback.findUnique({
      where: { id: chargebackId },
      include: {
        evidence: true,
        timeline: { orderBy: { createdAt: "asc" } },
      },
    });
    if (!cb) throw new Error("CHARGEBACK_NOT_FOUND");

    const payment = await this.resolveLinkedPayment(cb);

    const invoice = payment?.invoiceNumber
      ? { invoiceNumber: payment.invoiceNumber, amount: payment.amountPaid }
      : null;

    const supportTickets = payment?.bookingId
      ? await prisma.supportTicket.findMany({
          where: { bookingId: payment.bookingId },
          include: { messages: { orderBy: { createdAt: "asc" }, take: 20 } },
        })
      : [];

    const tracking = payment?.bookingId
      ? await prisma.tracking.findFirst({ where: { bookingId: payment.bookingId } })
      : null;

    const providerLogs = payment?.bookingId
      ? await prisma.activityLog.findMany({
          where: { bookingId: payment.bookingId, providerId: { not: null } },
          orderBy: { createdAt: "asc" },
          take: 30,
        })
      : [];

    return {
      chargeback: {
        id: cb.id,
        status: cb.status,
        amount: cb.amount,
        reason: cb.reason,
        razorpayDisputeId: cb.razorpayDisputeId,
        responseDeadline: cb.responseDeadline,
      },
      booking: payment?.booking
        ? {
            id: payment.booking.id,
            bookingNumber: payment.booking.bookingNumber,
            status: payment.booking.status,
            scheduledDate: payment.booking.scheduledDate,
            finalAmount: payment.booking.finalAmount,
            customer: `${payment.booking.user.firstName} ${payment.booking.user.lastName}`,
            provider: payment.booking.provider
              ? `${payment.booking.provider.user.firstName} ${payment.booking.provider.user.lastName}`
              : null,
            service: payment.booking.service.name,
          }
        : null,
      payment: payment
        ? {
            id: payment.id,
            amountPaid: payment.amountPaid,
            razorpayPaymentId: payment.razorpayPaymentId,
            status: payment.status,
          }
        : null,
      invoice: invoice,
      evidence: cb.evidence.map((e) => ({
        id: e.id,
        fileName: e.fileName,
        mimeType: e.mimeType,
        uploadedAt: e.createdAt,
      })),
      communications: supportTickets.flatMap((t) =>
        t.messages.map((m) => ({
          ticketNumber: t.ticketNumber,
          authorRole: m.authorRole,
          body: m.body,
          at: m.createdAt,
        })),
      ),
      tracking: tracking ? { status: tracking.status, lastUpdated: tracking.updatedAt } : null,
      providerLogs: providerLogs.map((l) => ({ action: l.action, at: l.createdAt, description: l.description })),
      timeline: cb.timeline,
      linkage: {
        paymentLinked: Boolean(payment),
        bookingLinked: Boolean(payment?.booking),
        linkSource: payment
          ? cb.paymentId
            ? "payment_id"
            : cb.razorpayPaymentId
              ? "razorpay_payment_id"
              : "resolved"
          : "unlinked",
      },
    };
  }

  async checkSlaBreaches() {
    const breached = await prisma.chargeback.findMany({
      where: {
        responseDeadline: { lt: new Date() },
        status: {
          in: [
            ChargebackStatus.RECEIVED,
            ChargebackStatus.OPEN,
            ChargebackStatus.UNDER_REVIEW,
            ChargebackStatus.EVIDENCE_PENDING,
            ChargebackStatus.RESPONDED,
          ],
        },
      },
      take: 100,
    });

    for (const cb of breached) {
      await financeAlertService.raise("CHARGEBACK_SLA_BREACH", "HIGH", `Chargeback ${cb.id} SLA breached`, {
        chargebackId: cb.id,
        deadline: cb.responseDeadline?.toISOString(),
        amount: cb.amount,
      });
    }

    return { breachedCount: breached.length, chargebackIds: breached.map((c) => c.id) };
  }

  async uploadEvidence(
    chargebackId: string,
    adminId: string,
    file: Buffer,
    fileName: string,
    description?: string,
  ) {
    const cb = await prisma.chargeback.findUnique({ where: { id: chargebackId } });
    if (!cb) throw new Error("CHARGEBACK_NOT_FOUND");
    if (file.length > MAX_EVIDENCE_SIZE) throw new Error("FILE_TOO_LARGE");

    const ext = (path.extname(fileName).replace(".", "") || "").toLowerCase();
    if (!ALLOWED_EXT.has(ext)) throw new Error("INVALID_FILE_TYPE");
    if (ext === "pdf" && !isLikelyValidPdf(file)) throw new Error("INVALID_PDF");

    const mimeType =
      ext === "pdf"
        ? "application/pdf"
        : ext === "png"
          ? "image/png"
          : ext === "jpg" || ext === "jpeg"
            ? "image/jpeg"
            : ext === "zip"
              ? "application/zip"
              : "application/octet-stream";

    const stored = await objectStorageService.putObject("chargeback-evidence", file, {
      fileName,
      mimeType,
    });

    const evidence = await prisma.chargebackEvidence.create({
      data: {
        chargebackId,
        storageKey: stored.storageKey,
        fileName,
        mimeType,
        fileUrl: stored.fileUrl,
        description,
        uploadedBy: adminId,
      },
    });

    await prisma.chargebackTimeline.create({
      data: {
        chargebackId,
        action: "EVIDENCE_UPLOADED",
        details: fileName,
        actorId: adminId,
      },
    });

    if (cb.status === ChargebackStatus.RECEIVED || cb.status === ChargebackStatus.OPEN) {
      await prisma.chargeback.update({
        where: { id: chargebackId },
        data: { status: ChargebackStatus.UNDER_REVIEW },
      });
    }

    return evidence;
  }

  async exportCase(chargebackId: string): Promise<string> {
    const detail = await this.getDetail(chargebackId);
    if (!detail) throw new Error("CHARGEBACK_NOT_FOUND");
    const lines = [
      "HOMEEIGO Chargeback Case Export",
      `ID: ${detail.id}`,
      `Dispute: ${detail.razorpayDisputeId ?? "—"}`,
      `Status: ${detail.displayStatus}`,
      `Amount: ${detail.amount}`,
      `Reason: ${detail.reason ?? "—"}`,
      `Deadline: ${detail.responseDeadline?.toISOString() ?? "—"}`,
      `Days remaining: ${detail.daysRemaining ?? "—"}`,
      "",
      "Timeline:",
      ...detail.timeline.map((t) => `- ${t.createdAt.toISOString()} ${t.action}: ${t.details ?? ""}`),
      "",
      "Evidence:",
      ...detail.evidence.map((e) => `- ${e.fileUrl} (${e.description ?? ""})`),
    ];
    return lines.join("\n");
  }

  async analytics() {
    const [total, open, won, lost, openExposure, recovery] = await Promise.all([
      prisma.chargeback.count(),
      prisma.chargeback.count({
        where: { status: { in: [ChargebackStatus.RECEIVED, ChargebackStatus.OPEN, ChargebackStatus.UNDER_REVIEW, ChargebackStatus.EVIDENCE_PENDING, ChargebackStatus.RESPONDED] } },
      }),
      prisma.chargeback.count({ where: { status: ChargebackStatus.WON } }),
      prisma.chargeback.count({ where: { status: ChargebackStatus.LOST } }),
      prisma.chargeback.aggregate({
        where: { status: { in: [ChargebackStatus.RECEIVED, ChargebackStatus.OPEN, ChargebackStatus.UNDER_REVIEW, ChargebackStatus.EVIDENCE_PENDING, ChargebackStatus.RESPONDED] } },
        _sum: { amount: true },
      }),
      prisma.chargeback.aggregate({
        where: { status: ChargebackStatus.WON },
        _sum: { amount: true },
      }),
    ]);

    const paymentCount = await prisma.payment.count({ where: { status: "SUCCESS" } });
    const resolved = won + lost;

    return {
      total,
      open,
      won,
      lost,
      winRate: resolved > 0 ? round2((won / resolved) * 100) : 0,
      lossRate: resolved > 0 ? round2((lost / resolved) * 100) : 0,
      openExposure: openExposure._sum.amount ?? 0,
      recoveryAmount: recovery._sum.amount ?? 0,
      chargebackRatio: paymentCount > 0 ? round2((total / paymentCount) * 100) : 0,
    };
  }

  private async transition(
    chargebackId: string,
    toStatus: ChargebackStatus,
    adminId: string,
    action: string,
    data: Record<string, unknown>,
  ) {
    const cb = await prisma.chargeback.findUnique({ where: { id: chargebackId } });
    if (!cb) throw new Error("CHARGEBACK_NOT_FOUND");

    const allowed = WORKFLOW_TRANSITIONS[cb.status] ?? [];
    if (!allowed.includes(toStatus) && cb.status !== toStatus) {
      throw new Error(`INVALID_TRANSITION:${cb.status}->${toStatus}`);
    }

    const updated = await prisma.chargeback.update({
      where: { id: chargebackId },
      data: { status: toStatus, ...data },
    });

    await prisma.chargebackTimeline.create({
      data: { chargebackId, action, details: `Status → ${toStatus}`, actorId: adminId },
    });

    void AuditLogService.success("CHARGEBACK_WEBHOOK", {
      userId: adminId,
      details: { chargebackId, from: cb.status, to: toStatus, action },
    });

    return updated;
  }

  async ensureDeadlineFromWebhook(chargebackId: string, days = 14) {
    const cb = await prisma.chargeback.findUnique({ where: { id: chargebackId } });
    if (!cb || cb.responseDeadline) return;
    await prisma.chargeback.update({
      where: { id: chargebackId },
      data: {
        responseDeadline: new Date(Date.now() + days * 24 * 60 * 60 * 1000),
        riskLevel: cb.amount >= 5000 ? FinancialRiskLevel.HIGH : FinancialRiskLevel.MEDIUM,
      },
    });
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export const chargebackWorkflowService = new ChargebackWorkflowService();
