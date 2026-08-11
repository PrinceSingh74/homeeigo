import crypto from "crypto";
import type { AiProviderType } from "@prisma/client";
import { aiConfig } from "../config";
import {
  callAnthropic,
  callGemini,
  callGroq,
  callOpenAi,
  type ProviderCallInput,
} from "../providers/model-providers";
import { ProviderError, toProviderError } from "../providers/provider-errors";
import type { AiProviderResponse, ProviderAttempt } from "../types";
import {
  recordAiFallback,
  recordAiProviderUsage,
  recordAiRetry,
  recordAiTimeout,
  recordAiProviderFailure,
} from "../../lib/ai-metrics";
import { CircuitOpenError } from "../../lib/circuit-breaker";
import {
  applyCooldown,
  canServe,
  clearCooldown,
  describeChain,
  eligibleChain,
  providerBreaker,
  resetCooldowns,
  type ProviderDescriptor,
} from "./provider-registry";

/**
 * Adapter lookup. The router resolves a provider to a call through this map and never
 * branches on provider identity — adding a provider is a map entry, not new routing logic.
 */
const PROVIDER_CALLS: Record<AiProviderType, (input: ProviderCallInput) => Promise<AiProviderResponse>> = {
  ANTHROPIC: callAnthropic,
  GEMINI: callGemini,
  GROQ: callGroq,
  OPENAI: callOpenAi,
};

export type RouterResult = AiProviderResponse & {
  fallbackUsed: boolean;
  /** How many providers were exhausted before this one answered. 0 = the primary served. */
  fallbackDepth: number;
  attempts: ProviderAttempt[];
};

/** Raised when the shared deadline is spent before any provider produced an answer. */
export class RouterDeadlineError extends Error {
  constructor(public readonly attempts: ProviderAttempt[]) {
    super("ai_router_deadline_exceeded");
    this.name = "RouterDeadlineError";
  }
}

/** Raised when the chain is exhausted; carries the per-attempt record for auditing. */
export class RouterExhaustedError extends Error {
  constructor(
    message: string,
    public readonly attempts: ProviderAttempt[],
    public readonly lastError?: ProviderError,
  ) {
    super(message);
    this.name = "RouterExhaustedError";
  }
}

/**
 * Runs one attempt through the provider's circuit breaker and records its outcome.
 *
 * Failure handling is entirely taxonomy-driven: the code decides whether the provider is
 * parked (rate limit / quota) or merely counted as a fault, so no provider-specific
 * knowledge lives here.
 */
async function attemptProvider(
  provider: AiProviderType,
  input: ProviderCallInput,
  attempts: ProviderAttempt[],
  remainingMs: number,
): Promise<AiProviderResponse> {
  const attemptId = crypto.randomUUID();
  const started = Date.now();
  const breaker = providerBreaker(provider);

  try {
    const resp = await breaker.execute(() => PROVIDER_CALLS[provider]({ ...input, timeoutMs: remainingMs }));
    clearCooldown(provider);
    recordAiProviderUsage(provider, "success");
    attempts.push({
      attemptId,
      provider,
      outcome: "SUCCESS",
      latencyMs: Date.now() - started,
    });
    return resp;
  } catch (err) {
    // A short-circuit is not a provider fault — it is this process declining to call one.
    if (err instanceof CircuitOpenError) {
      attempts.push({
        attemptId,
        provider,
        outcome: "FAILURE",
        errorCode: "PROVIDER_UNAVAILABLE",
        latencyMs: Date.now() - started,
      });
      throw err;
    }

    const providerError = toProviderError(err, provider);
    recordAiProviderUsage(provider, "failure");
    recordAiProviderFailure(provider, providerError.code);
    if (providerError.code === "PROVIDER_TIMEOUT") recordAiTimeout(provider);

    const cooldownMs = providerError.shouldCooldown
      ? applyCooldown(provider, providerError)
      : undefined;

    attempts.push({
      attemptId,
      provider,
      outcome: "FAILURE",
      errorCode: providerError.code,
      httpStatus: providerError.httpStatus,
      latencyMs: Date.now() - started,
      cooldownMs,
    });
    throw providerError;
  }
}

/**
 * Deterministic ordered failover over `aiConfig.providerOrder`.
 *
 * Per request: walk the chain, skipping providers that are disabled, unconfigured, parked
 * on cooldown or circuit-open. Each provider gets one attempt plus — only for a transient,
 * retryable failure — one local retry. Rate limits and quota exhaustion are never retried
 * in place; they park the provider and move on, which is the whole point of having a chain.
 *
 * Every attempt is charged against one shared deadline, so total wall time is bounded no
 * matter how long the chain is. No load balancing and no random routing: the same input
 * with the same provider health always takes the same path.
 */
export async function routeModelRequest(input: ProviderCallInput): Promise<RouterResult> {
  const deadlineAt = Date.now() + aiConfig.totalDeadlineMs;
  const attempts: ProviderAttempt[] = [];
  const chain = eligibleChain();

  if (chain.length === 0) {
    throw new RouterExhaustedError("no_provider_available", attempts);
  }

  let lastError: ProviderError | undefined;
  let previous: AiProviderType | undefined;
  let depth = 0;

  for (const provider of chain) {
    if (Date.now() >= deadlineAt) throw new RouterDeadlineError(attempts);

    // Health is re-read per provider: an earlier attempt in this same request may have
    // parked one, and concurrent requests move breaker state underneath us.
    if (!canServe(provider)) continue;

    if (previous !== undefined) {
      recordAiFallback(previous, provider);
      depth += 1;
    }

    for (let localAttempt = 0; localAttempt <= 1; localAttempt += 1) {
      if (Date.now() >= deadlineAt) throw new RouterDeadlineError(attempts);
      try {
        const resp = await attemptProvider(provider, input, attempts, deadlineAt - Date.now());
        return { ...resp, fallbackUsed: depth > 0, fallbackDepth: depth, attempts };
      } catch (err) {
        if (err instanceof ProviderError) lastError = err;

        const retryable = err instanceof ProviderError && err.retryable;
        if (localAttempt === 0 && retryable && Date.now() < deadlineAt) {
          recordAiRetry(provider);
          continue;
        }
        break;
      }
    }

    previous = provider;
  }

  throw new RouterExhaustedError(
    lastError?.message ?? "no_provider_available",
    attempts,
    lastError,
  );
}

/** Current chain with per-provider health — used by the health endpoint and diagnostics. */
export function describeProviderChain(): ProviderDescriptor[] {
  return describeChain();
}

export function getCircuitStates(): Record<AiProviderType, string> {
  const out = {} as Record<AiProviderType, string>;
  for (const provider of ["ANTHROPIC", "GEMINI", "GROQ", "OPENAI"] as AiProviderType[]) {
    out[provider] = providerBreaker(provider).getState();
  }
  return out;
}

/** Test/ops helper — clears breaker and cooldown state for every provider. */
export function resetCircuits(): void {
  for (const provider of ["ANTHROPIC", "GEMINI", "GROQ", "OPENAI"] as AiProviderType[]) {
    providerBreaker(provider).reset();
  }
  resetCooldowns();
}
