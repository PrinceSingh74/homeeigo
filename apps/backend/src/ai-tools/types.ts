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
};

export type PolicyEvaluationInput = {
  tool: ToolDefinition;
  actor: ToolActorContext;
  arguments: Record<string, unknown>;
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
