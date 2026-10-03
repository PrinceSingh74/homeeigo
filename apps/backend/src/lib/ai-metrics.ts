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

/**
 * Record the cost of one request, or record that it could not be priced.
 *
 * ── Why status is a parameter ────────────────────────────────────────────────
 *
 * `computeTokenCostDetailed` returns `costUsd: 0` with `costStatus: "UNKNOWN"` when a provider has
 * no pricing entry, and its own comment says that must never be published as a cost: summed over a
 * day, a stream of unknown-priced requests reads as a free provider. This used to take only the
 * number, so the distinction died at the call site.
 *
 * An unpriced request is therefore counted, not observed. `homigo_ai_cost` stays a histogram of real
 * money, and `homigo_ai_cost_unknown_total` says how much of the traffic that histogram cannot
 * account for — so a dashboard can show spend beside its own completeness.
 */
export function recordAiCost(
  costUsd: number,
  provider: string,
  role: string,
  costStatus: "COMPUTED" | "UNKNOWN" = "COMPUTED",
): void {
  if (costStatus === "UNKNOWN") {
    incCounter("homigo_ai_cost_unknown_total", { provider, role });
    return;
  }
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

  /**
   * Histograms are deliberately NOT seeded.
   *
   * Seeding a counter at zero states a true fact. Observing a zero into a histogram fabricates a
   * measurement: it increments `_count`, lands a sample in the lowest bucket, and drags
   * percentiles toward zero for as long as the seed sits inside the rate window after a restart.
   * A latency panel reading ~0ms before any request has been made is worse than one reading
   * NO DATA, because only one of them is true.
   */
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
    /**
     * Seeded so "no request had unknown cost" is a measured zero rather than an absent series.
     *
     * Without this the panel had to declare `noValue: 0`, which quietly meant it would still read
     * "0 requests missing from the cost figure" while the exporter was dead and nothing could be
     * measured at all — the one panel in the centre that showed a number during an outage.
     */
    incCounter("homigo_ai_cost_unknown_total", { provider, role: "CUSTOMER" }, 0);
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
  for (const provider of AI_PROVIDERS) {
    incCounter("homigo_ai_mocked_responses_total", { provider, role: "CUSTOMER" }, 0);
    incCounter("homigo_ai_mocked_estimated_cost_usd_total", { provider, role: "CUSTOMER" }, 0);
  }
}

/**
 * A dry-run response: no provider was contacted, so nothing was spent.
 *
 * Recorded on its own series rather than folded into cost. `homigo_ai_daily_cost_usd` is money that
 * actually left the account; this is what the same traffic WOULD have cost once a provider key
 * exists. Keeping them apart is the whole point — with no credential configured, every figure on
 * the cost gauge was previously an estimate of imaginary spend, and nothing on the dashboard said so.
 *
 * `homigo_ai_mocked_responses_total` being non-zero is itself the signal an operator needs: the
 * assistant is answering, and not with a model.
 */
export function recordMockedResponse(
  provider: string,
  role: string,
  estimatedCostUsd: number,
  costStatus: "COMPUTED" | "UNKNOWN" = "COMPUTED",
): void {
  incCounter("homigo_ai_mocked_responses_total", { provider, role });
  if (costStatus === "COMPUTED" && estimatedCostUsd > 0) {
    incCounter("homigo_ai_mocked_estimated_cost_usd_total", { provider, role }, estimatedCostUsd);
  }
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

  /**
   * Whether this process can actually spend money with a provider, and whether anything caps it.
   *
   * `ai-budget.service` emits `homigo_ai_budget_decision_total{decision="NO_POLICY_CONFIGURED"}`
   * when no cap applies, and returns `allowed: true` — a deliberate choice, since refusing every AI
   * request because nobody has written a budget yet would be worse. But no alert could be written
   * against it, because "no cap and no API keys" (harmless: nothing can spend) and "no cap and live
   * keys" (uncapped spend) produced exactly the same counter.
   *
   * These two gauges are what tells them apart. Neither reads a key, only whether one is present.
   */
  registerScrapeSampler(async () => {
    try {
      const { liveInferenceConfigured } = await import("../ai/config");
      const providers = ["ANTHROPIC", "GEMINI", "GROQ", "OPENAI"] as const;
      let anyLive = 0;
      for (const p of providers) {
        const live = liveInferenceConfigured(p) ? 1 : 0;
        setGauge("homigo_ai_live_inference_configured", live, { provider: p });
        anyLive = Math.max(anyLive, live);
      }
      setGauge("homigo_ai_live_inference_any", anyLive);

      const { default: prisma } = await import("./prisma");
      const policies = await prisma.aiBudgetPolicy.count({ where: { isActive: true } });
      setGauge("homigo_ai_budget_policies_active", policies);
    } catch {
      /* config or tables unavailable — leave the previous values rather than reporting a false 0 */
    }
  });
}
