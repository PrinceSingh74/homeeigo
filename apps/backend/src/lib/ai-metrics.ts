/**
 * Phase 3 Enterprise AI Core Prometheus metrics.
 */
import { incCounter, observeHist, setGauge, registerScrapeSampler } from "./metrics";

export function recordAiRequest(role: string, endpoint: string): void {
  incCounter("homigo_ai_requests_total", { role, endpoint });
}

export function recordAiSuccess(role: string, provider: string): void {
  incCounter("homigo_ai_success_total", { role, provider });
}

export function recordAiFailure(role: string, reason: string): void {
  incCounter("homigo_ai_failures_total", { role, reason });
}

export function recordAiLatency(latencyMs: number, provider: string): void {
  observeHist("homigo_ai_latency", latencyMs / 1000, { provider });
}

export function recordAiProviderUsage(provider: string, status: string): void {
  incCounter("homigo_ai_provider_usage", { provider, status });
}

export function recordAiCost(costUsd: number, provider: string, role: string): void {
  observeHist("homigo_ai_cost", costUsd, { provider, role });
}

export function recordAiFallback(from: string, to: string): void {
  incCounter("homigo_ai_fallback_total", { from, to });
}

export function recordAiPromptBlocked(category: string, role: string): void {
  incCounter("homigo_ai_prompt_blocked", { category, role });
}

export function recordAiTimeout(provider: string): void {
  incCounter("homigo_ai_timeout_total", { provider });
}

export function recordAiRetry(provider: string): void {
  incCounter("homigo_ai_retry_total", { provider });
}

export function initAiMetricsAtZero(): void {
  for (const role of ["CUSTOMER", "PARTNER", "ADMIN", "SUPPORT", "SYSTEM", "AUTOMATION"]) {
    for (const endpoint of ["customer", "partner", "admin", "chat"]) {
      incCounter("homigo_ai_requests_total", { role, endpoint }, 0);
    }
    for (const provider of ["GEMINI", "OPENAI"]) {
      incCounter("homigo_ai_success_total", { role, provider }, 0);
    }
    incCounter("homigo_ai_failures_total", { role, reason: "provider_error" }, 0);
  }
  for (const provider of ["GEMINI", "OPENAI"]) {
    incCounter("homigo_ai_provider_usage", { provider, status: "success" }, 0);
    incCounter("homigo_ai_provider_usage", { provider, status: "failure" }, 0);
    incCounter("homigo_ai_timeout_total", { provider }, 0);
    incCounter("homigo_ai_retry_total", { provider }, 0);
    observeHist("homigo_ai_latency", 0, { provider });
    observeHist("homigo_ai_cost", 0, { provider: provider, role: "CUSTOMER" });
  }
  incCounter("homigo_ai_fallback_total", { from: "GEMINI", to: "OPENAI" }, 0);
  for (const category of ["injection", "secret_leak", "length_exceeded"]) {
    incCounter("homigo_ai_prompt_blocked", { category, role: "CUSTOMER" }, 0);
  }
  setGauge("homigo_ai_daily_cost_usd", 0);
}

export function registerAiMetricSamplers(): void {
  registerScrapeSampler(async () => {
    try {
      const { default: prisma } = await import("./prisma");
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      const agg = await prisma.aiGatewayCost.aggregate({
        where: { date: { gte: startOfDay } },
        _sum: { totalCostUsd: true },
      });
      setGauge("homigo_ai_daily_cost_usd", agg._sum.totalCostUsd ?? 0);
    } catch {
      /* tables may not exist yet */
    }
  });
}
