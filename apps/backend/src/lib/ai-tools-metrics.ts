/**
 * Phase 5 Enterprise AI Tools Prometheus metrics.
 */
import { incCounter, observeHist, setGauge, registerScrapeSampler } from "./metrics";

export function recordToolRequest(role: string, category: string, toolId: string): void {
  incCounter("homigo_ai_tool_requests_total", { role, category, tool_id: toolId });
}

export function recordToolSuccess(category: string, toolId: string): void {
  incCounter("homigo_ai_tool_success_total", { category, tool_id: toolId });
}

export function recordToolFailure(category: string, reason: string): void {
  incCounter("homigo_ai_tool_failure_total", { category, reason });
}

export function recordToolDenied(toolId: string, reason: string): void {
  incCounter("homigo_ai_tool_denied", { tool_id: toolId, reason });
}

/**
 * An approval was presented but refused. `reason` is one of the closed
 * ApprovalConsumptionFailure codes, so cardinality stays bounded.
 *
 * Any sustained non-zero rate here is worth investigating: it means someone is presenting
 * approvals that do not belong to the request they are making.
 */
export function recordToolApprovalRejected(toolId: string, reason: string): void {
  incCounter("homigo_ai_tool_approval_rejected_total", { tool_id: toolId, reason });
}

/**
 * A request was answered from an existing execution instead of running again.
 *
 * `state` distinguishes a replayed SUCCESS from a suppressed duplicate that arrived while
 * the original was still RUNNING or awaiting approval — the latter two are the cases that
 * would otherwise have produced duplicate business effects.
 */
export function recordToolIdempotencyReplay(toolId: string, state: string): void {
  incCounter("homigo_ai_tool_idempotency_replay_total", { tool_id: toolId, state });
}

/** An action was held pending the acting user's explicit consent. */
export function recordToolConfirmationRequired(toolId: string): void {
  incCounter("homigo_ai_tool_confirmation_required_total", { tool_id: toolId });
}

/**
 * How many tools a model was shown, by role and intent.
 *
 * A sudden rise means the discovery filter widened — worth noticing, since exposure is
 * the first control in the chain. Count only; no tool names, no actor identity.
 */
export function recordToolDiscovery(actorRole: string, intent: string, count: number): void {
  incCounter("homigo_ai_tool_discovery_total", { actor_role: actorRole, intent });
  observeHist("homigo_ai_tool_discovery_size", count, { actor_role: actorRole });
}

/**
 * A tool result had content stripped before reaching the model.
 *
 * `kind` is "injection" or "secret". Sustained injection hits mean stored data is being
 * used as a prompt channel and is worth investigating at source.
 */
export function recordToolResultSanitized(toolId: string, kind: string): void {
  incCounter("homigo_ai_tool_result_sanitized_total", { tool_id: toolId, kind });
}

/** One model↔tool round completed. `round` is bounded by config, so cardinality is safe. */
export function recordToolBridgeRound(actorRole: string, round: number): void {
  incCounter("homigo_ai_tool_bridge_rounds_total", { actor_role: actorRole, round: String(round) });
}

/**
 * A model-requested tool call was refused before execution.
 *
 * Non-zero for TOOL_NOT_PERMITTED means a model is naming tools it was never shown —
 * worth investigating, since discovery is meant to make that impossible.
 */
export function recordToolBridgeRejected(reason: string): void {
  incCounter("homigo_ai_tool_bridge_rejected_total", { reason });
}

/**
 * A side-effecting call ended with an unknown outcome.
 *
 * This should be rare and every occurrence deserves a look: it means something downstream
 * may have been applied without confirmation. Alert on any sustained non-zero rate.
 */
export function recordToolIndeterminate(toolId: string): void {
  incCounter("homigo_ai_tool_indeterminate_total", { tool_id: toolId });
}

export function recordToolRequiresApproval(toolId: string): void {
  incCounter("homigo_ai_tool_requires_approval", { tool_id: toolId });
}

export function recordToolLatency(latencyMs: number, category: string): void {
  observeHist("homigo_ai_tool_latency", latencyMs / 1000, { category });
  observeHist("homigo_ai_tool_execution_time", latencyMs / 1000, { category });
}

export function recordToolCost(costUsd: number, toolId: string): void {
  observeHist("homigo_ai_tool_cost", costUsd, { tool_id: toolId });
}

export function recordToolTimeout(toolId: string): void {
  incCounter("homigo_ai_tool_timeout", { tool_id: toolId });
}

export function recordToolRetry(toolId: string): void {
  incCounter("homigo_ai_tool_retry", { tool_id: toolId });
}

export function initAiToolsMetricsAtZero(): void {
  for (const category of ["READ", "WRITE", "HIGH_RISK"]) {
    incCounter("homigo_ai_tool_requests_total", { role: "CUSTOMER", category, tool_id: "init" }, 0);
    incCounter("homigo_ai_tool_success_total", { category, tool_id: "init" }, 0);
    incCounter("homigo_ai_tool_failure_total", { category, reason: "init" }, 0);
    observeHist("homigo_ai_tool_latency", 0, { category });
    observeHist("homigo_ai_tool_execution_time", 0, { category });
  }
  incCounter("homigo_ai_tool_denied", { tool_id: "init", reason: "init" }, 0);
  incCounter("homigo_ai_tool_requires_approval", { tool_id: "init" }, 0);
  incCounter("homigo_ai_tool_timeout", { tool_id: "init" }, 0);
  incCounter("homigo_ai_tool_retry", { tool_id: "init" }, 0);
  observeHist("homigo_ai_tool_cost", 0, { tool_id: "init" });
  setGauge("homigo_ai_tool_pending_approvals", 0);
}

export function registerAiToolsMetricSamplers(): void {
  registerScrapeSampler(async () => {
    try {
      const { default: prisma } = await import("./prisma");
      const pending = await prisma.aiToolApproval.count({
        where: { status: "PENDING", expiresAt: { gt: new Date() } },
      });
      setGauge("homigo_ai_tool_pending_approvals", pending);
    } catch {
      /* tables may not exist yet */
    }
  });
}
