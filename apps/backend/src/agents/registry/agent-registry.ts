import { AGENT_FLAGS, agentsConfig } from "../config";
import type { AgentCapability, AgentDefinition, AgentId } from "../types";
import { getTool } from "../../ai-tools/registry/tool-registry";

/**
 * The five Phase-16 agents, and the entirety of what each may do.
 *
 * ── Why this layer exists at all ──────────────────────────────────────────────
 *
 * The Phase-5 tool layer authorises by ROLE. That is the right unit for a human or a chat
 * surface, and it is the wrong unit here: the Operations Agent, the Partner Operations Agent,
 * the Finance Assistant and the Fraud Assistant all necessarily run as ADMIN, and ADMIN is
 * granted `tools.read.admin.*`. Under role authorisation alone, the Support Agent asking for a
 * finance tool and the Finance Assistant asking for a fraud enforcement tool would both be
 * allowed — the policy engine has no way to tell one caller apart from the other, because to
 * it they are the same actor.
 *
 * So the agent, not the role, is the authorisation subject here, and this registry is the
 * allowlist. It is the smallest thing that makes §52 cross-agent security expressible; it does
 * not re-implement policy, RBAC, approval or audit, all of which still run underneath on every
 * single call. An agent must pass BOTH: this allowlist first, then the whole existing chain.
 *
 * ── Why capabilities rather than tool ids ─────────────────────────────────────
 *
 * The model plans in capability names and never sees a tool id. A plan therefore cannot NAME a
 * tool outside its agent's vocabulary, let alone reach one: an unknown capability is a rejected
 * plan before any registry lookup happens. This is defence in depth rather than the defence —
 * `assertCapabilityAllowed` re-checks at execution time, because a validation that happens only
 * at parse time protects only the paths that went through the parser.
 */

/**
 * Capabilities shared by the two agents that may talk to people.
 *
 * Notification is MEDIUM and carries a post-condition, because "the message was sent" is a
 * claim that has to be checked rather than assumed.
 */
const NOTIFY_PARTNER: AgentCapability = {
  name: "partner.notify",
  description: "Send an operational notification to one partner",
  toolId: "write.notification.sendPartnerNotification",
  risk: "MEDIUM",
  dataClasses: ["INTERNAL", "PERSONAL"],
  allowedArguments: ["userId", "title", "message"],
  postCondition: { check: "notification.delivered", subjectArgument: "userId" },
};

export const AGENT_DEFINITIONS: Record<AgentId, AgentDefinition> = {
  // ── Support Agent ─────────────────────────────────────────────────────────
  support: {
    agentId: "support",
    name: "Support Agent",
    description:
      "Understands a support ticket, grounds itself in platform context and policy, and either resolves it within policy or escalates with evidence.",
    version: "1.1.0",
    promptVersion: "support.v1.1",
    // SUPPORT, not ADMIN. The narrower role is the one that still lets every capability below
    // run, and choosing the wider one "in case" is how an agent quietly acquires reach.
    actorRole: "SUPPORT",
    flagKey: AGENT_FLAGS.support,
    maxAutonomousRisk: "MEDIUM",
    readOnly: false,
    dataClasses: ["PUBLIC", "INTERNAL", "PERSONAL"],
    capabilities: [
      {
        name: "ticket.context",
        description: "Read authoritative context for the ticket",
        toolId: "read.support.getTicketContext",
        risk: "LOW",
        dataClasses: ["INTERNAL", "PERSONAL"],
        allowedArguments: ["ticketId"],
        postCondition: { check: "none.readonly" },
      },
      {
        name: "ticket.analyze",
        description:
          "The platform's own classification, resolution recommendation and automation eligibility",
        toolId: "read.support.analyzeTicket",
        risk: "LOW",
        dataClasses: ["INTERNAL", "PERSONAL"],
        allowedArguments: ["ticketId"],
        postCondition: { check: "none.readonly" },
      },
      {
        name: "knowledge.search",
        description: "Retrieve grounded policy and how-to knowledge with citations",
        toolId: "read.support.searchKnowledge",
        risk: "LOW",
        dataClasses: ["PUBLIC", "INTERNAL"],
        allowedArguments: ["question"],
        postCondition: { check: "none.readonly" },
      },
      {
        // Without this the agent could only ever act on a ticket it was handed. "Show me today's
        // critical support issues" — the most ordinary operator request there is — had no path.
        name: "ticket.search",
        description:
          "Find tickets in the queue by status, priority, booking, partner or text. Use this to locate work, not to act on it.",
        toolId: "read.support.listTickets",
        risk: "LOW",
        dataClasses: ["INTERNAL", "PERSONAL"],
        allowedArguments: [
          "status",
          "priority",
          "assigned",
          "bookingId",
          "providerId",
          "search",
          "limit",
        ],
        postCondition: { check: "none.readonly" },
      },
      {
        name: "support.analytics",
        description: "Queue-level health: open tickets by priority, SLA breaches, response time",
        toolId: "read.support.getAnalytics",
        risk: "LOW",
        dataClasses: ["INTERNAL"],
        allowedArguments: [],
        postCondition: { check: "none.readonly" },
      },
      {
        name: "ticket.resolve",
        description: "Close a ticket with a written resolution",
        toolId: "write.support.closeSupportTicket",
        risk: "MEDIUM",
        dataClasses: ["INTERNAL"],
        allowedArguments: ["ticketId", "resolution"],
        postCondition: {
          check: "ticket.status.changed",
          subjectArgument: "ticketId",
          expected: "RESOLVED",
        },
      },
      {
        // The escalation path §11 asks for. Deliberately the agent's easiest write to justify:
        // getting it wrong costs a person a few minutes, where a wrong `ticket.resolve` strands
        // a customer.
        name: "ticket.escalate",
        description:
          "Raise a ticket to HIGH priority with an internal note. Use when the ticket needs a human, not when it can be resolved.",
        toolId: "write.support.escalateTicket",
        risk: "MEDIUM",
        dataClasses: ["INTERNAL"],
        allowedArguments: ["ticketId", "note"],
        postCondition: { check: "ticket.priority.escalated", subjectArgument: "ticketId" },
      },
    ],
    bounds: { maxSteps: 8, maxToolCalls: 10, maxElapsedMs: 90_000, maxCostUsd: 0.2, maxTokens: 16_000, maxDepth: 2 },
  },

  // ── Operations Agent ──────────────────────────────────────────────────────
  operations: {
    agentId: "operations",
    name: "Operations Agent",
    description:
      "Detects an operational issue, gathers zone and supply evidence, and either closes a resolved alert or escalates a supply intervention to a human.",
    version: "1.1.0",
    promptVersion: "operations.v1.1",
    actorRole: "ADMIN",
    flagKey: AGENT_FLAGS.operations,
    maxAutonomousRisk: "MEDIUM",
    readOnly: false,
    dataClasses: ["PUBLIC", "INTERNAL"],
    capabilities: [
      {
        name: "ops.alerts",
        description: "Read open operational alerts",
        toolId: "read.ops.getAlerts",
        risk: "LOW",
        dataClasses: ["INTERNAL"],
        allowedArguments: ["resolved", "limit"],
        postCondition: { check: "none.readonly" },
      },
      {
        name: "ops.zones",
        description: "Read per-zone supply, demand and opportunity scoring",
        toolId: "read.ops.getZoneIntelligence",
        risk: "LOW",
        dataClasses: ["INTERNAL"],
        allowedArguments: [],
        // Zone scoring is cached for 180s upstream. `freshness` is stamped inside the cached
        // builder, so it reports when the scoring was COMPUTED rather than when it was served —
        // which is the only reason a staleness check here can ever fire.
        freshness: { maxAgeMs: 300_000 },
        postCondition: { check: "none.readonly" },
      },
      {
        name: "ops.supplyDemand",
        description: "Read platform-level supply and demand",
        toolId: "read.admin.getSupplyDemand",
        risk: "LOW",
        dataClasses: ["INTERNAL"],
        allowedArguments: [],
        postCondition: { check: "none.readonly" },
      },
      {
        name: "ops.forecast",
        description: "Read the demand forecast for a horizon",
        toolId: "read.admin.getForecast",
        risk: "LOW",
        dataClasses: ["INTERNAL"],
        allowedArguments: ["horizonHours"],
        postCondition: { check: "none.readonly" },
      },
      {
        name: "ops.weather",
        description: "Read weather conditions affecting operations",
        toolId: "read.common.getWeather",
        risk: "LOW",
        dataClasses: ["PUBLIC"],
        allowedArguments: ["city", "lat", "lng"],
        postCondition: { check: "none.readonly" },
      },
      {
        name: "ops.coverage",
        description: "City and area coverage: served demand, unmet requests and expansion pressure",
        toolId: "read.ops.getCoverage",
        risk: "LOW",
        dataClasses: ["INTERNAL"],
        allowedArguments: [],
        // Coverage intelligence is computed live but aggregates request rows up to 2000 deep;
        // `generatedAt` is set at computation. A 15-minute window is generous and still catches
        // a report an operator left open on a screen.
        freshness: { maxAgeMs: 900_000 },
        postCondition: { check: "none.readonly" },
      },
      {
        // §15 asks for cause and impact rather than "supply low". The twin is the only place the
        // platform already assembles demand, supply, pricing, weather and revenue for one city
        // from the same underlying reads, so this is where a causal answer can come from without
        // the agent inventing the correlation itself.
        name: "ops.cityTwin",
        description:
          "Layered city model — demand, supply, pricing, weather, fraud and revenue — with confidence and freshness. Use it to explain WHY a zone is under pressure.",
        toolId: "read.ops.getCityTwin",
        risk: "LOW",
        dataClasses: ["INTERNAL"],
        allowedArguments: ["city"],
        // The twin is cached for 45s and each layer carries its own `freshness` from when it
        // was computed. A stale twin is the classic way an agent closes an alert about a
        // condition it never re-checked.
        freshness: { maxAgeMs: 300_000 },
        postCondition: { check: "none.readonly" },
      },
      {
        name: "ops.resolveAlert",
        description: "Close an operational alert whose underlying condition has cleared",
        toolId: "write.ops.resolveAlert",
        risk: "MEDIUM",
        dataClasses: ["INTERNAL"],
        allowedArguments: ["alertId"],
        postCondition: { check: "none.readonly" },
      },
    ],
    bounds: { maxSteps: 8, maxToolCalls: 12, maxElapsedMs: 120_000, maxCostUsd: 0.25, maxTokens: 20_000, maxDepth: 2 },
  },

  // ── Partner Operations Agent ──────────────────────────────────────────────
  "partner-operations": {
    agentId: "partner-operations",
    name: "Partner Operations Agent",
    description:
      "Reviews one partner's operational state and either sends an approved routine communication or escalates. Never decides eligibility, pay or standing.",
    version: "1.1.0",
    promptVersion: "partner-operations.v1.1",
    actorRole: "ADMIN",
    flagKey: AGENT_FLAGS["partner-operations"],
    maxAutonomousRisk: "MEDIUM",
    readOnly: false,
    // No FINANCIAL, no FRAUD. A partner-operations question that needs either is an escalation,
    // not a wider grant.
    dataClasses: ["INTERNAL", "PERSONAL"],
    capabilities: [
      {
        name: "partner.snapshot",
        description: "Read one partner's availability, capacity and readiness",
        toolId: "read.partnerops.getPartnerSnapshot",
        risk: "LOW",
        dataClasses: ["INTERNAL"],
        allowedArguments: ["providerId"],
        postCondition: { check: "none.readonly" },
      },
      {
        name: "partner.intelligence",
        description: "Read one partner's performance and demand context",
        toolId: "read.partnerops.getPartnerIntelligence",
        risk: "LOW",
        dataClasses: ["INTERNAL"],
        allowedArguments: ["providerId"],
        postCondition: { check: "none.readonly" },
      },
      {
        // The partner equivalent of the ticket queue the Support Agent was missing: the agent
        // could inspect a partner it was handed, but could not answer "which partners in this
        // zone are unavailable" — the question that actually starts a partner-ops investigation.
        name: "partner.roster",
        description:
          "Find partners by availability, capacity or zone. Use this to locate the partner in question, not to act on one.",
        toolId: "read.partnerops.getRoster",
        risk: "LOW",
        dataClasses: ["INTERNAL", "PERSONAL"],
        allowedArguments: ["status", "zone", "capacity", "search", "limit"],
        postCondition: { check: "none.readonly" },
      },
      NOTIFY_PARTNER,
    ],
    bounds: { maxSteps: 7, maxToolCalls: 9, maxElapsedMs: 90_000, maxCostUsd: 0.2, maxTokens: 16_000, maxDepth: 2 },
  },

  // ── Finance Assistant ─────────────────────────────────────────────────────
  //
  // `readOnly: true` is enforced at registry load: adding any capability that resolves to a
  // non-READ tool makes this module throw at import, which takes the process down at boot
  // rather than shipping an assistant that can move money. That is the intended failure mode —
  // a finance agent that silently gained a write is worse than a backend that will not start.
  finance: {
    agentId: "finance",
    name: "Finance Assistant",
    description:
      "Explains and analyses authoritative finance data. Recommends; never executes. Every financial action it identifies is handed to a human.",
    version: "1.1.0",
    promptVersion: "finance.v1.1",
    actorRole: "ADMIN",
    flagKey: AGENT_FLAGS.finance,
    maxAutonomousRisk: "LOW",
    readOnly: true,
    dataClasses: ["INTERNAL", "FINANCIAL"],
    capabilities: [
      {
        name: "finance.summary",
        description: "Read the finance overview",
        toolId: "read.admin.getFinanceSummary",
        risk: "LOW",
        dataClasses: ["FINANCIAL"],
        allowedArguments: ["days"],
        postCondition: { check: "none.readonly" },
      },
      {
        name: "finance.intelligence",
        description: "Read canonical GMV, margin and finance intelligence",
        toolId: "read.finance.getIntelligence",
        risk: "LOW",
        dataClasses: ["FINANCIAL"],
        allowedArguments: ["days"],
        postCondition: { check: "none.readonly" },
      },
      {
        name: "finance.integrity",
        description: "Read the latest financial integrity run and its failing invariants",
        toolId: "read.finance.getIntegrityReport",
        risk: "LOW",
        dataClasses: ["FINANCIAL"],
        allowedArguments: [],
        postCondition: { check: "none.readonly" },
      },
      {
        name: "finance.reconciliation",
        description: "Read the ledger liability reconciliation report",
        toolId: "read.finance.getReconciliation",
        risk: "LOW",
        dataClasses: ["FINANCIAL"],
        allowedArguments: [],
        postCondition: { check: "none.readonly" },
      },
      {
        // The payout pipeline is the most common real cause of the mismatch this assistant is
        // asked to explain, and it could not see it. Reading it is analysis; every row in it stays
        // a human action in the payout console.
        name: "finance.payoutHealth",
        description: "Withdrawal pipeline health: pending, processing, settled, failed, mean settlement time",
        toolId: "read.finance.getPayoutMetrics",
        risk: "LOW",
        dataClasses: ["FINANCIAL"],
        allowedArguments: [],
        postCondition: { check: "none.readonly" },
      },
      {
        name: "finance.payoutQueue",
        description:
          "Withdrawals awaiting or failing settlement. Read only — approving, releasing or retrying one is a human action you cannot take.",
        toolId: "read.finance.getPayoutQueue",
        risk: "LOW",
        dataClasses: ["FINANCIAL", "INTERNAL"],
        allowedArguments: ["status", "providerId", "limit"],
        postCondition: { check: "none.readonly" },
      },
      {
        name: "finance.anomalies",
        description:
          "Statistical revenue anomaly detection with baseline, deviation and reason codes — the platform's own detector, not your arithmetic",
        toolId: "read.finance.getRevenueAnomalies",
        risk: "LOW",
        dataClasses: ["FINANCIAL"],
        allowedArguments: ["metric"],
        // `evaluate` stamps `generatedAt` when the detection actually ran, so an anomaly report
        // that has aged past its window stops counting as evidence.
        freshness: { maxAgeMs: 900_000 },
        postCondition: { check: "none.readonly" },
      },
    ],
    bounds: { maxSteps: 8, maxToolCalls: 10, maxElapsedMs: 120_000, maxCostUsd: 0.2, maxTokens: 20_000, maxDepth: 1 },
  },

  // ── Fraud Investigation Assistant ─────────────────────────────────────────
  //
  // Also `readOnly: true`, for the same structural reason. Nothing in this agent's vocabulary
  // can ban, freeze, reverse or close a case; those remain HIGH_RISK tools it cannot name.
  fraud: {
    agentId: "fraud",
    name: "Fraud Investigation Assistant",
    description:
      "Assembles evidence and timelines for an investigator. Investigative, never judicial: it never declares fraud and never punishes.",
    version: "1.1.0",
    promptVersion: "fraud.v1.1",
    actorRole: "ADMIN",
    flagKey: AGENT_FLAGS.fraud,
    maxAutonomousRisk: "LOW",
    readOnly: true,
    dataClasses: ["INTERNAL", "FRAUD", "PERSONAL"],
    capabilities: [
      {
        name: "fraud.summary",
        description: "Read the fraud overview",
        toolId: "read.admin.getFraudSummary",
        risk: "LOW",
        dataClasses: ["FRAUD"],
        allowedArguments: [],
        postCondition: { check: "none.readonly" },
      },
      {
        name: "fraud.queue",
        description: "Read cases awaiting investigator review",
        toolId: "read.fraud.getReviewQueue",
        risk: "LOW",
        dataClasses: ["FRAUD"],
        allowedArguments: ["limit"],
        postCondition: { check: "none.readonly" },
      },
      {
        name: "fraud.alerts",
        description: "Read fraud alerts with rule provenance",
        toolId: "read.fraud.getAlerts",
        risk: "LOW",
        dataClasses: ["FRAUD"],
        allowedArguments: ["limit"],
        postCondition: { check: "none.readonly" },
      },
      {
        name: "fraud.evaluateUser",
        description: "Read rule and model risk signals for one user",
        toolId: "read.fraud.evaluateUser",
        risk: "LOW",
        dataClasses: ["FRAUD", "PERSONAL"],
        allowedArguments: ["userId"],
        postCondition: { check: "none.readonly" },
      },
      {
        name: "fraud.highRiskUsers",
        description:
          "Users carrying an elevated stored risk score. A ranked list of SIGNALS — being on it is not a finding.",
        toolId: "read.fraud.getHighRiskUsers",
        risk: "LOW",
        dataClasses: ["FRAUD", "PERSONAL"],
        allowedArguments: ["limit"],
        postCondition: { check: "none.readonly" },
      },
      {
        name: "fraud.decisions",
        description: "Read the investigator decision log — the only authoritative outcome record",
        toolId: "read.fraud.getDecisionLog",
        risk: "LOW",
        dataClasses: ["FRAUD"],
        allowedArguments: ["limit"],
        postCondition: { check: "none.readonly" },
      },
    ],
    bounds: { maxSteps: 8, maxToolCalls: 12, maxElapsedMs: 120_000, maxCostUsd: 0.25, maxTokens: 20_000, maxDepth: 1 },
  },
};

export class AgentRegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentRegistryError";
  }
}

/**
 * Validate every definition against the tool catalog, at import time.
 *
 * Deliberately a throw rather than a logged warning. Each of these conditions describes an agent
 * whose real reach differs from its declared reach, and the only safe response to that is to
 * refuse to run: a warning in a log nobody reads is how a read-only assistant quietly acquires a
 * write. The checks are ordered from "definitely a typo" to "definitely a security defect".
 */
function validateDefinitions(): void {
  const seenNames = new Set<string>();

  for (const def of Object.values(AGENT_DEFINITIONS)) {
    if (def.capabilities.length === 0) {
      throw new AgentRegistryError(`Agent ${def.agentId} declares no capabilities`);
    }

    for (const cap of def.capabilities) {
      const key = `${def.agentId}:${cap.name}`;
      if (seenNames.has(key)) {
        throw new AgentRegistryError(`Agent ${def.agentId} declares capability ${cap.name} twice`);
      }
      seenNames.add(key);

      if (!cap.toolId) {
        // Every capability must resolve to an allowlisted tool. A capability with no tool would
        // be an action with no policy evaluation, no audit row and no idempotency — precisely
        // the ungoverned side channel this architecture exists to make impossible.
        throw new AgentRegistryError(
          `Agent ${def.agentId} capability ${cap.name} resolves to no tool`,
        );
      }

      const tool = getTool(cap.toolId);
      if (!tool) {
        throw new AgentRegistryError(
          `Agent ${def.agentId} capability ${cap.name} names unknown tool ${cap.toolId}`,
        );
      }
      if (tool.status !== "ACTIVE") {
        throw new AgentRegistryError(
          `Agent ${def.agentId} capability ${cap.name} names ${tool.status} tool ${cap.toolId}`,
        );
      }

      // The declared risk must not undersell the tool's own category. A capability marked LOW
      // over a WRITE tool would let a write execute under the low-risk autonomous path.
      const impliedRisk = tool.category === "HIGH_RISK" ? "HIGH" : tool.category === "WRITE" ? "MEDIUM" : "LOW";
      const order = { LOW: 0, MEDIUM: 1, HIGH: 2 } as const;
      if (order[cap.risk] < order[impliedRisk]) {
        throw new AgentRegistryError(
          `Agent ${def.agentId} capability ${cap.name} declares ${cap.risk} for a ${tool.category} tool (minimum ${impliedRisk})`,
        );
      }

      if (def.readOnly && tool.category !== "READ") {
        throw new AgentRegistryError(
          `Read-only agent ${def.agentId} declares side-effecting capability ${cap.name} (${tool.category})`,
        );
      }

      // A HIGH_RISK tool is never an agent capability. High-risk work reaches an agent as an
      // escalation to a human, never as something the agent itself can plan a step for.
      if (tool.category === "HIGH_RISK") {
        throw new AgentRegistryError(
          `Agent ${def.agentId} declares HIGH_RISK capability ${cap.name}; high-risk actions must be escalated, never planned`,
        );
      }

      if (tool.category !== "READ" && !cap.postCondition) {
        throw new AgentRegistryError(
          `Agent ${def.agentId} capability ${cap.name} has a side effect but declares no post-condition`,
        );
      }

      // The agent's declared data classes must cover the capability's. Otherwise the declaration
      // is decorative and an operator reading it is misled about what the agent can see.
      for (const dc of cap.dataClasses) {
        if (!def.dataClasses.includes(dc)) {
          throw new AgentRegistryError(
            `Agent ${def.agentId} capability ${cap.name} touches ${dc} which the agent does not declare`,
          );
        }
      }
    }
  }
}

let validated = false;

/** Idempotent. Called at boot and defensively from every registry read. */
export function initAgentRegistry(): void {
  if (validated) return;
  validateDefinitions();
  validated = true;
}

export function getAgentDefinition(agentId: AgentId): AgentDefinition {
  initAgentRegistry();
  return AGENT_DEFINITIONS[agentId];
}

export function listAgentDefinitions(): AgentDefinition[] {
  initAgentRegistry();
  return Object.values(AGENT_DEFINITIONS);
}

export function getCapability(agentId: AgentId, name: string): AgentCapability | undefined {
  initAgentRegistry();
  return AGENT_DEFINITIONS[agentId].capabilities.find((c) => c.name === name);
}

/**
 * The toolset identity recorded on every run.
 *
 * Derived from the agent's capability→tool bindings, so a change to what an agent can reach
 * changes the version stamped on future runs. A hand-maintained constant is one somebody
 * forgets to bump, and a version that silently stops moving asserts a stability that is not
 * there.
 */
export function toolsetVersion(agentId: AgentId): string {
  initAgentRegistry();
  const def = AGENT_DEFINITIONS[agentId];
  const material = def.capabilities
    .map((c) => `${c.name}=${c.toolId}:${c.risk}`)
    .sort()
    .join("|");
  let h = 0;
  for (let i = 0; i < material.length; i += 1) h = (Math.imul(31, h) + material.charCodeAt(i)) | 0;
  return `tools.v${def.capabilities.length}.${(h >>> 0).toString(16).padStart(8, "0")}`;
}

/**
 * The execution-time re-check of the allowlist.
 *
 * Plan validation already rejects an unknown capability, so in the normal path this can never
 * fail. It exists for the abnormal one: any future caller that reaches execution without going
 * through the validator — a recovery path, a replay, a test harness, a refactor — still cannot
 * run a capability the agent does not own.
 */
export function assertCapabilityAllowed(agentId: AgentId, capabilityName: string): AgentCapability {
  const cap = getCapability(agentId, capabilityName);
  if (!cap) {
    throw new AgentRegistryError(
      `Capability ${capabilityName} is not granted to agent ${agentId}`,
    );
  }
  return cap;
}

/** Platform ceiling applied over the agent's own bounds; the tighter of the two always wins. */
export function effectiveBounds(agentId: AgentId): AgentDefinition["bounds"] {
  const own = getAgentDefinition(agentId).bounds;
  const ceiling = agentsConfig.bounds;
  return {
    maxSteps: Math.min(own.maxSteps, ceiling.maxSteps),
    maxToolCalls: Math.min(own.maxToolCalls, ceiling.maxToolCalls),
    maxElapsedMs: Math.min(own.maxElapsedMs, ceiling.maxElapsedMs),
    maxCostUsd: Math.min(own.maxCostUsd, ceiling.maxCostUsd),
    maxTokens: Math.min(own.maxTokens, ceiling.maxTokens),
    maxDepth: Math.min(own.maxDepth, ceiling.maxDepth),
  };
}
