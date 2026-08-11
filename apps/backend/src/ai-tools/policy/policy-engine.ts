import prisma from "../../lib/prisma";
import type { PolicyEvaluationInput, PolicyEvaluationResult } from "../types";
import { POLICY_RULES } from "./policy-rules";
import { recordToolPolicyDecision } from "../audit/tool-audit.service";

export async function evaluatePolicy(input: PolicyEvaluationInput): Promise<PolicyEvaluationResult> {
  for (const rule of POLICY_RULES) {
    const result = await rule.evaluate(input);
    if (result) {
      await recordToolPolicyDecision({
        toolId: input.tool.toolId,
        actorId: input.actor.actorId,
        actorRole: input.actor.actorRole,
        decision: result.decision,
        reason: result.reason,
        ruleMatched: result.ruleMatched,
        traceId: input.actor.traceId,
      });
      return result;
    }
  }
  return { decision: "ALLOW", ruleMatched: "fallback.allow" };
}

export async function listPolicyLogs(query: {
  toolId?: string;
  decision?: string;
  limit?: number;
}) {
  const where: Record<string, unknown> = {};
  if (query.toolId) where.toolId = query.toolId;
  if (query.decision) where.decision = query.decision;
  return prisma.aiToolPolicyLog.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: query.limit ?? 50,
  });
}

export async function getPolicyExplorerSummary() {
  const [allow, deny, approval] = await Promise.all([
    prisma.aiToolPolicyLog.count({ where: { decision: "ALLOW" } }),
    prisma.aiToolPolicyLog.count({ where: { decision: "DENY" } }),
    prisma.aiToolPolicyLog.count({ where: { decision: "REQUIRES_APPROVAL" } }),
  ]);
  return { allow, deny, requiresApproval: approval, total: allow + deny + approval };
}
