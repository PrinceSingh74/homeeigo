import { apiRequest } from "@/lib/api-client";
import type { ApiResponse } from "@/types/admin";

/**
 * Phase 16 agent control surface.
 *
 * Read-and-run only. There is deliberately no client for approving an approval, changing an agent
 * definition, or forcing a live run: approvals are decided through the existing AI-tools surface
 * which already carries the non-self-approval and single-consume rules, and live execution is
 * decided by the environment allowlist plus the feature flag on the server. A client that could
 * override either would be a bypass of both dressed up as a button.
 */

export type AgentCapability = {
  name: string;
  description: string;
  risk: "LOW" | "MEDIUM" | "HIGH";
  dataClasses: string[];
};

export type AgentBounds = {
  maxSteps: number;
  maxToolCalls: number;
  maxElapsedMs: number;
  maxCostUsd: number;
  maxTokens: number;
  maxDepth: number;
};

export type AgentStatus = {
  agentId: string;
  name: string;
  description: string;
  version: string;
  promptVersion: string;
  toolsetVersion: string;
  readOnly: boolean;
  maxAutonomousRisk: string;
  actorRole: string;
  flagKey: string;
  /** What a run started right now would actually do — not merely what the flag says. */
  effectiveMode: "LIVE" | "SHADOW" | "REFUSED";
  modeReason: string;
  capabilities: AgentCapability[];
  bounds: AgentBounds;
  dataClasses: string[];
};

export type AgentReadiness = {
  ready: boolean;
  reasons: string[];
  registrySeeded: boolean;
  missingTools: string[];
};

/**
 * The ten operational states the control centre renders.
 *
 * Computed on the server from real signals — a flag row, a readiness probe, a run count, a failure
 * ratio — and ordered there by severity, so the client never has to decide which of several true
 * conditions matters most. That decision belongs next to the data.
 */
export type AgentOperationalState =
  | "OFF"
  | "SHADOW"
  | "READY"
  | "RUNNING"
  | "WAITING_APPROVAL"
  | "DEGRADED"
  | "BLOCKED"
  | "ERROR"
  | "CONTROLLED"
  | "LIVE";

export type AgentHealth = {
  agentId: string;
  state: AgentOperationalState;
  stateReason: string;
  executionMode: "LIVE" | "SHADOW" | "REFUSED";
  rolloutPct: number | null;
  metrics: {
    windowHours: number;
    runs: number | null;
    completed: number | null;
    failed: number | null;
    escalated: number | null;
    inFlight: number;
    verificationFailures: number | null;
    /** null means INSUFFICIENT DATA — never render it as 0%. */
    successRate: number | null;
    avgLatencyMs: number | null;
    p95LatencyMs: number | null;
    costUsd: number | null;
    lastRunAt: string | null;
  };
  pendingApprovals: number;
};

export type DependencyHealth = {
  name: string;
  /** UNKNOWN is a real answer — a probe that could not run must never report OK. */
  status: "OK" | "DEGRADED" | "DOWN" | "UNKNOWN";
  detail: string;
};

export type AgentOverview = {
  agents: AgentStatus[];
  health: AgentHealth[];
  dependencies: DependencyHealth[];
  readiness: AgentReadiness;
  config: { enabled: boolean; killSwitch: boolean; executionEnvironments: string[] };
};

export type AgentRunSummary = {
  runId: string;
  agentId: string;
  agentVersion: string;
  mode: "LIVE" | "SHADOW";
  status: string;
  riskTier: string | null;
  goal: string;
  triggerType: string;
  subjectType: string | null;
  subjectId: string | null;
  stepCount: number;
  toolCallCount: number;
  costUsd: number;
  latencyMs: number | null;
  stopReason: string | null;
  escalationReason: string | null;
  errorCode: string | null;
  createdAt: string;
  completedAt: string | null;
};

/**
 * What the platform decided the request was asking for.
 *
 * `source` matters as much as `intent`: DEFAULTED means the wording was not recognised and the
 * safest read-only reading was applied, which is a different situation from a request the system
 * understood and declined to act on.
 */
export type ResolvedIntent = {
  intent: string;
  source: "DECLARED" | "CLASSIFIED" | "DEFAULTED";
  evidence: string;
  permitsSideEffect: boolean;
};

export type ClarificationQuestion = {
  capability: string;
  field: string;
  question: string;
};

/**
 * The result of starting a run.
 *
 * Distinct from `AgentRunSummary`, which is the shape the LIST endpoint returns from persisted
 * columns. This one is what the runtime hands back directly and carries two things the list rows
 * do not: the resolved intent, and any question the run stopped to ask.
 */
export type AgentRunResult = {
  runId: string;
  agentId: string;
  agentVersion: string;
  mode: "LIVE" | "SHADOW";
  status: string;
  riskTier: string | null;
  goal: string;
  summary: string;
  approvals: string[];
  stopReason?: string | null;
  escalationReason?: string | null;
  errorCode?: string | null;
  costUsd: number;
  latencyMs: number;
  intent?: ResolvedIntent;
  clarifications?: ClarificationQuestion[];
};

export type AgentRunStep = {
  stepIndex: number;
  phase: string;
  capability: string | null;
  toolId: string | null;
  riskTier: string | null;
  policyDecision: string | null;
  status: string;
  executionId: string | null;
  approvalId: string | null;
  verification: Record<string, unknown> | null;
  argumentsPreview: Record<string, unknown> | null;
  errorCode: string | null;
  errorMessage: string | null;
  durationMs: number | null;
  createdAt: string;
};

export type AgentRunDetail = {
  run: AgentRunSummary & {
    plan: Record<string, unknown> | null;
    planHash: string | null;
    policyVersion: string | null;
    toolsetVersion: string | null;
    modelProvider: string | null;
    modelName: string | null;
    traceId: string;
    causationId: string | null;
    parentRunId: string | null;
    depth: number;
    promptTokens: number;
    completionTokens: number;
    steps: AgentRunStep[];
  };
  /** The authoritative tool-layer rows behind the steps, so the agent's copy is checkable. */
  executions: Array<{
    executionId: string;
    toolId: string;
    status: string;
    policyDecision: string;
    errorCode: string | null;
    durationMs: number | null;
    approvalId: string | null;
    startedAt: string;
  }>;
};

export type AgentOrphans = {
  leaseMs: number;
  count: number;
  orphans: Array<{
    runId: string;
    agentId: string;
    status: string;
    mode: string;
    heartbeatAt: string | null;
    lastStep: AgentRunStep | null;
  }>;
};

export const agentsApi = {
  overview: () =>
    apiRequest<ApiResponse<AgentOverview>>("/api/agents", { auth: true }).then((r) => r.data!),

  runs: (params: { agentId?: string; status?: string; limit?: number } = {}) =>
    apiRequest<ApiResponse<{ runs: AgentRunSummary[] }>>("/api/agents/runs", {
      auth: true,
      query: {
        agentId: params.agentId,
        status: params.status,
        limit: params.limit ? String(params.limit) : undefined,
      },
    }).then((r) => r.data!.runs),

  run: (runId: string) =>
    apiRequest<ApiResponse<AgentRunDetail>>(`/api/agents/runs/${runId}`, { auth: true }).then(
      (r) => r.data!,
    ),

  orphans: () =>
    apiRequest<ApiResponse<AgentOrphans>>("/api/agents/recovery/orphans", { auth: true }).then(
      (r) => r.data!,
    ),

  startRun: (
    agentId: string,
    // `intent` is DECLARED, not asserted. The server still resolves what it means and still
    // refuses a side effect this agent may not perform, so sending it can only narrow a run.
    body: { goal: string; input?: string; mode?: "shadow"; intent?: string },
  ) =>
    apiRequest<ApiResponse<AgentRunResult>>(`/api/agents/${agentId}/run`, {
      auth: true,
      method: "POST",
      body,
    }).then((r) => r.data!),
};
