import type { AgentId } from "./types";

/**
 * Phase 16 agent runtime configuration.
 *
 * Every switch here fails closed. `AGENTS_ENABLED` defaults to false because an agent layer
 * that arrives switched on has skipped the review it exists to gate, and because this module
 * is imported by the route layer at boot — a default-on flag would make deploying the code
 * and enabling the capability the same act.
 */
export const agentsConfig = {
  get enabled(): boolean {
    return process.env.AGENTS_ENABLED === "true";
  },

  /**
   * Live execution requires an explicit production-grade environment name.
   *
   * An allowlist, never a deny-list: an unrecognised `APP_ENV` (a typo, a new environment
   * nobody has reviewed) must land on "not permitted", which a deny-list gets backwards.
   */
  get executionEnvironments(): string[] {
    const raw = process.env.AGENT_EXECUTION_ENVIRONMENTS ?? "production,staging";
    return raw.split(",").map((s) => s.trim()).filter(Boolean);
  },

  /** Global kill switch. When true no NEW run may execute; shadow planning still works. */
  get killSwitch(): boolean {
    return process.env.AGENTS_KILL_SWITCH === "true";
  },

  /**
   * Default bounds. A definition may tighten these; the runtime clamps to the smaller of the
   * two, so raising a per-agent bound above the platform ceiling cannot widen it.
   */
  bounds: {
    maxSteps: Number(process.env.AGENT_MAX_STEPS ?? 8),
    maxToolCalls: Number(process.env.AGENT_MAX_TOOL_CALLS ?? 12),
    maxElapsedMs: Number(process.env.AGENT_MAX_ELAPSED_MS ?? 120_000),
    maxCostUsd: Number(process.env.AGENT_MAX_COST_USD ?? 0.5),
    maxTokens: Number(process.env.AGENT_MAX_TOKENS ?? 24_000),
    maxDepth: Number(process.env.AGENT_MAX_DEPTH ?? 2),
  },

  /** Runs started per agent per minute, across the process. Stops event and retry storms. */
  rateLimitPerMinute: Number(process.env.AGENT_RATE_LIMIT_PER_MINUTE ?? 20),

  /** How long a run may hold its lease before another process may recover it. */
  leaseMs: Number(process.env.AGENT_LEASE_MS ?? 180_000),

  /** Planning timeout. Separate from the run budget so a hung provider cannot consume it. */
  planTimeoutMs: Number(process.env.AGENT_PLAN_TIMEOUT_MS ?? 25_000),
} as const;

/**
 * One flag per agent, and the flag key is derived rather than free-form so a typo produces a
 * missing flag — which evaluates to disabled — instead of silently matching nothing.
 */
export const AGENT_FLAGS: Record<AgentId, string> = {
  support: "PHASE16_SUPPORT_AGENT",
  operations: "PHASE16_OPERATIONS_AGENT",
  "partner-operations": "PHASE16_PARTNER_OPERATIONS_AGENT",
  finance: "PHASE16_FINANCE_ASSISTANT",
  fraud: "PHASE16_FRAUD_INVESTIGATION_ASSISTANT",
};

/**
 * Is this environment permitted to execute agent side effects at all?
 *
 * Read at call time, not at module load: an environment can drift underneath a long-lived
 * process, and a verdict cached at boot would outlive the condition it described.
 */
export function executionEnvironmentAllowed(): { allowed: boolean; reason: string } {
  const env = process.env.APP_ENV ?? process.env.NODE_ENV ?? "";
  if (!env) return { allowed: false, reason: "APP_ENV_UNSET" };
  if (!agentsConfig.executionEnvironments.includes(env)) {
    return { allowed: false, reason: `ENV_NOT_PERMITTED:${env}` };
  }
  return { allowed: true, reason: env };
}
