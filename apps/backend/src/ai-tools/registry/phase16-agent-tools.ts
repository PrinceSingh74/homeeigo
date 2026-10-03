import type { ToolRegistryEntry } from "../types";

type CatalogEntry = Omit<ToolRegistryEntry, "handler">;

/**
 * Phase 16 — the read surface the five governed agents plan against.
 *
 * These are ordinary catalog entries, added to the SAME registry every other tool lives in, so
 * they inherit the whole Phase-5 chain unchanged: schema validation, policy rules, RBAC,
 * ownership, rate limiting, circuit breaking, idempotency and audit. Nothing here introduces a
 * second execution path — an agent reaches them through `executeTool` exactly as a chat surface
 * or an HTTP caller would.
 *
 * Every one is READ. The agents' only side-effecting capabilities reuse tools that already
 * existed and were already certified (`write.support.closeSupportTicket`,
 * `write.notification.sendPartnerNotification`), plus one narrow operational write below. That
 * asymmetry is deliberate: Phase 16 is about governed reasoning over authoritative data, and
 * every new *write* surface is new blast radius.
 *
 * `requiredPermission` values are chosen to fall inside the permission namespaces the existing
 * role table already grants. Widening `ROLE_TOOL_PERMISSIONS` to fit a new tool would hand every
 * holder of that role a capability nobody reviewed — the tool is made to fit the roles, not the
 * other way round.
 */

function read(params: {
  toolId: string;
  name: string;
  description: string;
  permission: string;
  role: string;
  policy: string;
  risk: CatalogEntry["riskLevel"];
  parameters: CatalogEntry["parameters"];
  required?: string[];
  service: string;
  owner: string;
  timeoutMs?: number;
}): CatalogEntry {
  return {
    toolId: params.toolId,
    name: params.name,
    description: params.description,
    category: "READ",
    version: "1.0.0",
    requiredPermission: params.permission,
    requiredRole: params.role,
    requiredPolicy: params.policy,
    riskLevel: params.risk,
    parameters: params.parameters,
    validationSchema: {
      type: "object",
      required: params.required ?? [],
      properties: Object.fromEntries(params.parameters.map((p) => [p.name, { type: p.type }])),
    },
    timeoutMs: params.timeoutMs ?? 20_000,
    // Reads are safe to repeat, and a transient database blip should not fail an agent step.
    maxRetries: 1,
    auditRequired: true,
    approvalRequired: false,
    serviceMapping: params.service,
    metricsKey: params.toolId.split(".").pop(),
    costEstimateUsd: 0,
    owner: params.owner,
    status: "ACTIVE",
  };
}

export const PHASE16_AGENT_TOOLS: CatalogEntry[] = [
  // ── Support Agent reads ───────────────────────────────────────────────────
  read({
    toolId: "read.support.getTicketContext",
    name: "getTicketContext",
    description:
      "Authoritative context for one support ticket: customer, booking, payment, refund and partner signals",
    permission: "tools.read.common.support_context",
    role: "ADMIN,SUPPORT",
    policy: "support.ticket.read",
    risk: "MEDIUM",
    parameters: [{ name: "ticketId", type: "string", required: true, description: "Support ticket id" }],
    required: ["ticketId"],
    service: "supportContext.service.build",
    owner: "support-platform",
  }),
  read({
    toolId: "read.support.analyzeTicket",
    name: "analyzeTicket",
    description:
      "The platform's own analysis of one ticket: classification, resolution recommendation, automation eligibility and priority",
    permission: "tools.read.common.support_analysis",
    role: "ADMIN,SUPPORT",
    policy: "support.ticket.read",
    risk: "MEDIUM",
    parameters: [{ name: "ticketId", type: "string", required: true, description: "Support ticket id" }],
    required: ["ticketId"],
    // One tool over `supportIntelligenceService.analyze`, not three over its parts. Splitting it
    // would have meant re-assembling context, classification and recommendation in this layer —
    // a second support-analysis path that could disagree with the one the support console shows.
    service: "supportIntelligence.service.analyze",
    owner: "support-platform",
    timeoutMs: 30_000,
  }),
  read({
    toolId: "read.support.searchKnowledge",
    name: "searchKnowledge",
    description: "Grounded answer from the governed knowledge base, with citations",
    permission: "tools.read.common.knowledge",
    role: "ADMIN,SUPPORT",
    policy: "knowledge.read",
    risk: "LOW",
    parameters: [
      { name: "question", type: "string", required: true, description: "Natural-language question" },
      { name: "audience", type: "string", required: false, description: "Knowledge audience scope" },
    ],
    required: ["question"],
    service: "knowledgeRetrieval.service.retrieve",
    owner: "support-platform",
    timeoutMs: 25_000,
  }),

  // ── Operations Agent reads ────────────────────────────────────────────────
  read({
    toolId: "read.ops.getAlerts",
    name: "getOpsAlerts",
    description: "Open operational alerts with severity and subject",
    permission: "tools.read.admin.ops_alerts",
    role: "ADMIN",
    policy: "admin.operations.read",
    risk: "LOW",
    parameters: [
      { name: "resolved", type: "boolean", required: false, description: "Filter by resolution state" },
      { name: "limit", type: "number", required: false, description: "Max alerts" },
    ],
    service: "opsAlert.service.list",
    owner: "operations-platform",
  }),
  read({
    toolId: "read.ops.getZoneIntelligence",
    name: "getZoneIntelligence",
    description: "Per-zone supply, demand, gap and opportunity scoring with freshness",
    permission: "tools.read.admin.ops_zones",
    role: "ADMIN",
    policy: "admin.operations.read",
    risk: "LOW",
    parameters: [],
    service: "geoIntelligence.service.zoneScoring",
    owner: "operations-platform",
  }),

  // ── Partner Operations Agent reads ────────────────────────────────────────
  //
  // Distinct from the `read.partner.*` family, which resolves the provider from the
  // AUTHENTICATED actor and is therefore only meaningful when a partner is the caller. An
  // admin-run agent needs to name a partner, so these take an explicit `providerId` and are
  // gated on the admin role rather than on self-ownership.
  read({
    toolId: "read.partnerops.getPartnerSnapshot",
    name: "getPartnerSnapshot",
    description: "Operational snapshot for one partner: availability, capacity, readiness state",
    permission: "tools.read.admin.partner_snapshot",
    role: "ADMIN",
    policy: "admin.partner.read",
    risk: "MEDIUM",
    parameters: [{ name: "providerId", type: "string", required: true, description: "Provider id" }],
    required: ["providerId"],
    service: "partnerOperations.service.snapshot",
    owner: "partner-platform",
  }),
  read({
    toolId: "read.partnerops.getPartnerIntelligence",
    name: "getPartnerIntelligence",
    description: "Performance, earnings and demand context for one partner",
    permission: "tools.read.admin.partner_intelligence",
    role: "ADMIN",
    policy: "admin.partner.read",
    risk: "MEDIUM",
    parameters: [{ name: "providerId", type: "string", required: true, description: "Provider id" }],
    required: ["providerId"],
    service: "partnerIntelligence.service.getContext",
    owner: "partner-platform",
  }),

  // ── Finance Assistant reads ───────────────────────────────────────────────
  //
  // The Finance Assistant has these and nothing else. There is no finance write tool in this
  // file, and no finance capability in its definition, so "no autonomous money movement" is a
  // property of what exists rather than of a rule that could be misconfigured.
  read({
    toolId: "read.finance.getIntelligence",
    name: "getFinanceIntelligence",
    description: "Canonical GMV, margin and finance intelligence from the authoritative ledger",
    permission: "tools.read.admin.finance_intelligence",
    role: "ADMIN",
    policy: "admin.finance.read",
    risk: "MEDIUM",
    parameters: [{ name: "days", type: "number", required: false, description: "Lookback window" }],
    service: "financeIntelligence.service.getFinanceIntelligence",
    owner: "finance-platform",
  }),
  read({
    toolId: "read.finance.getIntegrityReport",
    name: "getFinanceIntegrityReport",
    description: "Latest financial integrity check run, including every failing invariant",
    permission: "tools.read.admin.finance_integrity",
    role: "ADMIN",
    policy: "admin.finance.read",
    risk: "MEDIUM",
    parameters: [],
    service: "financialIntegrity.service.getLatestReport",
    owner: "finance-platform",
  }),
  read({
    toolId: "read.finance.getReconciliation",
    name: "getFinanceReconciliation",
    description: "Ledger liability reconciliation report by account",
    permission: "tools.read.admin.finance_reconciliation",
    role: "ADMIN",
    policy: "admin.finance.read",
    risk: "MEDIUM",
    parameters: [],
    service: "ledgerReconciliation.service.buildReport",
    owner: "finance-platform",
    timeoutMs: 30_000,
  }),

  // ── Fraud Investigation Assistant reads ───────────────────────────────────
  //
  // Investigative only. Every enforcement action — ban, freeze, reversal — remains a HIGH_RISK
  // tool this agent cannot name, reach or plan against.
  read({
    toolId: "read.fraud.getReviewQueue",
    name: "getFraudReviewQueue",
    description: "Cases awaiting investigator review, with signals and current state",
    permission: "tools.read.admin.fraud_queue",
    role: "ADMIN",
    policy: "admin.fraud.read",
    risk: "MEDIUM",
    parameters: [{ name: "limit", type: "number", required: false, description: "Max cases" }],
    service: "fraudAdmin.service.reviewQueue",
    owner: "trust-and-safety",
  }),
  read({
    toolId: "read.fraud.getAlerts",
    name: "getFraudAlerts",
    description: "Fraud alerts with rule provenance and timestamps",
    permission: "tools.read.admin.fraud_alerts",
    role: "ADMIN",
    policy: "admin.fraud.read",
    risk: "MEDIUM",
    parameters: [{ name: "limit", type: "number", required: false, description: "Max alerts" }],
    service: "fraudAdmin.service.alerts",
    owner: "trust-and-safety",
  }),
  read({
    toolId: "read.fraud.evaluateUser",
    name: "evaluateUserRisk",
    description:
      "Rule and model signals for one user. A SCORE, never a verdict — the confirmed outcome lives in the decision log.",
    permission: "tools.read.admin.fraud_evaluate",
    role: "ADMIN",
    policy: "admin.fraud.read",
    risk: "MEDIUM",
    parameters: [{ name: "userId", type: "string", required: true, description: "User id" }],
    required: ["userId"],
    service: "fraudRisk.service.evaluateUser",
    owner: "trust-and-safety",
  }),
  read({
    toolId: "read.fraud.getDecisionLog",
    name: "getFraudDecisionLog",
    description: "Human investigator decisions — the only authoritative record of a fraud outcome",
    permission: "tools.read.admin.fraud_decisions",
    role: "ADMIN",
    policy: "admin.fraud.read",
    risk: "MEDIUM",
    parameters: [{ name: "limit", type: "number", required: false, description: "Max entries" }],
    service: "fraudAdmin.service.decisionLog",
    owner: "trust-and-safety",
  }),

  // ── Pass 4: closing the discovered business-coverage gaps ─────────────────
  //
  // Everything below was found by walking the actual service layer, not by imagining what an
  // agent might want. Each closes a question the agents provably could not answer: the Support
  // Agent could read a ticket it was HANDED but could not find one; the Operations Agent could
  // see a zone score but not the city context that explains it; the Finance Assistant could read
  // the ledger but not the payout pipeline that most often causes the mismatch it is asked about.

  read({
    toolId: "read.support.listTickets",
    name: "listSupportTickets",
    description:
      "Search and filter the support ticket queue by status, priority, booking, partner or text",
    permission: "tools.read.common.support_queue",
    role: "ADMIN,SUPPORT",
    policy: "support.ticket.read",
    risk: "MEDIUM",
    parameters: [
      { name: "status", type: "string", required: false, description: "OPEN | IN_PROGRESS | RESOLVED | CLOSED | all" },
      { name: "priority", type: "string", required: false, description: "HIGH | NORMAL | LOW" },
      { name: "assigned", type: "string", required: false, description: "Value 'open' restricts to unresolved tickets" },
      { name: "bookingId", type: "string", required: false, description: "Tickets attached to one booking" },
      { name: "providerId", type: "string", required: false, description: "Tickets attached to one partner" },
      { name: "search", type: "string", required: false, description: "Subject or ticket-number substring" },
      { name: "limit", type: "number", required: false, description: "Max tickets" },
    ],
    // The queue read the agent was missing entirely. Without it, "show me today's critical support
    // issues" — the most ordinary thing a support operator asks — had no governed path at all, and
    // the agent could only ever act on a ticket somebody else had already picked out.
    service: "supportTicket.service.adminList",
    owner: "support-platform",
  }),
  read({
    toolId: "read.support.getAnalytics",
    name: "getSupportAnalytics",
    description: "Open ticket counts by priority, SLA breach count and average response time",
    permission: "tools.read.common.support_analytics",
    role: "ADMIN,SUPPORT",
    policy: "support.ticket.read",
    risk: "LOW",
    parameters: [],
    service: "supportTicket.service.adminAnalytics",
    owner: "support-platform",
  }),

  read({
    toolId: "read.ops.getCoverage",
    name: "getCoverageIntelligence",
    description: "City and area coverage: served demand, unmet requests and expansion pressure",
    permission: "tools.read.admin.ops_coverage",
    role: "ADMIN",
    policy: "admin.operations.read",
    risk: "LOW",
    parameters: [],
    service: "coverage.service.intelligence",
    owner: "operations-platform",
    timeoutMs: 30_000,
  }),
  read({
    toolId: "read.ops.getCityTwin",
    name: "getCityTwin",
    description:
      "The layered city digital twin — demand, supply, pricing, weather, fraud and revenue for one city, with confidence and freshness",
    permission: "tools.read.admin.ops_city_twin",
    role: "ADMIN",
    policy: "admin.operations.read",
    risk: "LOW",
    parameters: [{ name: "city", type: "string", required: true, description: "City name" }],
    required: ["city"],
    // This is what turns "supply is low" into "supply is low in this city, because of X, affecting
    // Y". §15 asks for cause and impact rather than a bare observation, and the twin is the only
    // place the platform already assembles both from the same underlying reads.
    service: "digitalTwin.service.cityTwin",
    owner: "operations-platform",
    timeoutMs: 30_000,
  }),

  read({
    toolId: "read.partnerops.getRoster",
    name: "getPartnerRoster",
    description: "Filterable partner roster with availability, capacity and zone",
    permission: "tools.read.admin.partner_roster",
    role: "ADMIN",
    policy: "admin.partner.read",
    risk: "MEDIUM",
    parameters: [
      { name: "status", type: "string", required: false, description: "Availability status filter" },
      { name: "zone", type: "string", required: false, description: "Zone filter" },
      { name: "capacity", type: "string", required: false, description: "full | available" },
      { name: "search", type: "string", required: false, description: "Name or business substring" },
      { name: "limit", type: "number", required: false, description: "Max partners" },
    ],
    // The partner equivalent of the missing ticket queue: the agent could inspect a partner it was
    // handed, but could not answer "which partners in this zone are unavailable".
    service: "partnerOperations.service.adminRoster",
    owner: "partner-platform",
  }),

  read({
    toolId: "read.finance.getPayoutMetrics",
    name: "getPayoutMetrics",
    description:
      "Withdrawal pipeline health: pending, processing, settled, failed and mean settlement time",
    permission: "tools.read.admin.finance_payout_metrics",
    role: "ADMIN",
    policy: "admin.finance.read",
    risk: "MEDIUM",
    parameters: [],
    service: "payoutOperations.service.dashboardMetrics",
    owner: "finance-platform",
  }),
  read({
    toolId: "read.finance.getPayoutQueue",
    name: "getPayoutQueue",
    description: "Withdrawals awaiting or failing settlement, for analysis only",
    permission: "tools.read.admin.finance_payout_queue",
    role: "ADMIN",
    policy: "admin.finance.read",
    risk: "MEDIUM",
    parameters: [
      { name: "status", type: "string", required: false, description: "Withdrawal status filter" },
      { name: "providerId", type: "string", required: false, description: "One partner's payouts" },
      { name: "limit", type: "number", required: false, description: "Max rows" },
    ],
    // READ, and only READ. Approving, releasing or retrying any row in this queue remains a human
    // action reached through the payout console: the assistant can explain the queue and has no
    // vocabulary in which to move it.
    service: "payoutOperations.service.listQueue",
    owner: "finance-platform",
  }),
  read({
    toolId: "read.finance.getRevenueAnomalies",
    name: "getRevenueAnomalies",
    description: "Statistical revenue anomaly detection with baseline, deviation and reason codes",
    permission: "tools.read.admin.finance_anomalies",
    role: "ADMIN",
    policy: "admin.finance.read",
    risk: "MEDIUM",
    parameters: [
      { name: "metric", type: "string", required: false, description: "Metric to evaluate (default gmv)" },
    ],
    service: "revenueAnomaly.service.evaluate",
    owner: "finance-platform",
    timeoutMs: 30_000,
  }),

  read({
    toolId: "read.fraud.getHighRiskUsers",
    name: "getHighRiskUsers",
    description: "Users carrying an elevated stored risk score, ordered by score",
    permission: "tools.read.admin.fraud_high_risk",
    role: "ADMIN",
    policy: "admin.fraud.read",
    risk: "MEDIUM",
    parameters: [{ name: "limit", type: "number", required: false, description: "Max users" }],
    service: "fraudAdmin.service.highRiskUsers",
    owner: "trust-and-safety",
  }),

  // ── Write 1 of 2: resolving an operational alert ──────────────────────────
  //
  // Resolving an operational alert is reversible, affects no money, no account state and no
  // customer, and is the natural close of the loop the Operations Agent opens when it reads
  // one. It is still MEDIUM, so it still passes through the confirmation rule for human
  // actors and remains outside every agent whose definition does not name it.
  {
    toolId: "write.ops.resolveAlert",
    name: "resolveOpsAlert",
    description: "Mark an operational alert resolved",
    category: "WRITE",
    version: "1.0.0",
    requiredPermission: "tools.write.admin.ops_alert_resolve",
    requiredRole: "ADMIN",
    requiredPolicy: "admin.operations.write",
    riskLevel: "MEDIUM",
    parameters: [{ name: "alertId", type: "string", required: true, description: "Operational alert id" }],
    validationSchema: {
      type: "object",
      required: ["alertId"],
      properties: { alertId: { type: "string" } },
    },
    timeoutMs: 15_000,
    maxRetries: 0,
    auditRequired: true,
    approvalRequired: false,
    serviceMapping: "opsAlert.service.resolve",
    eventMapping: "homigo.ops.alert.resolved",
    metricsKey: "resolveAlert",
    costEstimateUsd: 0,
    owner: "operations-platform",
    status: "ACTIVE",
  },

  // ── Write 2 of 2: escalation ──────────────────────────────────────────────
  //
  // Escalation is the one write whose failure mode points the safe way. A ticket the agent wrongly
  // closes strands a customer; a ticket it wrongly escalates costs a person a few minutes. §11
  // names escalation as a support capability, and giving an agent a governed way to hand work to a
  // human is the opposite of giving it more autonomy.
  //
  // It raises priority to HIGH and attaches an internal note. It cannot close the ticket, cannot
  // touch money, and cannot write anything the customer will read.
  {
    toolId: "write.support.escalateTicket",
    name: "escalateSupportTicket",
    description: "Raise a support ticket to HIGH priority and attach an internal escalation note",
    category: "WRITE",
    version: "1.0.0",
    // The exact permission SUPPORT already holds — not a new namespace. Widening the role table to
    // fit a tool hands every holder of that role a capability nobody reviewed.
    requiredPermission: "tools.write.admin.support",
    requiredRole: "ADMIN,SUPPORT",
    requiredPolicy: "admin.support.write",
    riskLevel: "MEDIUM",
    parameters: [
      { name: "ticketId", type: "string", required: true, description: "Ticket id" },
      { name: "note", type: "string", required: true, description: "Internal note explaining the escalation" },
    ],
    validationSchema: {
      type: "object",
      required: ["ticketId", "note"],
      properties: { ticketId: { type: "string" }, note: { type: "string" } },
    },
    timeoutMs: 15_000,
    maxRetries: 0,
    auditRequired: true,
    approvalRequired: false,
    serviceMapping: "supportTicket.service.adminEscalate",
    metricsKey: "escalateTicket",
    costEstimateUsd: 0,
    owner: "support-platform",
    status: "ACTIVE",
  },
];
