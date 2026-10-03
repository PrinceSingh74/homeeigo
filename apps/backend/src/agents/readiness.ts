import { agentsConfig } from "./config";
import { initAgentRegistry, listAgentDefinitions } from "./registry/agent-registry";

/**
 * Agent readiness = "every tool an agent declares actually exists in the tool registry".
 *
 * Lives in its own leaf module so that observability/agent-health.ts can ask the question without
 * importing agents/index.ts — which imports agent-health back. That pair was an import cycle that
 * only worked because agent-health reached for `../index` through a dynamic import.
 *
 * On a fresh staging database the agents reported LIVE, planned correctly, and could not execute
 * anything because the registry had never been seeded. It fails closed, which is the right
 * direction, but "silently broken" and "correctly refusing" must not look the same to an operator.
 * §73: health is not "the process is alive".
 */
export async function checkAgentReadiness(): Promise<{
  ready: boolean;
  reasons: string[];
  registrySeeded: boolean;
  missingTools: string[];
}> {
  initAgentRegistry();
  const reasons: string[] = [];

  const required = new Set<string>();
  for (const def of listAgentDefinitions()) {
    for (const cap of def.capabilities) if (cap.toolId) required.add(cap.toolId);
  }

  const { default: prisma } = await import("../lib/prisma");
  const present = await prisma.aiToolRegistry
    .findMany({ where: { toolId: { in: [...required] } }, select: { toolId: true } })
    .catch(() => null);

  if (present === null) {
    return {
      ready: false,
      reasons: ["TOOL_REGISTRY_UNREADABLE"],
      registrySeeded: false,
      missingTools: [...required],
    };
  }

  const have = new Set(present.map((r) => r.toolId));
  const missingTools = [...required].filter((t) => !have.has(t));
  if (missingTools.length > 0) reasons.push(`TOOL_REGISTRY_INCOMPLETE:${missingTools.length}`);
  if (!agentsConfig.enabled) reasons.push("AGENTS_DISABLED");
  if (agentsConfig.killSwitch) reasons.push("KILL_SWITCH");

  return {
    ready: missingTools.length === 0,
    reasons,
    registrySeeded: missingTools.length === 0,
    missingTools,
  };
}
