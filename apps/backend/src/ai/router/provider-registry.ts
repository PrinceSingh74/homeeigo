import type { AiProviderType } from "@prisma/client";
import { aiConfig, isProviderConfigured, providerModel } from "../config";
import { breakers, type CircuitBreaker } from "../../lib/circuit-breaker";
import { recordAiProviderCooldown } from "../../lib/ai-metrics";
import type { ProviderError } from "../providers/provider-errors";

/**
 * Observable provider health. Ordered roughly by severity so a caller can reason about
 * "is this usable" without a lookup table: only AVAILABLE and DEGRADED can serve.
 */
export type ProviderHealthState =
  | "AVAILABLE"
  | "DEGRADED"
  | "RATE_LIMITED"
  | "QUOTA_EXHAUSTED"
  | "CIRCUIT_OPEN"
  | "DISABLED"
  | "MISCONFIGURED";

type CooldownState = {
  until: number;
  reason: "RATE_LIMITED" | "QUOTA_EXHAUSTED";
};

/**
 * Cooldown parked per provider, separate from the circuit breaker.
 *
 * The breaker reacts to *failures*; a 429 is not a fault, it is the provider telling us
 * when to come back. Conflating them would either trip the breaker on healthy providers
 * or ignore an explicit Retry-After. They are tracked independently and both consulted.
 */
const cooldowns = new Map<AiProviderType, CooldownState>();

/** One shared breaker per provider, from the repo-wide registry — not a second implementation. */
function breakerFor(provider: AiProviderType): CircuitBreaker {
  return breakers.get(`ai_provider_${provider.toLowerCase()}`, {
    failureThreshold: aiConfig.circuitBreaker.failureThreshold,
    resetTimeoutMs: aiConfig.circuitBreaker.resetMs,
    halfOpenMaxAttempts: aiConfig.circuitBreaker.halfOpenMax,
  });
}

export function providerBreaker(provider: AiProviderType): CircuitBreaker {
  return breakerFor(provider);
}

/** True when the provider is explicitly switched off, regardless of credentials. */
export function isProviderEnabled(provider: AiProviderType): boolean {
  return aiConfig.disabledProviders.includes(provider) === false;
}

export function cooldownRemainingMs(provider: AiProviderType): number {
  const state = cooldowns.get(provider);
  if (!state) return 0;
  const remaining = state.until - Date.now();
  if (remaining <= 0) {
    cooldowns.delete(provider);
    return 0;
  }
  return remaining;
}

/**
 * Parks a provider after it reported a rate limit or exhausted quota.
 *
 * The provider's own Retry-After wins when supplied; otherwise a bounded default is used.
 * Quota exhaustion gets the longer default because it typically resets on a daily cycle
 * and re-probing every minute simply wastes attempts.
 */
export function applyCooldown(provider: AiProviderType, err: ProviderError): number {
  const reason = err.code === "PROVIDER_QUOTA_EXCEEDED" ? "QUOTA_EXHAUSTED" : "RATE_LIMITED";
  const fallbackMs =
    reason === "QUOTA_EXHAUSTED"
      ? aiConfig.cooldown.quotaExhaustedMs
      : aiConfig.cooldown.rateLimitedMs;
  const requested = err.retryAfterMs ?? fallbackMs;
  // Bounded in both directions: never shorter than a second (pointless churn), never
  // longer than the configured ceiling (a provider must not park itself indefinitely).
  const durationMs = Math.min(Math.max(requested, 1_000), aiConfig.cooldown.maxMs);
  cooldowns.set(provider, { until: Date.now() + durationMs, reason });
  recordAiProviderCooldown(provider, reason);
  return durationMs;
}

export function clearCooldown(provider: AiProviderType): void {
  cooldowns.delete(provider);
}

/** Test/ops helper — clears cooldown state for every provider. */
export function resetCooldowns(): void {
  cooldowns.clear();
}

export function providerHealth(provider: AiProviderType): ProviderHealthState {
  if (!isProviderEnabled(provider)) return "DISABLED";
  if (!isProviderConfigured(provider) && !aiConfig.dryRun) return "MISCONFIGURED";

  const cooldown = cooldowns.get(provider);
  if (cooldown && cooldown.until > Date.now()) return cooldown.reason;

  const state = breakerFor(provider).getState();
  if (state === "OPEN") return "CIRCUIT_OPEN";
  if (state === "HALF_OPEN") return "DEGRADED";
  return "AVAILABLE";
}

/** Only these states can take traffic. */
export function canServe(provider: AiProviderType): boolean {
  const health = providerHealth(provider);
  return health === "AVAILABLE" || health === "DEGRADED";
}

export type ProviderDescriptor = {
  provider: AiProviderType;
  /** Position in the failover chain — 0 is primary. */
  priority: number;
  enabled: boolean;
  configured: boolean;
  model: string;
  health: ProviderHealthState;
  cooldownRemainingMs: number;
  circuit: string;
};

/**
 * The routing chain as data.
 *
 * Order comes from `AI_PROVIDER_ORDER`; per-provider state is resolved at call time. The
 * router iterates this list and never names a provider, so changing the chain — or
 * disabling one — is configuration, not a code change.
 */
export function describeChain(): ProviderDescriptor[] {
  return aiConfig.providerOrder.map((provider, index) => ({
    provider,
    priority: index,
    enabled: isProviderEnabled(provider),
    configured: isProviderConfigured(provider),
    model: providerModel(provider),
    health: providerHealth(provider),
    cooldownRemainingMs: cooldownRemainingMs(provider),
    circuit: breakerFor(provider).getState(),
  }));
}

/** Providers eligible to be attempted right now, in chain order. */
export function eligibleChain(): AiProviderType[] {
  return aiConfig.providerOrder.filter(canServe);
}
