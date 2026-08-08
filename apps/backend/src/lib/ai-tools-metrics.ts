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
