import { logger } from "../lib/logger";
import { agentsConfig, executionEnvironmentAllowed, AGENT_FLAGS } from "./config";
import { evaluateFlag } from "../services/feature-flag.service";
import {
  AGENT_DEFINITIONS,
  effectiveBounds,
  getAgentDefinition,
  initAgentRegistry,
  listAgentDefinitions,
  toolsetVersion,
} from "./registry/agent-registry";
import { initAgentMetricsAtZero, setAgentEnabledGauge } from "./observability/agent-metrics";
import { registerAgentJobs } from "./runtime/agent-jobs";
import { AGENT_IDS } from "./types";
import type { AgentId } from "./types";

export { runAgent } from "./runtime/agent-runtime";
export { AGENT_IDS, isAgentId } from "./types";
export type { AgentId, AgentRunRequest, AgentRunResult } from "./types";
export { getAgentDefinition, listAgentDefinitions } from "./registry/agent-registry";
export { getRun, findOrphanedRuns } from "./runtime/run-store";
export { agentsConfig } from "./config";
export { getAgentHealth, getDependencyHealth } from "./observability/agent-health";
export type { AgentHealth, AgentOperationalState, DependencyHealth } from "./observability/agent-health";
export { registerAgentJobs, ensureRecoverySweepScheduled, AGENT_SCHEDULED_RUN_JOB, AGENT_RECOVERY_JOB } from "./runtime/agent-jobs";
export { AGENT_TRIGGERS, UNWIRED_TRIGGERS } from "./triggers/agent-trigger-registry";

/**
 * Boot the agent layer.
 *
 * Validation runs unconditionally, even when `AGENTS_ENABLED` is false. A definition defect —
 * a read-only agent that declares a write, a capability naming a tool that no longer exists —
 * must surface on every deploy, not on the first deploy where somebody happens to switch the
 * feature on. Discovering it at enable time means discovering it under pressure.
 */
export function initAgents(): void {
  initAgentRegistry();
  initAgentMetricsAtZero([...AGENT_IDS]);
  // Registered unconditionally, like the registry validation above. A scheduled job whose handler
  // is missing gets dead-lettered by the processor, so registering only when the feature is on
  // would turn a disabled agent layer into a pile of failing jobs.
  registerAgentJobs();

  const env = executionEnvironmentAllowed();
  logger.info("agents_initialized", {
    category: "APPLICATION",
    enabled: agentsConfig.enabled,
    killSwitch: agentsConfig.killSwitch,
    executionEnvironment: env.allowed ? env.reason : `blocked:${env.reason}`,
    agents: listAgentDefinitions().map((d) => ({
      agentId: d.agentId,
      version: d.version,
      toolset: toolsetVersion(d.agentId),
      readOnly: d.readOnly,
      capabilities: d.capabilities.length,
      maxAutonomousRisk: d.maxAutonomousRisk,
    })),
  });
}

export type AgentStatus = {
  agentId: AgentId;
  name: string;
  description: string;
  version: string;
  promptVersion: string;
  toolsetVersion: string;
  readOnly: boolean;
  maxAutonomousRisk: string;
  actorRole: string;
  flagKey: string;
  /** The mode a run started right now would get, and why. Never a guess. */
  effectiveMode: "LIVE" | "SHADOW" | "REFUSED";
  modeReason: string;
  capabilities: Array<{ name: string; description: string; risk: string; dataClasses: string[] }>;
  bounds: ReturnType<typeof effectiveBounds>;
  dataClasses: string[];
};

/**
 * What each agent would actually do if triggered now.
 *
 * Deliberately computes the *effective* mode rather than reporting the flag value, because the
 * flag is only one of four things that decide it. A control screen that showed "enabled" while
 * the kill switch was engaged, or while the environment forbade execution, would be telling an
 * operator something untrue about their own platform at exactly the moment it matters.
 */
export async function getAgentStatuses(): Promise<AgentStatus[]> {
  initAgentRegistry();
  const env = executionEnvironmentAllowed();

  return Promise.all(
    listAgentDefinitions().map(async (def) => {
      let effectiveMode: AgentStatus["effectiveMode"];
      let modeReason: string;

      if (!agentsConfig.enabled) {
        effectiveMode = "REFUSED";
        modeReason = "AGENTS_DISABLED";
      } else if (agentsConfig.killSwitch) {
        effectiveMode = "REFUSED";
        modeReason = "KILL_SWITCH";
      } else if (!env.allowed) {
        effectiveMode = "SHADOW";
        modeReason = `ENV:${env.reason}`;
      } else {
        const flag = await evaluateFlag(def.flagKey, def.agentId).catch(() => ({
          enabled: false,
          reason: "LOOKUP_FAILED" as const,
        }));
        effectiveMode = flag.enabled ? "LIVE" : "SHADOW";
        modeReason = `FLAG:${flag.reason}`;
      }

      setAgentEnabledGauge(def.agentId, effectiveMode === "LIVE");

      return {
        agentId: def.agentId,
        name: def.name,
        description: def.description,
        version: def.version,
        promptVersion: def.promptVersion,
        toolsetVersion: toolsetVersion(def.agentId),
        readOnly: def.readOnly,
        maxAutonomousRisk: def.maxAutonomousRisk,
        actorRole: def.actorRole,
        flagKey: def.flagKey,
        effectiveMode,
        modeReason,
        capabilities: def.capabilities.map((c) => ({
          name: c.name,
          description: c.description,
          risk: c.risk,
          dataClasses: c.dataClasses,
        })),
        bounds: effectiveBounds(def.agentId),
        dataClasses: def.dataClasses,
      };
    }),
  );
}

// Readiness lives in ./readiness (leaf) so observability/agent-health can import it without
// importing this module back — that was an import cycle.
export { checkAgentReadiness } from "./readiness";

export { AGENT_DEFINITIONS, AGENT_FLAGS, getAgentDefinition as agentDefinition };
