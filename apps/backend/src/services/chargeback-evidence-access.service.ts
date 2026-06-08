import crypto from "crypto";
import fs from "fs";
import path from "path";
import prisma from "../lib/prisma";
import { AuditLogService } from "./audit-log.service";
import { recordFinancialMetric } from "../lib/financial-metrics";

const EVIDENCE_DIR =
  process.env.CHARGEBACK_EVIDENCE_DIR ||
  path.join(process.cwd(), "uploads", "chargeback-evidence");

const TOKEN_TTL_MS = 5 * 60 * 1000;

export class ChargebackEvidenceAccessService {
  evidenceDir(): string {
    if (!fs.existsSync(EVIDENCE_DIR)) fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
    return EVIDENCE_DIR;
  }

  resolveFilePath(storageKey: string): string {
    const safe = path.basename(storageKey);
    const filePath = path.join(this.evidenceDir(), safe);
    if (!filePath.startsWith(this.evidenceDir())) throw new Error("INVALID_PATH");
    return filePath;
  }

  async createDownloadToken(evidenceId: string, adminId: string): Promise<{
    token: string;
    expiresAt: Date;
    downloadPath: string;
  }> {
    const evidence = await prisma.chargebackEvidence.findUnique({ where: { id: evidenceId } });
    if (!evidence) throw new Error("NOT_FOUND:Evidence not found");

    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);

    await prisma.chargebackEvidenceDownloadToken.create({
      data: { evidenceId, token, adminId, expiresAt },
    });

    void AuditLogService.success("CHARGEBACK_EVIDENCE_TOKEN_ISSUED", {
      userId: adminId,
      details: { evidenceId, chargebackId: evidence.chargebackId, expiresAt },
    });
    recordFinancialMetric("evidence_download_total", 1);

    return {
      token,
      expiresAt,
      downloadPath: `/api/admin/finance/chargebacks/evidence/download/${token}`,
    };
  }

  async consumeDownloadToken(token: string, adminId: string): Promise<{
    filePath: string;
    fileName: string;
    mimeType: string;
    evidenceId: string;
  }> {
    const row = await prisma.chargebackEvidenceDownloadToken.findUnique({
      where: { token },
      include: { evidence: true },
    });

    if (!row) {
      recordFinancialMetric("evidence_denied_total", 1);
      throw new Error("FORBIDDEN:Invalid download token");
    }
    if (row.adminId !== adminId) {
      recordFinancialMetric("evidence_denied_total", 1);
      throw new Error("FORBIDDEN:Token not issued to this admin");
    }
    if (row.usedAt) {
      recordFinancialMetric("evidence_denied_total", 1);
      throw new Error("FORBIDDEN:Download token already used");
    }
    if (row.expiresAt < new Date()) {
      recordFinancialMetric("evidence_denied_total", 1);
      throw new Error("FORBIDDEN:Download token expired");
    }

    const filePath = this.resolveFilePath(row.evidence.storageKey);
    if (!fs.existsSync(filePath)) {
      recordFinancialMetric("evidence_denied_total", 1);
      throw new Error("NOT_FOUND:Evidence file missing");
    }

    await prisma.chargebackEvidenceDownloadToken.update({
      where: { id: row.id },
      data: { usedAt: new Date() },
    });

    void AuditLogService.success("CHARGEBACK_EVIDENCE_DOWNLOADED", {
      userId: adminId,
      details: { evidenceId: row.evidenceId, chargebackId: row.evidence.chargebackId },
    });
    recordFinancialMetric("evidence_download_total", 1);

    return {
      filePath,
      fileName: row.evidence.fileName,
      mimeType: row.evidence.mimeType,
      evidenceId: row.evidenceId,
    };
  }
}

export const chargebackEvidenceAccessService = new ChargebackEvidenceAccessService();
