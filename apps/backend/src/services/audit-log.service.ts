import { prisma } from "../lib/prisma";
import { logger } from "../lib/logger";
import { getPrismaErrorCode } from "../lib/prisma-errors";
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
  | "OPS_ALERT_ACKNOWLEDGED"
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
  /**
   * Emitted by partner-incentive-payout when an incentive is credited to a partner's wallet.
   * The event was already being written and persisted (rows exist in activity_logs) — the union
   * simply was not updated when the feature shipped, so `listByAction` could not query it.
   */
  | "PARTNER_INCENTIVE_CREDITED"
  | "PARTNER_REFERRAL_REWARD_CREDITED"
  | "FINANCIAL_ADJUSTMENT_CREATED"
  | "FINANCIAL_ADJUSTMENT_APPROVED"
  | "FINANCIAL_ADJUSTMENT_REJECTED"
  | "FINANCIAL_ADJUSTMENT_EXECUTED"
  | "LEDGER_BACKFILL_RUN"
  /**
   * Phase 11 — governed knowledge lifecycle.
   *
   * Approval and withdrawal change what the platform will state as official policy, so they belong
   * in the security audit rather than only in application logs: an answer citing a document is only
   * as accountable as the record of who made that document authoritative.
   */
  | "KNOWLEDGE_APPROVED"
  | "KNOWLEDGE_WITHDRAWN"
  | "KNOWLEDGE_RETRIEVAL_DENIED"
  /**
   * Creating a knowledge document, and declaring which knowledge type outranks which.
   *
   * Authoring is audited because a document that reaches review is already a candidate for becoming
   * policy. Authority is audited because declaring precedence decides which of two official
   * documents the platform will answer from — a governance act with more reach than any single
   * document, and one that must be reconstructable long after the answer it shaped.
   */
  | "KNOWLEDGE_CREATED"
  | "KNOWLEDGE_AUTHORITY_CHANGED"
  /**
   * Phase 12 — ML model governance.
   *
   * A model reaching production changes what the platform predicts, and predictions steer dispatch,
   * pricing and capacity. Approval and promotion are therefore governance acts in the same sense as
   * declaring knowledge precedence: someone decided, and that has to be answerable later. Rollback
   * is audited for the same reason in reverse — "when did we stop trusting it, and who said so".
   */
  | "ML_MODEL_REGISTERED"
  | "ML_MODEL_STAGE_CHANGED"
  | "ML_MODEL_APPROVED"
  | "ML_MODEL_PROMOTED"
  | "ML_MODEL_ROLLED_BACK"
  /**
   * Phase 14 — a spend cap refused an AI request, or refused to price one.
   *
   * Audited as a governance event rather than a log line because it is a control acting: the
   * question "why did AI stop answering at 14:20" has to be answerable later, and a refusal
   * that exists only in stdout is not an answer. ALLOW is not audited per request — at gateway
   * volume that would bury the refusals this exists to surface.
   */
  | "AI_BUDGET_BLOCKED"
  | "AI_BUDGET_POLICY_CHANGED"
  /** Phase 14 — an operator replayed an event, or recovered a stuck workflow instance. */
  | "EVENT_REPLAY_EXECUTED"
  | "WORKFLOW_INSTANCE_RECOVERED"
  /** Phase 15 — a person accepted or refused a machine-generated workflow proposal. */
  | "AI_WORKFLOW_DRAFT_APPROVED"
  | "AI_WORKFLOW_DRAFT_REJECTED"
  | "EXPERIMENT_CREATED"
  | "EXPERIMENT_STATUS_CHANGED"
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
  | "GIFT_CARD_VOIDED"
  | "CAMPAIGN_REDEEMED"
  /** Phase D — a customer recorded their date of birth / support corrected it. The value is never logged. */
  | "CUSTOMER_DOB_RECORDED"
  | "CUSTOMER_DOB_CORRECTED"
  /**
   * Phase 16 — governed agent lifecycle.
   *
   * Five events, not one per phase. Each marks a point where AUTHORITY changed hands: a run was
   * authorised to start, a plan was accepted as the thing that may execute, a plan was refused,
   * work was handed to a human, or the run reached a terminal outcome. Every other phase is
   * already reconstructable from `agent_run_steps` and `ai_tool_executions`, and duplicating it
   * here would make the security log noisier without making it more answerable.
   *
   * AGENT_PLAN_REJECTED is the security-interesting one: it fires when a model asked for a
   * capability its agent does not have, which is what an attempted escalation looks like from
   * the inside.
   */
  | "AGENT_RUN_STARTED"
  | "AGENT_PLAN_ACCEPTED"
  | "AGENT_PLAN_REJECTED"
  | "AGENT_ESCALATED"
  | "AGENT_RUN_COMPLETED";

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

/**
 * Audit writes in flight. `record` is fire-and-forget on request paths (callers `void` it), which is
 * fine for a server that keeps running; a one-shot script that disconnects the database right after
 * its last change would silently lose that change's audit rows. `AuditLogService.drain()` lets it wait.
 */
const inFlight = new Set<Promise<unknown>>();
function track<T>(p: Promise<T>): Promise<T> {
  inFlight.add(p);
  void p.finally(() => inFlight.delete(p)).catch(() => {});
  return p;
}

export class AuditLogService {
  /** Resolves when every audit write started so far has settled (or after `timeoutMs`). Returns how many were still pending when the timeout hit. */
  static async drain(timeoutMs = 15_000): Promise<number> {
    const deadline = Date.now() + timeoutMs;
    while (inFlight.size > 0 && Date.now() < deadline) {
      const timer = new Promise((resolve) => setTimeout(resolve, Math.max(1, deadline - Date.now())));
      await Promise.race([Promise.allSettled([...inFlight]), timer]);
    }
    return inFlight.size;
  }

  static record(event: SecurityEvent, status: AuditStatus, ctx: AuditContext = {}): Promise<void> {
    return track(AuditLogService.recordNow(event, status, ctx));
  }

  private static async recordNow(
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

      /**
       * SYSTEM ACTORS ARE NOT USERS.
       *
       * `activity_logs.user_id` is a foreign key to `users.id`, but several background services
       * identify themselves with a label rather than an account -- `ledgerReconciliationService`
       * passes `startedBy: "ledger-reconciliation"`. That label arrives here as `ctx.userId`,
       * Postgres rejects it on `activity_logs_user_id_fkey`, and the whole audit row is lost. The
       * catch below then logs the failure and moves on, so a SUCCESSFUL privileged action leaves
       * no audit record at all. Observed twice during a single 75-second application boot.
       *
       * The FK is right and the label is right; putting one in the other's column is the bug. On a
       * foreign-key violation the row is rewritten with a null actor FK and the actor label kept in
       * the payload, so the entry survives with its attribution intact.
       *
       * Retry-on-P2003 rather than a pre-flight existence check: the normal path (a real user id)
       * then costs nothing, and the correction happens exactly when it is needed.
       */
      const writeActivityLog = async (actorId: string | null, systemActor?: string) =>
        prisma.activityLog.create({
          data: {
            userId: actorId,
            providerId: ctx.providerId ?? null,
            bookingId: ctx.bookingId ?? null,
            action: event,
            description: JSON.stringify(
              systemActor ? { ...descriptionPayload, systemActor } : descriptionPayload,
            ),
            ipAddress: ctx.ipAddress ?? null,
            userAgent: ctx.userAgent ?? null,
          },
        });

      try {
        await writeActivityLog(ctx.userId ?? null);
      } catch (fkError) {
        if (getPrismaErrorCode(fkError) !== "P2003" || !ctx.userId) throw fkError;
        await writeActivityLog(null, ctx.userId);
        logger.info("audit_actor_not_a_user", {
          category: "SECURITY",
          event,
          systemActor: ctx.userId,
        });
      }

      const enterpriseStatus =
        status === "success" ? "SUCCESS" : status === "failure" ? "FAILURE" : "PARTIAL";

      void track(enterpriseAuditService.log({
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
      }));
    } catch (error) {
      logger.error("audit-log persistence failed", {
        event,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Phase 14 §46 — record a governance act, or refuse to let it happen.
   *
   * `record` above is deliberately fail-open: it catches persistence errors and logs them, so an
   * audit outage cannot take down login, booking or payment. That trade-off is right for the
   * high-volume paths it protects and wrong for a handful of low-volume administrative acts whose
   * *entire point* is that they are attributable. Promoting a model, changing a spend cap,
   * replaying an event against a real consumer or moving a stuck workflow's state are decisions
   * somebody has to answer for later; performing one and losing the only record of it is worse
   * than not performing it, because the action is real either way and only the accountability is
   * missing.
   *
   * So this variant lets the persistence failure through. Callers are expected to audit BEFORE
   * committing the consequential change, so a throw here prevents an unattributable act rather
   * than merely reporting one after the fact.
   *
   * It is not the default, and it should not become one: applying this to authentication would
   * mean an audit-database blip logs every user out of the platform.
   */
  static async recordGoverned(
    event: SecurityEvent,
    status: AuditStatus,
    ctx: AuditContext = {},
  ): Promise<void> {
    const enterpriseStatus =
      status === "success" ? "SUCCESS" : status === "failure" ? "FAILURE" : "PARTIAL";
    const descriptionPayload = {
      status,
      ...(ctx.reason ? { reason: ctx.reason } : {}),
      ...(ctx.details ?? {}),
    };

    /**
     * Awaited AND checked. `enterpriseAuditService.log` catches its own persistence errors and
     * returns null rather than throwing — correct for the fire-and-forget callers it was built
     * for, and useless here: awaiting it would have swallowed the very failure this method exists
     * to surface. The returned row id is the proof of persistence, so a null is the failure.
     */
    const auditId = await enterpriseAuditService.log({
      action: event,
      resource: "governance_event",
      resourceId: ctx.userId ?? undefined,
      actor: ctx.userId ?? undefined,
      actorType: "ADMIN",
      changesAfter: descriptionPayload,
      changesSummary: ctx.reason ?? event,
      status: enterpriseStatus,
      ipAddress: ctx.ipAddress ?? undefined,
      userAgent: ctx.userAgent ?? undefined,
      deviceId: ctx.deviceId ?? undefined,
      traceId: ctx.traceId ?? undefined,
      retentionCategory: securityEventRetention(event),
    });

    if (!auditId) {
      throw new Error(
        `GOVERNANCE_AUDIT_UNAVAILABLE: ${event} could not be recorded, so the action it describes must not proceed unattributed.`,
      );
    }

    // The ActivityLog mirror is best-effort. The governance record is the enterprise row above;
    // failing the whole act because a secondary mirror is unavailable would be gratuitous.
    await prisma.activityLog
      .create({
        data: {
          userId: ctx.userId ?? null,
          action: event,
          description: JSON.stringify(descriptionPayload),
          ipAddress: ctx.ipAddress ?? null,
          userAgent: ctx.userAgent ?? null,
        },
      })
      .catch((error) => {
        logger.warn("governance audit mirror failed", {
          event,
          error: error instanceof Error ? error.message : String(error),
        });
      });
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
