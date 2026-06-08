import fs from "fs";
import path from "path";
import { ChargebackStatus, FinancialRiskLevel } from "@prisma/client";
import prisma from "../lib/prisma";
import { AuditLogService } from "./audit-log.service";
import { generateStorageKey } from "../lib/storage-key";
import { chargebackEvidenceAccessService } from "./chargeback-evidence-access.service";

const EVIDENCE_DIR =
  process.env.CHARGEBACK_EVIDENCE_DIR ||
  path.join(process.cwd(), "uploads", "chargeback-evidence");

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

    const storageKey = generateStorageKey();
    const storagePath = chargebackEvidenceAccessService.resolveFilePath(storageKey);
    if (!fs.existsSync(path.dirname(storagePath))) {
      fs.mkdirSync(path.dirname(storagePath), { recursive: true });
    }
    fs.writeFileSync(storagePath, file);

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

    const evidence = await prisma.chargebackEvidence.create({
      data: {
        chargebackId,
        storageKey,
        fileName,
        mimeType,
        fileUrl: null,
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
      "HOMIGO Chargeback Case Export",
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
