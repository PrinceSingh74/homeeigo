import { prisma } from "../lib/prisma";
import { logger } from "../lib/logger";
import {
  enterpriseAuditService,
  securityEventRetention,
} from "./enterprise-audit.service";

/**
 * Part 5 — Logging & Monitoring (Audit Trail).
 *
 * Records security-relevant events to the `ActivityLog` table and the
 * structured logger. Writes are fire-and-forget: a logging failure must never
 * break the request it is describing.
 */

export type SecurityEvent =
  | "REGISTER"
  | "LOGIN"
  | "FAILED_LOGIN"
  | "LOGOUT"
  | "TOKEN_REFRESH"
  | "PASSWORD_CHANGE"
  | "PASSWORD_RESET_REQUEST"
  | "PASSWORD_RESET"
  | "EMAIL_VERIFIED"
  | "OTP_SENT"
  | "OTP_VERIFIED"
  | "UNAUTHORIZED_ACCESS"
  | "FORBIDDEN_ACCESS"
  | "RATE_LIMIT_EXCEEDED"
  | "OAUTH_LOGIN"
  | "PAYMENT_REFUND"
  | "BOOKING_CANCEL_REFUND"
  | "ACCOUNT_DELETION_SCHEDULED"
  | "DATA_EXPORT"
  | "PAYOUT_APPROVED"
  | "PAYOUT_REJECTED"
  | "WITHDRAWAL_APPROVED"
  | "WITHDRAWAL_REJECTED"
  | "WITHDRAWAL_PROCESSING"
  | "WITHDRAWAL_RESERVED"
  | "WITHDRAWAL_RESERVATION_RELEASED"
  | "WITHDRAWAL_RESERVATION_CONSUMED"
  | "CHARGEBACK_EVIDENCE_TOKEN_ISSUED"
  | "CHARGEBACK_EVIDENCE_DOWNLOADED"
  | "CHARGEBACK_RECEIVED"
  | "CHARGEBACK_WEBHOOK"
  | "SETTLEMENT_RECORDED"
  | "WEBHOOK_REFUND_SYNCED"
  | "PAYOUT_RETRY"
  | "PAYOUT_BATCH_PROCESSED"
  | "FINANCIAL_HOLD_LIFTED"
  | "FRAUD_CASE_ESCALATED"
  | "DEVICE_MISMATCH"
  | "WALLET_DEBIT"
  | "WALLET_TRANSFER"
  | "HCOIN_EARNED"
  | "HCOIN_REDEEMED"
  | "HCOIN_ADJUSTED"
  | "HCOIN_EXPIRED"
  | "PAYOUT_FAILURE"
  | "REFERRAL_COMMISSION_CREDITED"
  | "FINANCIAL_ADJUSTMENT_CREATED"
  | "FINANCIAL_ADJUSTMENT_APPROVED"
  | "FINANCIAL_ADJUSTMENT_REJECTED"
  | "FINANCIAL_ADJUSTMENT_EXECUTED"
  | "LEDGER_BACKFILL_RUN"
  | "ADMIN_ACCESS_DENIED"
  | "ADMIN_PERMISSION_GRANTED"
  | "ADMIN_PERMISSION_REVOKED"
  | "ADMIN_ACTION"
  | "ADMIN_ADDRESS_ACCESSED"
  | "TOKEN_REVOKED"
  | "ALL_USER_TOKENS_REVOKED"
  | "REVOKED_TOKEN_USED"
  | "REFRESH_TOKEN_REUSE_ATTACK"
  | "WEBSOCKET_CONNECTED"
  | "WEBSOCKET_UNAUTHORIZED"
  | "GIFT_CARD_BRUTE_FORCE_ATTEMPT"
  | "GIFT_CARD_REDEEMED"
  | "CAMPAIGN_REDEEMED";

export type AuditStatus = "success" | "failure" | "error";

export interface AuditContext {
  userId?: string | null;
  providerId?: string | null;
  bookingId?: string | null;
  email?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  deviceId?: string | null;
  traceId?: string | null;
  reason?: string | null;
  details?: Record<string, unknown>;
}

/** Pull the best-effort client IP from proxy headers. */
export function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return request.headers.get("x-real-ip") || "unknown";
}

export function getUserAgent(request: Request): string {
  return request.headers.get("user-agent") || "unknown";
}

/** Convenience: extract { ipAddress, userAgent } from an incoming Request. */
export function requestMeta(request: Request): { ipAddress: string; userAgent: string } {
  return { ipAddress: getClientIp(request), userAgent: getUserAgent(request) };
}

export class AuditLogService {
  static async record(
    event: SecurityEvent,
    status: AuditStatus,
    ctx: AuditContext = {},
  ): Promise<void> {
    const level = status === "success" ? "info" : "warn";
    logger[level](`security:${event}`, {
      event,
      status,
      userId: ctx.userId ?? undefined,
      ipAddress: ctx.ipAddress ?? undefined,
      reason: ctx.reason ?? undefined,
      traceId: ctx.traceId ?? undefined,
      ...(ctx.details ?? {}),
    });

    try {
      const descriptionPayload = {
        status,
        ...(ctx.reason ? { reason: ctx.reason } : {}),
        ...(ctx.details ?? {}),
      };

      await prisma.activityLog.create({
        data: {
          userId: ctx.userId ?? null,
          providerId: ctx.providerId ?? null,
          bookingId: ctx.bookingId ?? null,
          action: event,
          description: JSON.stringify(descriptionPayload),
          ipAddress: ctx.ipAddress ?? null,
          userAgent: ctx.userAgent ?? null,
        },
      });

      const enterpriseStatus =
        status === "success" ? "SUCCESS" : status === "failure" ? "FAILURE" : "PARTIAL";

      void enterpriseAuditService.log({
        action: event,
        resource: "security_event",
        resourceId: ctx.userId ?? ctx.providerId ?? ctx.bookingId ?? undefined,
        actor: ctx.userId ?? undefined,
        actorType: event.startsWith("ADMIN") ? "ADMIN" : ctx.userId ? "USER" : "SYSTEM",
        changesAfter: descriptionPayload,
        changesSummary: ctx.reason ?? event,
        status: enterpriseStatus,
        ipAddress: ctx.ipAddress ?? undefined,
        userAgent: ctx.userAgent ?? undefined,
        deviceId: ctx.deviceId ?? undefined,
        traceId: ctx.traceId ?? undefined,
        retentionCategory: securityEventRetention(event),
      });
    } catch (error) {
      logger.error("audit-log persistence failed", {
        event,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  static success(event: SecurityEvent, ctx: AuditContext = {}): Promise<void> {
    return this.record(event, "success", ctx);
  }

  static failure(event: SecurityEvent, ctx: AuditContext = {}): Promise<void> {
    return this.record(event, "failure", ctx);
  }

  /** Recent audit entries for a user (most recent first). */
  static getUserAuditLog(userId: string, limit = 50) {
    return prisma.activityLog.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: Math.min(limit, 200),
    });
  }

  static listByAction(action: SecurityEvent, limit = 50) {
    return prisma.activityLog.findMany({
      where: { action },
      orderBy: { createdAt: "desc" },
      take: Math.min(limit, 200),
    });
  }

  /** Suspicious events (failed logins, unauthorized/forbidden) in a window. */
  static getSuspiciousActivity(hoursAgo = 24) {
    const since = new Date(Date.now() - hoursAgo * 60 * 60 * 1000);
    return prisma.activityLog.findMany({
      where: {
        createdAt: { gte: since },
        action: { in: ["FAILED_LOGIN", "UNAUTHORIZED_ACCESS", "FORBIDDEN_ACCESS", "RATE_LIMIT_EXCEEDED"] },
      },
      orderBy: { createdAt: "desc" },
      take: 500,
    });
  }
}
