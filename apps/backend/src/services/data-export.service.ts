import prisma from "../lib/prisma";
import { buildStoredZip } from "../lib/simple-zip";
import { AuditLogService } from "./audit-log.service";

export class DataExportService {
  async buildExport(userId: string) {
    const [user, addresses, bookings, walletTxns, payments, ratings, notifications] =
      await Promise.all([
        prisma.user.findUnique({
          where: { id: userId },
          select: {
            id: true,
            email: true,
            phoneNumber: true,
            firstName: true,
            lastName: true,
            role: true,
            walletBalance: true,
            referralCode: true,
            referralCount: true,
            isEmailVerified: true,
            isPhoneVerified: true,
            createdAt: true,
          },
        }),
        prisma.address.findMany({ where: { userId } }),
        prisma.booking.findMany({ where: { userId }, take: 500, orderBy: { createdAt: "desc" } }),
        prisma.walletTransaction.findMany({ where: { userId }, take: 500, orderBy: { createdAt: "desc" } }),
        prisma.payment.findMany({ where: { userId }, take: 500, orderBy: { createdAt: "desc" } }),
        prisma.rating.findMany({ where: { userId }, take: 200, orderBy: { createdAt: "desc" } }),
        prisma.notification.findMany({ where: { userId }, take: 200, orderBy: { createdAt: "desc" } }),
      ]);

    if (!user) return null;

    return {
      exportedAt: new Date().toISOString(),
      profile: user,
      addresses,
      bookings,
      walletTransactions: walletTxns,
      payments,
      ratings,
      notifications,
    };
  }

  async exportJson(userId: string) {
    const data = await this.buildExport(userId);
    if (!data) return null;
    void AuditLogService.success("DATA_EXPORT", { userId, details: { format: "json" } });
    return data;
  }

  async exportZip(userId: string): Promise<Uint8Array | null> {
    const data = await this.buildExport(userId);
    if (!data) return null;
    void AuditLogService.success("DATA_EXPORT", { userId, details: { format: "zip" } });
    const files: Record<string, string> = {
      "profile.json": JSON.stringify(data.profile, null, 2),
      "addresses.json": JSON.stringify(data.addresses, null, 2),
      "bookings.json": JSON.stringify(data.bookings, null, 2),
      "wallet-transactions.json": JSON.stringify(data.walletTransactions, null, 2),
      "payments.json": JSON.stringify(data.payments, null, 2),
      "ratings.json": JSON.stringify(data.ratings, null, 2),
      "notifications.json": JSON.stringify(data.notifications, null, 2),
      "manifest.json": JSON.stringify({ exportedAt: data.exportedAt, userId }, null, 2),
    };
    return buildStoredZip(files);
  }
}

export const dataExportService = new DataExportService();
