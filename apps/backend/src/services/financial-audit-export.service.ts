import ExcelJS from "exceljs";
import prisma from "../lib/prisma";

type ExportKind =
  | "ledger"
  | "journals"
  | "refunds"
  | "payouts"
  | "chargebacks"
  | "wallet"
  | "hcoins";

export class FinancialAuditExportService {
  async exportCsv(kind: ExportKind, limit = 5000): Promise<string> {
    const rows = await this.fetchRows(kind, limit);
    if (rows.length === 0) return "empty\n";
    const headers = Object.keys(rows[0]!);
    const lines = [
      headers.join(","),
      ...rows.map((row) =>
        headers
          .map((h) => {
            const v = row[h];
            const s = v == null ? "" : String(v);
            return s.includes(",") || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
          })
          .join(","),
      ),
    ];
    return lines.join("\n");
  }

  async exportXlsx(kind: ExportKind, limit = 5000): Promise<Buffer> {
    const rows = await this.fetchRows(kind, limit);
    const wb = new ExcelJS.Workbook();
    const sheet = wb.addWorksheet(kind);
    if (rows.length === 0) {
      sheet.addRow(["empty"]);
    } else {
      const headers = Object.keys(rows[0]!);
      sheet.addRow(headers);
      for (const row of rows) sheet.addRow(headers.map((h) => row[h]));
    }
    const buf = await wb.xlsx.writeBuffer();
    return Buffer.from(buf);
  }

  private async fetchRows(kind: ExportKind, limit: number): Promise<Record<string, unknown>[]> {
    switch (kind) {
      case "ledger":
        return prisma.ledgerEntry.findMany({
          take: limit,
          orderBy: { createdAt: "desc" },
          include: { account: true, journal: true },
        }).then((rows) =>
          rows.map((r) => ({
            id: r.id,
            journalId: r.journalId,
            entryNumber: r.journal.entryNumber,
            journalType: r.journal.type,
            account: r.account.code,
            debit: r.debit,
            credit: r.credit,
            referenceId: r.journal.referenceId,
            createdAt: r.createdAt.toISOString(),
          })),
        );
      case "journals":
        return prisma.journalEntry.findMany({
          take: limit,
          orderBy: { createdAt: "desc" },
        }).then((rows) =>
          rows.map((j) => ({
            id: j.id,
            entryNumber: j.entryNumber,
            type: j.type,
            referenceId: j.referenceId,
            referenceType: j.referenceType,
            idempotencyKey: j.idempotencyKey,
            createdAt: j.createdAt.toISOString(),
          })),
        );
      case "refunds":
        return prisma.payment.findMany({
          where: { refundedAmount: { gt: 0 } },
          take: limit,
          orderBy: { updatedAt: "desc" },
        }).then((rows) =>
          rows.map((p) => ({
            paymentId: p.id,
            bookingId: p.bookingId,
            amount: p.amount,
            refundedAmount: p.refundedAmount,
            status: p.status,
            razorpayPaymentId: p.razorpayPaymentId,
          })),
        );
      case "payouts":
        return prisma.withdrawal.findMany({
          take: limit,
          orderBy: { createdAt: "desc" },
          include: { provider: { select: { businessName: true } } },
        }).then((rows) =>
          rows.map((w) => ({
            id: w.id,
            provider: w.provider.businessName,
            amount: w.amount,
            netAmount: w.netAmount,
            status: w.status,
            razorpayPayoutId: w.razorpayPayoutId,
            createdAt: w.createdAt.toISOString(),
          })),
        );
      case "chargebacks":
        return prisma.chargeback.findMany({
          take: limit,
          orderBy: { createdAt: "desc" },
        }).then((rows) =>
          rows.map((c) => ({
            id: c.id,
            paymentId: c.paymentId,
            amount: c.amount,
            status: c.status,
            razorpayDisputeId: c.razorpayDisputeId,
            createdAt: c.createdAt.toISOString(),
          })),
        );
      case "wallet":
        return prisma.walletTransaction.findMany({
          take: limit,
          orderBy: { createdAt: "desc" },
        }).then((rows) =>
          rows.map((t) => ({
            id: t.id,
            transactionNumber: t.transactionNumber,
            userId: t.userId,
            type: t.type,
            amount: t.amount,
            status: t.status,
            referenceId: t.referenceId,
            referenceType: t.referenceType,
            createdAt: t.createdAt.toISOString(),
          })),
        );
      case "hcoins":
        return prisma.hCoinTransaction.findMany({
          take: limit,
          orderBy: { createdAt: "desc" },
        }).then((rows) =>
          rows.map((t) => ({
            id: t.id,
            userId: t.userId,
            type: t.type,
            amount: t.amount,
            reason: t.reason,
            referenceId: t.referenceId,
            balanceAfter: t.balanceAfter,
            createdAt: t.createdAt.toISOString(),
          })),
        );
      default:
        return [];
    }
  }
}

export const financialAuditExportService = new FinancialAuditExportService();
