import { WithdrawalStatus } from "@prisma/client";
import type { ToolHandler } from "../../types";
import { supportContextService } from "../../../services/support-context.service";
import { supportIntelligenceService } from "../../../services/support-intelligence.service";
import { knowledgeRetrievalService } from "../../../services/knowledge-retrieval.service";
import { opsAlertService } from "../../../services/ops-alert.service";
import { geoIntelligenceService } from "../../../services/geo-intelligence.service";
import { partnerOperationsService } from "../../../services/partner-operations.service";
import { partnerIntelligenceService } from "../../../services/partner-intelligence.service";
import { financeIntelligenceService } from "../../../services/finance-intelligence.service";
import { financialIntegrityService } from "../../../services/financial-integrity.service";
import { ledgerReconciliationService } from "../../../services/ledger-reconciliation.service";
import { fraudAdminService } from "../../../services/fraud-admin.service";
import { fraudRiskService } from "../../../services/fraud-risk.service";
import { supportTicketService } from "../../../services/support-ticket.service";
import { coverageService } from "../../../services/coverage.service";
import { digitalTwinService } from "../../../services/digital-twin.service";
import { payoutOperationsService } from "../../../services/payout-operations.service";
import { revenueAnomalyService } from "../../../services/revenue-anomaly.service";
import { ToolDomainRejection } from "../errors";

/**
 * Handlers for the Phase-16 agent read surface.
 *
 * Each one is a thin, typed adapter onto an existing authoritative service. None of them
 * computes anything: no arithmetic, no reclassification, no risk scoring, no ledger derivation.
 * That is the whole point — the agent layer must read the same numbers the finance dashboard,
 * the fraud console and the ops map read, from the same code, or "the assistant said X" and
 * "the console says Y" become two different truths about the same platform.
 *
 * Identity is never taken from arguments where the platform can derive it. Where an id IS a
 * legitimate argument (a provider, a ticket, a user under investigation) the tool is admin-gated
 * and the underlying service performs its own scoping, exactly as it does for the HTTP route.
 */

/**
 * Map the gateway role onto the scope vocabulary the support context service enforces.
 *
 * Deliberately narrow. Anything that is not an admin is treated as support, which is the *less*
 * privileged of the two scopes — an unexpected role must lose access, not gain it.
 */
function supportScopeRole(actorRole: string): "admin" | "support" {
  return actorRole === "ADMIN" ? "admin" : "support";
}

function knowledgeRole(actorRole: string): "admin" | "support" {
  return actorRole === "ADMIN" ? "admin" : "support";
}

export const PHASE16_AGENT_HANDLERS: Record<string, ToolHandler> = {
  // ── Support ───────────────────────────────────────────────────────────────
  "read.support.getTicketContext": async ({ actor, arguments: args }) => {
    const ctx = await supportContextService.build(String(args.ticketId), {
      actorRole: supportScopeRole(actor.actorRole),
      actorUserId: actor.actorId,
    });
    if (!ctx) throw new ToolDomainRejection("Ticket not found or not visible", "TICKET_NOT_FOUND");
    return ctx;
  },

  "read.support.analyzeTicket": async ({ actor, arguments: args }) => {
    const result = await supportIntelligenceService.analyze(String(args.ticketId), {
      actorRole: supportScopeRole(actor.actorRole),
      actorUserId: actor.actorId,
    });
    // `analyze` returns null for both "no such ticket" and "not visible to you", deliberately, so
    // a probe cannot tell them apart. That property is preserved here rather than improved on.
    if (!result) throw new ToolDomainRejection("Ticket not found or not visible", "TICKET_NOT_FOUND");
    return result;
  },

  "read.support.searchKnowledge": async ({ actor, arguments: args }) => {
    const result = await knowledgeRetrievalService.retrieve({
      actor: { actorId: actor.actorId, role: knowledgeRole(actor.actorRole) },
      question: String(args.question),
    });
    return {
      state: result.state,
      chunks: result.chunks,
      limitations: result.limitations,
      rulesVersion: result.rulesVersion,
    };
  },

  // ── Operations ────────────────────────────────────────────────────────────
  "read.ops.getAlerts": async ({ arguments: args }) => {
    const alerts = await opsAlertService.list({
      resolved: typeof args.resolved === "boolean" ? args.resolved : false,
      limit: Number(args.limit ?? 25),
    });
    return {
      alerts,
      count: alerts.length,
      // Freshness is the agent's problem to reason about, so it is stated rather than implied.
      readAt: new Date().toISOString(),
    };
  },

  "read.ops.getZoneIntelligence": async () => geoIntelligenceService.zoneScoring(),

  // ── Partner operations ────────────────────────────────────────────────────
  "read.partnerops.getPartnerSnapshot": async ({ arguments: args }) =>
    partnerOperationsService.snapshot(String(args.providerId)),

  "read.partnerops.getPartnerIntelligence": async ({ arguments: args }) => {
    const ctx = await partnerIntelligenceService.getContext(String(args.providerId));
    if (!ctx) throw new ToolDomainRejection("Partner not found", "PROVIDER_NOT_FOUND");
    return ctx;
  },

  // ── Finance (read only, by construction) ──────────────────────────────────
  "read.finance.getIntelligence": async ({ arguments: args }) =>
    financeIntelligenceService.getFinanceIntelligence(Number(args.days ?? 30)),

  "read.finance.getIntegrityReport": async () => {
    const report = await financialIntegrityService.getLatestReport();
    if (!report) {
      // UNAVAILABLE, not "healthy". A finance assistant that reports "no issues" when it simply
      // has no report is the single most dangerous thing this tool could do.
      return { state: "UNAVAILABLE", reason: "No integrity run has been recorded", report: null };
    }
    return { state: "AVAILABLE", report };
  },

  "read.finance.getReconciliation": async () => {
    const rows = await ledgerReconciliationService.buildReport();
    return { state: "AVAILABLE", rows, readAt: new Date().toISOString() };
  },

  // ── Fraud (investigative, read only) ──────────────────────────────────────
  "read.fraud.getReviewQueue": async ({ arguments: args }) =>
    fraudAdminService.reviewQueue({ limit: args.limit != null ? String(args.limit) : undefined }),

  "read.fraud.getAlerts": async ({ arguments: args }) =>
    fraudAdminService.alerts({ limit: args.limit != null ? String(args.limit) : undefined }),

  "read.fraud.evaluateUser": async ({ arguments: args }) => {
    const evaluation = await fraudRiskService.evaluateUser(String(args.userId));
    return {
      // The shape says what this is, so no downstream summary can quietly promote it.
      kind: "RULE_AND_MODEL_SIGNAL",
      authoritative: false,
      note: "A risk signal, not a fraud verdict. Only an investigator decision in the decision log is a confirmed outcome.",
      evaluation,
    };
  },

  "read.fraud.getDecisionLog": async ({ arguments: args }) =>
    fraudAdminService.decisionLog({ limit: args.limit != null ? String(args.limit) : undefined }),

  // ── Pass 4: the coverage additions ────────────────────────────────────────

  "read.support.listTickets": async ({ arguments: args }) => {
    const page = await supportTicketService.adminList({
      status: args.status != null ? String(args.status) : undefined,
      priority: args.priority != null ? String(args.priority) : undefined,
      assigned: args.assigned != null ? String(args.assigned) : undefined,
      bookingId: args.bookingId != null ? String(args.bookingId) : undefined,
      providerId: args.providerId != null ? String(args.providerId) : undefined,
      search: args.search != null ? String(args.search) : undefined,
      limit: args.limit != null ? String(args.limit) : "25",
    });
    // `readAt` rather than an implied "now": every list an agent reasons over is a snapshot, and
    // the freshness gate downstream needs a timestamp it did not have to guess.
    return { ...page, readAt: new Date().toISOString() };
  },

  "read.support.getAnalytics": async () => ({
    ...(await supportTicketService.adminAnalytics()),
    readAt: new Date().toISOString(),
  }),

  // ── Operations ────────────────────────────────────────────────────────────
  "read.ops.getCoverage": async () => ({
    ...(await coverageService.intelligence()),
    readAt: new Date().toISOString(),
  }),

  "read.ops.getCityTwin": async ({ arguments: args }) => {
    const city = String(args.city ?? "").trim();
    if (!city) throw new ToolDomainRejection("A city is required", "CITY_REQUIRED");
    // The twin already carries `confidence`, `freshness` and `generatedAt`. They are returned
    // untouched — the freshness gate reads them, and rewriting them here would let this adapter
    // launder a stale layer into a fresh-looking result.
    return digitalTwinService.cityTwin(city);
  },

  // ── Partner operations ────────────────────────────────────────────────────
  "read.partnerops.getRoster": async ({ arguments: args }) => ({
    ...(await partnerOperationsService.adminRoster({
      status: args.status != null ? String(args.status) : undefined,
      zone: args.zone != null ? String(args.zone) : undefined,
      capacity: args.capacity === "full" || args.capacity === "available" ? args.capacity : undefined,
      search: args.search != null ? String(args.search) : undefined,
      limit: args.limit != null ? Number(args.limit) : 40,
    })),
    readAt: new Date().toISOString(),
  }),

  // ── Finance (still read-only, by construction) ────────────────────────────
  "read.finance.getPayoutMetrics": async () => ({
    ...(await payoutOperationsService.dashboardMetrics()),
    readAt: new Date().toISOString(),
  }),

  "read.finance.getPayoutQueue": async ({ arguments: args }) => {
    // A status the enum does not contain is a rejection, not a silently dropped filter. Dropping
    // it would turn "show me the FAILED payouts" into "show me every open payout" — a broader
    // answer than was asked for, which is the wrong direction for a finance surface.
    let status: WithdrawalStatus | undefined;
    if (args.status != null) {
      const wanted = String(args.status).toUpperCase();
      if (!(wanted in WithdrawalStatus)) {
        throw new ToolDomainRejection(`Unknown withdrawal status ${wanted}`, "INVALID_STATUS");
      }
      status = wanted as WithdrawalStatus;
    }
    const rows = await payoutOperationsService.listQueue(
      { status, providerId: args.providerId != null ? String(args.providerId) : undefined },
      Number(args.limit ?? 50),
    );
    return {
      kind: "PAYOUT_QUEUE_READ",
      // Stated in the payload, not only in the prompt. A summariser that never read the tool
      // description still cannot present this as something the assistant is able to act on.
      note: "Analysis only. Approving, releasing or retrying a payout is a human action in the payout console.",
      rows,
      readAt: new Date().toISOString(),
    };
  },

  "read.finance.getRevenueAnomalies": async ({ arguments: args }) =>
    revenueAnomalyService.evaluate(args.metric != null ? String(args.metric) : "gmv"),

  // ── Fraud ─────────────────────────────────────────────────────────────────
  "read.fraud.getHighRiskUsers": async ({ arguments: args }) => {
    const users = await fraudAdminService.highRiskUsers(Number(args.limit ?? 20));
    return {
      kind: "STORED_RISK_SCORE",
      authoritative: false,
      note: "Stored model and rule scores. A score is not a finding; only an investigator decision is.",
      users,
      readAt: new Date().toISOString(),
    };
  },

  // ── The operational write ─────────────────────────────────────────────────
  "write.ops.resolveAlert": async ({ arguments: args }) => {
    const alertId = String(args.alertId);
    const resolved = await opsAlertService.resolve(alertId).catch(() => null);
    if (!resolved) {
      throw new ToolDomainRejection(`Alert ${alertId} could not be resolved`, "ALERT_NOT_FOUND");
    }
    return { alertId, resolved: resolved.resolved, resolvedAt: resolved.resolvedAt };
  },

  // ── The escalation write ──────────────────────────────────────────────────
  "write.support.escalateTicket": async ({ actor, arguments: args }) => {
    const ticketId = String(args.ticketId);
    const note = String(args.note ?? "").trim();
    if (!note) throw new ToolDomainRejection("An escalation note is required", "NOTE_REQUIRED");
    // `adminEscalate` returns null for an unknown ticket rather than throwing. Returning that as a
    // success would produce a step that verified against nothing, so it becomes a rejection here.
    const updated = await supportTicketService.adminEscalate(ticketId, actor.actorId, note);
    if (!updated) throw new ToolDomainRejection("Ticket not found", "TICKET_NOT_FOUND");
    return { ticketId, priorityLevel: updated.priorityLevel, status: updated.status };
  },
};
