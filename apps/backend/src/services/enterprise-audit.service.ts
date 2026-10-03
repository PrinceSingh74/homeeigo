import crypto from "crypto";
import type {
  EnterpriseActorType,
  EnterpriseAuditStatus,
  Prisma,
  RetentionCategory,
} from "@prisma/client";
import { logger, scrubTextForTelemetry } from "../lib/logger";

async function getPrisma() {
  const { default: prisma } = await import("../lib/prisma-base");
  return prisma;
}
import { integrityHash } from "../lib/pii-crypto";

/**
 * Retention in days, per category.
 *
 * `Partial` rather than a total Record, deliberately. The Phase-14 categories — AI_TELEMETRY,
 * AUTOMATION_TELEMETRY, OPERATIONAL_ACTIVITY — have no agreed duration in this project, and a
 * total map would force one to be typed in here to satisfy the compiler. That is exactly how an
 * invented number becomes policy: not by a decision, but by an entry someone added to silence an
 * error. An absent key means "no duration has been agreed", which is a real state and now an
 * expressible one; `retentionExpiresAt` is left null for those, so nothing expires by accident.
 */
const RETENTION_DAYS: Partial<Record<RetentionCategory, number>> = {
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

/**
 * Emails and phone numbers are masked IN PLACE with the log pipeline's policy (identifier shapes —
 * cuids, UUIDs, booking numbers, timestamps, hashes — are shielded first). This used to replace the
 * WHOLE string with a REDACTED_PHONE marker whenever it held 10+ digits in total, which erased actor ids,
 * booking ids, timestamps and approval reasons from 28,003 live audit rows (2026-09-29).
 */
export function sanitizeAuditValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return scrubTextForTelemetry(value);
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

/**
 * Null when the category has no agreed retention period.
 *
 * This used to fall back to SYSTEM_LOGS — one year — for any category it did not recognise. That
 * fallback is how an unagreed category silently acquires a deletion date: adding AI_TELEMETRY
 * would have stamped every AI telemetry record with a one-year expiry that nobody chose. A null
 * expiry means the purge job never selects the row, so an undecided policy keeps data rather than
 * quietly destroying it.
 */
function retentionExpiry(category: RetentionCategory): Date | null {
  const days = RETENTION_DAYS[category];
  if (days === undefined) return null;
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
  /**
   * Phase 14 — governance acts are security events, not system logs.
   *
   * Everything below used to fall through to SYSTEM_LOGS, the shortest bucket at one year: model
   * approvals and promotions, rollbacks, budget refusals, operator event replays, workflow
   * recoveries and experiment activations. Those are privileged administrative decisions with a
   * named actor, and they are exactly the records an audit needs years later — "who approved the
   * model that was serving in March" is not a question that becomes uninteresting after twelve
   * months. Meanwhile `WORKFLOW_INSTANCE_RECOVERED` was retained for one year while the ledger
   * entry it may have produced was retained for ten.
   *
   * This adds no new retention duration and invents no policy. It routes these events into
   * SECURITY_EVENTS, the category this project already applies to privileged administrative
   * action, alongside the ADMIN_* events they sit beside operationally.
   */
  if (
    ["ML_MODEL", "AI_BUDGET", "EVENT_REPLAY", "WORKFLOW_INSTANCE", "EXPERIMENT", "APPROVAL", "POLICY"].some(
      (term) => upper.includes(term),
    )
  ) {
    return "SECURITY_EVENTS";
  }
  if (action.includes("ENCRYPT") || action.includes("DECRYPT") || action.includes("ADMIN")) {
    return "SECURITY_EVENTS";
  }
  return "SYSTEM_LOGS";
}
