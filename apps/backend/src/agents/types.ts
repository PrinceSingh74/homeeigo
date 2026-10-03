import type {
  AgentRiskTier,
  AgentRunMode,
  AgentRunStatus,
  AgentStepStatus,
  AiGatewayRole,
  AiToolPolicyDecision,
} from "@prisma/client";

/**
 * The five Phase-16 agents. A closed union, deliberately: an agent id is an authorisation
 * subject, so the set of them has to be knowable at compile time rather than assembled from
 * configuration a caller could extend.
 */
export const AGENT_IDS = [
  "support",
  "operations",
  "partner-operations",
  "finance",
  "fraud",
] as const;

export type AgentId = (typeof AGENT_IDS)[number];

export function isAgentId(value: unknown): value is AgentId {
  return typeof value === "string" && (AGENT_IDS as readonly string[]).includes(value);
}

/**
 * Data classes an agent may be granted. Enforced at capability level, so an agent cannot
 * reach a class of data by aggregating context rather than by calling a tool.
 */
export const DATA_CLASSES = [
  "PUBLIC",
  "INTERNAL",
  "SENSITIVE",
  "PERSONAL",
  "FINANCIAL",
  "FRAUD",
  "HIGH_RISK",
] as const;

export type DataClass = (typeof DATA_CLASSES)[number];

/**
 * What an agent is allowed to do, named in the agent's own vocabulary.
 *
 * A capability is the unit the model plans against; the tool id it resolves to is never shown
 * to the model and never accepted from it. That indirection is what makes cross-agent tool
 * reach impossible to express: the Support Agent's plan cannot name a finance tool because
 * finance capabilities are not in its vocabulary at all, and a plan naming an unknown
 * capability is rejected before any tool lookup happens.
 */
export type AgentCapability = {
  /** Agent-facing name, e.g. "ticket.classify". Stable; part of the agent's contract. */
  name: string;
  description: string;
  /** The allowlisted Phase-5 tool this resolves to. Absent for pure-analysis capabilities. */
  toolId?: string;
  /**
   * Deterministic risk tier for this capability, independent of what the model claims.
   *
   * The model's own `risk` field in a plan is advisory only and is never used to authorise;
   * this value is. A model that under-reports risk changes nothing.
   */
  risk: AgentRiskTier;
  dataClasses: DataClass[];
  /**
   * Argument names the agent may supply. Anything outside this list is a rejected plan, not a
   * dropped field — a silently dropped argument turns a specific action into a broader one.
   */
  allowedArguments: string[];
  /**
   * What must be observably true after this capability runs, for a write to count as done.
   * Required for every capability that has a side effect; the registry refuses to load
   * otherwise.
   */
  postCondition?: PostConditionSpec;
  /**
   * How old this capability's result may be before it stops counting as evidence.
   *
   * Absent means the result does not age in a way that could mislead — a knowledge citation, an
   * append-only decision log. Present means the runtime checks the age of what came back and
   * refuses to let a stale or undateable read justify a write later in the same run.
   */
  freshness?: FreshnessPolicy;
};

export type FreshnessPolicy = {
  /** Maximum age of the underlying data, in milliseconds. */
  maxAgeMs: number;
};

/**
 * A post-condition is a named check the runtime knows how to perform, not a predicate the
 * model supplies. A model-authored assertion would be marking its own homework.
 */
export type PostConditionSpec = {
  check:
    | "ticket.status.changed"
    | "ticket.priority.escalated"
    | "ticket.exists"
    | "notification.delivered"
    | "none.readonly";
  /** Which planned argument identifies the entity to re-read. */
  subjectArgument?: string;
  /** Expected value where the check compares one. */
  expected?: string;
};

export type AgentDefinition = {
  agentId: AgentId;
  name: string;
  description: string;
  /** Frozen onto every run. Bump when capabilities, prompt or policy change. */
  version: string;
  promptVersion: string;
  /** The gateway role runs of this agent execute as. Tool RBAC is enforced against it. */
  actorRole: AiGatewayRole;
  /** Feature flag key. Missing flag means disabled — never enabled-by-default. */
  flagKey: string;
  /**
   * The maximum tier this agent may EXECUTE autonomously, whatever a plan proposes.
   *
   * Finance and fraud sit at LOW and additionally carry `readOnly`, so no configuration
   * mistake can promote them into money movement or enforcement.
   */
  maxAutonomousRisk: AgentRiskTier;
  /**
   * Hard prohibition on side effects. Independent of capabilities, so that adding a write
   * capability to a read-only agent fails loudly at registry load instead of quietly working.
   */
  readOnly: boolean;
  dataClasses: DataClass[];
  capabilities: AgentCapability[];
  bounds: AgentBounds;
};

export type AgentBounds = {
  maxSteps: number;
  maxToolCalls: number;
  maxElapsedMs: number;
  maxCostUsd: number;
  maxTokens: number;
  /** How deep a causation chain may go before a run is refused outright. */
  maxDepth: number;
};

/** A step the model proposed. Structure is validated before anything is looked up. */
export type ProposedStep = {
  capability: string;
  arguments: Record<string, unknown>;
  /** Why this step, in the agent's own words. Recorded for operators; never authoritative. */
  reason: string;
  expectedEffect: string;
};

/** The typed plan an agent must produce. Raw model text is never executed. */
export type ProposedPlan = {
  goal: string;
  reason: string;
  steps: ProposedStep[];
  /** The model's own risk read. Advisory. The runtime classifies independently. */
  claimedRisk?: string;
};

export type ValidatedStep = ProposedStep & {
  capability: string;
  resolved: AgentCapability;
  /** Server-classified. Never the model's claim. */
  risk: AgentRiskTier;
};

export type ValidatedPlan = {
  goal: string;
  reason: string;
  steps: ValidatedStep[];
  /** Highest step risk. Drives the execution mode for the run. */
  riskTier: AgentRiskTier;
  planHash: string;
};

export type PlanRejection = {
  ok: false;
  code:
    | "PLAN_MALFORMED"
    | "PLAN_TOO_LONG"
    | "UNKNOWN_CAPABILITY"
    | "UNKNOWN_ARGUMENT"
    | "CAPABILITY_NOT_AUTHORIZED"
    | "READ_ONLY_VIOLATION"
    | "MISSING_POST_CONDITION"
    /** The request asked for information; the plan proposed a change. §8. */
    | "INTENT_FORBIDS_SIDE_EFFECT"
    /** The request asked for a decision reserved to a person. §8. */
    | "INTENT_HUMAN_ONLY";
  reason: string;
};

/**
 * A specific, answerable question, asked because the request was underspecified.
 *
 * §9: when a request is underspecified, do not guess — ask for the MINIMUM clarification. So
 * this names the one missing field rather than restating the whole request, and it carries the
 * capability it belongs to so the operator can see which part of the plan is blocked.
 */
export type ClarificationQuestion = {
  capability: string;
  /** The argument that could not be supplied. */
  field: string;
  question: string;
};

export type PlanClarification = {
  ok: false;
  code: "NEEDS_CLARIFICATION";
  reason: string;
  questions: ClarificationQuestion[];
};

export type PlanValidation =
  | { ok: true; plan: ValidatedPlan }
  | PlanRejection
  | PlanClarification;

export type AgentTrigger = {
  type: "MANUAL" | "EVENT" | "SCHEDULE";
  /** Event id, job id or request id. Part of the run's idempotency identity. */
  ref?: string;
  subjectType?: string;
  subjectId?: string;
  causationId?: string;
  parentRunId?: string;
  depth?: number;
};

export type AgentRunRequest = {
  agentId: AgentId;
  goal: string;
  /** Untrusted context — a ticket body, an alert payload. Never treated as instructions. */
  input: string;
  actor: {
    actorId: string;
    actorRole: AiGatewayRole;
    userRole?: string;
    ipAddress?: string;
    traceId?: string;
  };
  trigger: AgentTrigger;
  /** Forces shadow even when the agent is live. Live mode additionally requires the flag. */
  forceShadow?: boolean;
  /**
   * The intent, when the CALL SITE knows it rather than having to infer it from prose.
   *
   * Set by surfaces where the user picked an action rather than typed a sentence — a command
   * palette entry, an event trigger definition. Never populated from model output: the intent
   * decides whether a side effect may happen at all, so a model that could declare it could
   * authorise itself. An unrecognised value falls through to classification rather than being
   * honoured, so a typo cannot widen what a run may do.
   */
  declaredIntent?: string;
};

export type AgentStepRecord = {
  stepIndex: number;
  phase: "PLAN" | "POLICY" | "EXECUTE" | "VERIFY" | "ESCALATE";
  capability?: string;
  toolId?: string;
  risk?: AgentRiskTier;
  status: AgentStepStatus;
  policyDecision?: AiToolPolicyDecision;
  executionId?: string;
  approvalId?: string;
  verification?: Record<string, unknown>;
  errorCode?: string;
  errorMessage?: string;
  durationMs?: number;
};

export type AgentRunResult = {
  runId: string;
  agentId: AgentId;
  agentVersion: string;
  mode: AgentRunMode;
  status: AgentRunStatus;
  riskTier?: AgentRiskTier;
  goal: string;
  /** Operator-facing summary. Structured rationale, never hidden reasoning. */
  summary: string;
  steps: AgentStepRecord[];
  approvals: string[];
  stopReason?: string;
  escalationReason?: string;
  errorCode?: string;
  costUsd: number;
  latencyMs: number;
  /**
   * What the platform decided the request was asking for, and how it decided.
   *
   * Returned so a caller can show the operator why a step was narrowed. Without it, a refused
   * write reaches the screen as a bare "step not run", and the person cannot tell whether the
   * system understood them and declined, or simply did not understand them at all — which are
   * completely different problems with completely different fixes.
   */
  intent?: { intent: string; source: string; evidence: string; permitsSideEffect: boolean };
  /** Present only when the run stopped to ask. §9. */
  clarifications?: ClarificationQuestion[];
};

export type { AgentRiskTier, AgentRunMode, AgentRunStatus, AgentStepStatus };
