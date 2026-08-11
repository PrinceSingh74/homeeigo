import type {
  AiGatewayRole,
  AiToolApprovalMode,
  AiToolApprovalStatus,
  AiToolCategory,
  AiToolExecutionStatus,
  AiToolPolicyDecision,
  AiToolRiskLevel,
  AiToolStatus,
} from "@prisma/client";

export type ToolParameterDef = {
  name: string;
  type: "string" | "number" | "boolean" | "object" | "array";
  required: boolean;
  description: string;
};

export type ToolDefinition = {
  toolId: string;
  name: string;
  description: string;
  category: AiToolCategory;
  version: string;
  requiredPermission: string;
  requiredRole: string;
  requiredPolicy: string;
  riskLevel: AiToolRiskLevel;
  parameters: ToolParameterDef[];
  validationSchema: Record<string, unknown>;
  timeoutMs: number;
  maxRetries: number;
  auditRequired: boolean;
  approvalRequired: boolean;
  serviceMapping: string;
  eventMapping?: string;
  metricsKey?: string;
  costEstimateUsd: number;
  owner: string;
  status: AiToolStatus;
};

export type ToolActorContext = {
  actorId: string;
  actorRole: AiGatewayRole;
  userRole?: string;
  ipAddress?: string;
  traceId?: string;
  correlationId?: string;
};

export type ToolExecuteInput = {
  toolId: string;
  arguments: Record<string, unknown>;
  actor: ToolActorContext;
  idempotencyKey?: string;
  approvalId?: string;
  /**
   * The acting user has seen the consequences and agreed.
   *
   * Set by the surface after showing price, time and any fee — never by the model, and
   * never inferred from conversational text like "yes". Absent means not confirmed.
   */
  confirmed?: boolean;
};

export type ToolExecuteResult = {
  executionId: string;
  status: AiToolExecutionStatus;
  policyDecision: AiToolPolicyDecision;
  result?: unknown;
  errorCode?: string;
  errorMessage?: string;
  durationMs: number;
  approvalId?: string;
  requiresApproval?: boolean;
  /** Set when the action is understood but awaits the user's explicit consent. */
  requiresConfirmation?: boolean;
  /** What the user must be shown before confirming. Never model-authored. */
  confirmationPrompt?: string;
};

export type PolicyEvaluationInput = {
  tool: ToolDefinition;
  actor: ToolActorContext;
  arguments: Record<string, unknown>;
  /** Whether the acting user has already confirmed this exact action. */
  confirmed?: boolean;
};

export type PolicyEvaluationResult = {
  decision: AiToolPolicyDecision;
  reason?: string;
  ruleMatched?: string;
  riskScore?: number;
};

export type ApprovalRequestInput = {
  toolId: string;
  requestedBy: string;
  requestedRole: AiGatewayRole;
  argumentsHash: string;
  riskScore: number;
  approvalMode?: AiToolApprovalMode;
  requiredApprovers?: number;
  metadata?: Record<string, unknown>;
  /** Redacted arguments for human review. Never consulted when validating an approval. */
  argumentsPreview?: Record<string, unknown>;
  /** Human-readable target, e.g. a booking id, so the approver sees what is affected. */
  resourceRef?: string;
};

export type ApprovalDecisionInput = {
  approvalId: string;
  approverId: string;
  decision: "APPROVED" | "REJECTED";
  reason?: string;
};

export type ToolHandlerContext = {
  actor: ToolActorContext;
  arguments: Record<string, unknown>;
  /** This execution's id. Present on every call; joins the handler to the tool audit row. */
  executionId: string;
  /** The approval that authorised this call, when one was required. */
  approvalId?: string;
  /**
   * Server-derived idempotency key the handler MUST pass to the business service.
   *
   * Derived, never taken from the caller, and never invented by the handler. Two problems
   * it solves at once:
   *
   * 1. A handler left to build its own key from the arguments would collide across two
   *    *separately approved* actions that happen to look identical — a second refund for
   *    the same booking and amount would silently replay the first, so a human approval
   *    would quietly do nothing.
   * 2. The key embeds the approval or execution id, so the resulting financial record
   *    (refundRequest, journal entry) can be joined back to the AI action that caused it.
   *    Without that, "which approved action moved this money" is unanswerable after an
   *    incident.
   */
  idempotencyKey: string;
};

export type ToolHandler = (ctx: ToolHandlerContext) => Promise<unknown>;

export type ToolRegistryEntry = ToolDefinition & {
  handler?: ToolHandler;
};

export type ToolMetricsSummary = {
  totalRequests: number;
  successCount: number;
  failureCount: number;
  deniedCount: number;
  approvalRequiredCount: number;
  avgLatencyMs: number;
  totalCostUsd: number;
};

export type { AiToolApprovalStatus, AiToolExecutionStatus, AiToolPolicyDecision };
