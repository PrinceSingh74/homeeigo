export { aiToolsConfig } from "./config";
export type {
  ToolDefinition,
  ToolExecuteInput,
  ToolExecuteResult,
  ToolActorContext,
  ToolMetricsSummary,
} from "./types";

export {
  initToolRegistry,
  getTool,
  listTools,
  getToolDefinition,
  seedToolRegistry,
  listRegistryFromDb,
  getRegistryToolFromDb,
} from "./registry/tool-registry";

export { TOOL_CATALOG, TOOL_CATEGORIES, countToolsByCategory } from "./registry/tool-catalog";

export { evaluatePolicy, listPolicyLogs, getPolicyExplorerSummary } from "./policy/policy-engine";
export { POLICY_RULES, getRoleToolPermissions } from "./policy/policy-rules";

export {
  createApprovalRequest,
  decideApproval,
  listPendingApprovals,
  listHighRiskQueue,
  cancelApproval,
  expireStaleApprovals,
  getApprovalById,
  getApprovalStatistics,
} from "./approval/approval-engine";

export {
  executeTool,
  getCircuitBreakerStates,
  getToolMetricsSummary,
  ToolExecutionError,
} from "./execution/execution-engine";

export {
  getExecutionHistory,
  getDeniedExecutions,
  hashArguments,
} from "./audit/tool-audit.service";

export { validateToolArguments, sanitizeToolId, redactArguments } from "./security/tool-security";
