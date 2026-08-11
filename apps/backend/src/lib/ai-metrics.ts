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

/**
 * Provider failure by normalized taxonomy code.
 *
 * `reason` is drawn from the closed ProviderErrorCode set, so cardinality is bounded by
 * providers x 10 codes and can never grow from upstream error text.
 */
export function recordAiProviderFailure(provider: string, reason: string): void {
  incCounter("homigo_ai_provider_failures_total", { provider, reason });
  if (reason === "PROVIDER_RATE_LIMITED") {
    incCounter("homigo_ai_provider_rate_limited_total", { provider });
  }
  if (reason === "PROVIDER_QUOTA_EXCEEDED") {
    incCounter("homigo_ai_provider_quota_exhausted_total", { provider });
  }
}

/** A provider was parked. `reason` is RATE_LIMITED or QUOTA_EXHAUSTED. */
export function recordAiProviderCooldown(provider: string, reason: string): void {
  incCounter("homigo_ai_provider_cooldown_total", { provider, reason });
}

/** Token accounting, split by direction so input/output cost can be attributed. */
export function recordAiTokens(provider: string, promptTokens: number, completionTokens: number): void {
  incCounter("homigo_ai_tokens_total", { provider, direction: "input" }, promptTokens);
  incCounter("homigo_ai_tokens_total", { provider, direction: "output" }, completionTokens);
}

/**
 * Classified customer intent. Both labels come from closed sets — the intent union and
 * the rule names — so cardinality is bounded and cannot grow from user input.
 */
export function recordAiIntent(intent: string, rule: string): void {
  incCounter("homigo_ai_intent_total", { intent, rule });
}

/** A request that could not be served by any provider and fell back to deterministic mode. */
export function recordAiDegraded(endpoint: string, reason: string): void {
  incCounter("homigo_ai_degraded_total", { endpoint, reason });
}

/**
 * Every provider the router can route to. Kept as a literal list so the metric label
 * set stays bounded and enumerable at boot — Prometheus series are pre-seeded at zero
 * so dashboards read 0 instead of NO-DATA before the first request.
 */
const AI_PROVIDERS = ["ANTHROPIC", "GEMINI", "GROQ", "OPENAI"] as const;

export function initAiMetricsAtZero(): void {
  for (const role of ["CUSTOMER", "PARTNER", "ADMIN", "SUPPORT", "SYSTEM", "AUTOMATION"]) {
    for (const endpoint of ["customer", "partner", "admin", "chat"]) {
      incCounter("homigo_ai_requests_total", { role, endpoint }, 0);
    }
    for (const provider of AI_PROVIDERS) {
      incCounter("homigo_ai_success_total", { role, provider }, 0);
    }
    incCounter("homigo_ai_failures_total", { role, reason: "provider_error" }, 0);
  }
  for (const provider of AI_PROVIDERS) {
    incCounter("homigo_ai_provider_usage", { provider, status: "success" }, 0);
    incCounter("homigo_ai_provider_usage", { provider, status: "failure" }, 0);
    incCounter("homigo_ai_timeout_total", { provider }, 0);
    incCounter("homigo_ai_retry_total", { provider }, 0);
    observeHist("homigo_ai_latency", 0, { provider });
    observeHist("homigo_ai_cost", 0, { provider: provider, role: "CUSTOMER" });
  }
  const FAILURE_REASONS = [
    "PROVIDER_TIMEOUT", "PROVIDER_RATE_LIMITED", "PROVIDER_QUOTA_EXCEEDED",
    "PROVIDER_AUTH_FAILED", "PROVIDER_BAD_REQUEST", "PROVIDER_UNAVAILABLE",
    "PROVIDER_5XX", "PROVIDER_NETWORK_ERROR", "PROVIDER_INVALID_RESPONSE",
    "PROVIDER_UNKNOWN_ERROR",
  ];
  for (const provider of AI_PROVIDERS) {
    for (const reason of FAILURE_REASONS) {
      incCounter("homigo_ai_provider_failures_total", { provider, reason }, 0);
    }
    incCounter("homigo_ai_provider_rate_limited_total", { provider }, 0);
    incCounter("homigo_ai_provider_quota_exhausted_total", { provider }, 0);
    for (const reason of ["RATE_LIMITED", "QUOTA_EXHAUSTED"]) {
      incCounter("homigo_ai_provider_cooldown_total", { provider, reason }, 0);
    }
    for (const direction of ["input", "output"]) {
      incCounter("homigo_ai_tokens_total", { provider, direction }, 0);
    }
  }
  for (const intent of [
    "SERVICE_SEARCH", "PRICING_INQUIRY", "BOOKING_STATUS",
    "CANCEL_RESCHEDULE", "COMPLAINT", "ACCOUNT", "GENERAL",
  ]) {
    incCounter("homigo_ai_intent_total", { intent, rule: "fallback" }, 0);
  }
  for (const endpoint of ["customer", "partner", "admin", "chat"]) {
    for (const reason of ["PROVIDERS_UNCONFIGURED", "PROVIDER_ERROR", "GATEWAY_DISABLED"]) {
      incCounter("homigo_ai_degraded_total", { endpoint, reason }, 0);
    }
  }
  // Any ordered pair is reachable because the failover chain is configurable.
  for (const from of AI_PROVIDERS) {
    for (const to of AI_PROVIDERS) {
      if (from !== to) incCounter("homigo_ai_fallback_total", { from, to }, 0);
    }
  }
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
