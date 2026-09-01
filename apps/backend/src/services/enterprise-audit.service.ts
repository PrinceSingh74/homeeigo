import crypto from "crypto";
import type {
  EnterpriseActorType,
  EnterpriseAuditStatus,
  Prisma,
  RetentionCategory,
} from "@prisma/client";
import { logger } from "../lib/logger";

async function getPrisma() {
  const { default: prisma } = await import("../lib/prisma-base");
  return prisma;
}
import { integrityHash } from "../lib/pii-crypto";

const RETENTION_DAYS: Record<RetentionCategory, number> = {
  SECURITY_EVENTS: 7 * 365,
  PAYMENT_EVENTS: 8 * 365,
  FINANCIAL_LEDGER: 10 * 365,
  LOGIN_EVENTS: 2 * 365,
  SYSTEM_LOGS: 365,
};

export type EnterpriseAuditInput = {
  action: string;
  resource: string;
  resourceId?: string;
  actor?: string;
  actorType?: EnterpriseActorType;
  changesBefore?: Record<string, unknown> | null;
  changesAfter?: Record<string, unknown> | null;
  changesSummary?: string;
  status?: EnterpriseAuditStatus;
  ipAddress?: string;
  userAgent?: string;
  deviceId?: string;
  traceId?: string;
  errorMessage?: string;
  retentionCategory: RetentionCategory;
};

function sanitizeAuditValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    if (value.includes("@")) return "[REDACTED_EMAIL]";
    if (/^\+?\d{10,}$/.test(value.replace(/\D/g, ""))) return "[REDACTED_PHONE]";
  }
  if (Array.isArray(value)) return value.map(sanitizeAuditValue);
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (["email", "phoneNumber", "phone", "password", "emailEncrypted", "phoneEncrypted"].includes(k)) {
        out[k] = "[REDACTED]";
      } else {
        out[k] = sanitizeAuditValue(v);
      }
    }
    return out;
  }
  return value;
}

function buildSummary(before: unknown, after: unknown): string {
  if (!before && after) return "Created new record";
  if (before && !after) return "Deleted record";
  if (before && after && typeof before === "object" && typeof after === "object") {
    const changes: string[] = [];
    for (const [key, value] of Object.entries(after as Record<string, unknown>)) {
      const prev = (before as Record<string, unknown>)[key];
      if (prev !== value) {
        changes.push(`${key} changed`);
      }
    }
    return changes.length > 0 ? changes.join("; ") : "No field changes";
  }
  return "";
}

function retentionExpiry(category: RetentionCategory): Date {
  const days = RETENTION_DAYS[category] ?? RETENTION_DAYS.SYSTEM_LOGS;
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

function sanitizeAuditError(message: string | null): string | null {
  if (!message) return null;
  const lower = message.toLowerCase();
  if (
    lower.includes("password") ||
    lower.includes("otp") ||
    lower.includes("token") ||
    lower.includes("secret") ||
    lower.includes("prisma") ||
    lower.includes("sql") ||
    lower.includes("e:\\") ||
    lower.includes("c:\\") ||
    lower.includes("/usr/") ||
    lower.includes("node_modules")
  ) {
    return "error_redacted";
  }
  return message.slice(0, 240);
}

export class EnterpriseAuditService {
  async log(entry: EnterpriseAuditInput): Promise<string | null> {
    const traceId = entry.traceId ?? crypto.randomUUID();
    const status = entry.status ?? "SUCCESS";
    const actorType = entry.actorType ?? (entry.actor ? "USER" : "SYSTEM");

    const changesBefore = entry.changesBefore
      ? (sanitizeAuditValue(entry.changesBefore) as Record<string, unknown>)
      : undefined;
    const changesAfter = entry.changesAfter
      ? (sanitizeAuditValue(entry.changesAfter) as Record<string, unknown>)
      : undefined;
    const changesSummary =
      entry.changesSummary ?? buildSummary(changesBefore, changesAfter);

    const hash = integrityHash([
      entry.action,
      entry.actor ?? "",
      entry.resource,
      traceId,
      status,
    ]);

    try {
      const prisma = await getPrisma();
      const row = await prisma.enterpriseAuditLog.create({
        data: {
          action: entry.action,
          resource: entry.resource,
          resourceId: entry.resourceId,
          actor: entry.actor,
          actorType,
          changesBefore: (changesBefore ?? undefined) as Prisma.InputJsonValue | undefined,
          changesAfter: (changesAfter ?? undefined) as Prisma.InputJsonValue | undefined,
          changesSummary,
          status,
          ipAddress: entry.ipAddress,
          userAgent: entry.userAgent,
          deviceId: entry.deviceId,
          errorMessage: entry.errorMessage,
          retentionCategory: entry.retentionCategory,
          retentionExpiresAt: retentionExpiry(entry.retentionCategory),
          traceId,
          hash,
        },
      });
      return row.id;
    } catch (err) {
      logger.error("enterprise_audit_persist_failed", {
        action: entry.action,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }

  recordSystemEvent(
    entry: Omit<EnterpriseAuditInput, "actorType"> & { actorType?: EnterpriseActorType },
  ): Promise<string | null> {
    return this.log({ ...entry, actorType: entry.actorType ?? "SYSTEM" });
  }

  async verifyIntegrity(logId: string): Promise<boolean> {
    const prisma = await getPrisma();
    const log = await prisma.enterpriseAuditLog.findUnique({ where: { id: logId } });
    if (!log?.hash) return false;
    const expected = integrityHash([log.action, log.actor ?? "", log.resource, log.traceId, log.status]);
    return log.hash === expected;
  }

  async getAuditLogs(filters: {
    action?: string;
    actor?: string;
    resource?: string;
    resourceId?: string;
    traceId?: string;
    status?: EnterpriseAuditStatus;
    startDate?: Date;
    endDate?: Date;
    cursor?: string;
    limit?: number;
  }) {
    const prisma = await getPrisma();
    const take = Math.min(Math.max(filters.limit ?? 50, 1), 200);
    const createdAt: Prisma.DateTimeFilter = {};
    if (filters.startDate) createdAt.gte = filters.startDate;
    if (filters.endDate) createdAt.lte = filters.endDate;
    if (filters.cursor) {
      const cursorDate = new Date(filters.cursor);
      if (!Number.isNaN(cursorDate.getTime())) createdAt.lt = cursorDate;
    }

    const rows = await prisma.enterpriseAuditLog.findMany({
      where: {
        action: filters.action
          ? { contains: filters.action, mode: "insensitive" }
          : undefined,
        actor: filters.actor
          ? { contains: filters.actor, mode: "insensitive" }
          : undefined,
        resource: filters.resource
          ? { contains: filters.resource, mode: "insensitive" }
          : undefined,
        resourceId: filters.resourceId || undefined,
        traceId: filters.traceId || undefined,
        status: filters.status,
        createdAt: Object.keys(createdAt).length ? createdAt : undefined,
        isArchived: false,
      },
      take: take + 1,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        action: true,
        resource: true,
        resourceId: true,
        actor: true,
        actorType: true,
        changesSummary: true,
        status: true,
        traceId: true,
        deviceId: true,
        createdAt: true,
        errorMessage: true,
      },
    });

    const hasMore = rows.length > take;
    const page = hasMore ? rows.slice(0, take) : rows;
    return {
      items: page.map((row) => ({
        id: row.id,
        action: row.action,
        resource: row.resource,
        resourceId: row.resourceId,
        actor: row.actor,
        actorType: row.actorType,
        changesSummary: row.changesSummary,
        status: row.status,
        traceId: row.traceId,
        deviceId: row.deviceId,
        createdAt: row.createdAt.toISOString(),
        errorMessage: sanitizeAuditError(row.errorMessage),
      })),
      nextCursor: hasMore ? page[page.length - 1]?.createdAt.toISOString() ?? null : null,
      hasMore,
    };
  }
}

export const enterpriseAuditService = new EnterpriseAuditService();

export function securityEventRetention(action: string): RetentionCategory {
  if (action.includes("LOGIN") || action === "LOGOUT" || action === "TOKEN_REFRESH") {
    return "LOGIN_EVENTS";
  }
  if (
    action.includes("PAYMENT") ||
    action.includes("PAYOUT") ||
    action.includes("REFUND") ||
    action.includes("CHARGEBACK") ||
    action.includes("SETTLEMENT")
  ) {
    return "PAYMENT_EVENTS";
  }
  // Matched case-INSENSITIVELY and against the credit side as well as the debit side.
  //
  // Two defects lived here. `includes("HCoin")` could never match: every real event name is
  // upper-case (`HCOIN_EARNED`, `HCOIN_REDEEMED`, ...), so HCoin ledger activity silently fell
  // through to SYSTEM_LOGS. And only debits carried a keyword — `WALLET_DEBIT` was retained for
  // 10 years while the credits that put the money there (`PARTNER_INCENTIVE_CREDITED`,
  // `REFERRAL_COMMISSION_CREDITED`) and executed adjustments (`FINANCIAL_ADJUSTMENT_*`) were
  // discarded after 1. Financial records must outlive a single year, and one half of a ledger
  // entry must never be retained differently from the other.
  const upper = action.toUpperCase();
  if (
    ["LEDGER", "WALLET", "HCOIN", "INCENTIVE", "COMMISSION", "FINANCIAL", "REFERRAL"].some((term) =>
      upper.includes(term),
    )
  ) {
    return "FINANCIAL_LEDGER";
  }
  if (action.includes("ENCRYPT") || action.includes("DECRYPT") || action.includes("ADMIN")) {
    return "SECURITY_EVENTS";
  }
  return "SYSTEM_LOGS";
}
