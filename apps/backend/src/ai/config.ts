import type { AiProviderType } from "@prisma/client";

/**
 * Provider preference order: first entry is primary, the rest are fallbacks in order.
 *
 * Configuration-driven so the primary can change without touching the router. Unknown
 * or duplicate names are dropped rather than throwing — a typo in an env var must not
 * take the assistant down, it should just fall back to the documented default.
 */
const DEFAULT_PROVIDER_ORDER: AiProviderType[] = ["GROQ", "GEMINI", "OPENAI"];

/**
 * Providers that are implemented but must not take production traffic.
 *
 * Anthropic is deliberately parked for V1: the adapter is certified structurally but has
 * never served a live request here, so it stays out of the chain until it has been. This
 * is a list, not a per-provider flag, so parking a provider needs no schema or code change.
 */
function parseDisabledProviders(raw: string | undefined): AiProviderType[] {
  const known = new Set<AiProviderType>(["ANTHROPIC", "GEMINI", "GROQ", "OPENAI"]);
  if (raw === undefined) return ["ANTHROPIC"];
  return raw
    .split(",")
    .map((s) => s.trim().toUpperCase() as AiProviderType)
    .filter((p, i, arr) => known.has(p) && arr.indexOf(p) === i);
}

function parseProviderOrder(raw: string | undefined): AiProviderType[] {
  const known = new Set<AiProviderType>(["ANTHROPIC", "GEMINI", "GROQ", "OPENAI"]);
  if (!raw) return DEFAULT_PROVIDER_ORDER;
  const parsed = raw
    .split(",")
    .map((s) => s.trim().toUpperCase() as AiProviderType)
    .filter((p, i, arr) => known.has(p) && arr.indexOf(p) === i);
  return parsed.length > 0 ? parsed : DEFAULT_PROVIDER_ORDER;
}

/** Phase 3 Enterprise AI Core — environment-driven configuration. */
export const aiConfig = {
  enabled: process.env.AI_GATEWAY_ENABLED !== "false",
  /** Primary first, then fallbacks. Override with `AI_PROVIDER_ORDER=GEMINI,OPENAI`. */
  providerOrder: parseProviderOrder(process.env.AI_PROVIDER_ORDER),
  /** Implemented but withheld from routing. `AI_DISABLED_PROVIDERS=` (empty) enables all. */
  disabledProviders: parseDisabledProviders(process.env.AI_DISABLED_PROVIDERS),
  /**
   * Whole-request budget shared by every failover attempt.
   *
   * Without this, three providers at a 20 s adapter timeout could keep a caller waiting a
   * minute. Each attempt receives only what remains, so total wall time stays bounded no
   * matter how long the chain grows.
   */
  totalDeadlineMs: Number(process.env.TOTAL_AI_DEADLINE_MS ?? 30_000),
  cooldown: {
    /** Used when a provider reports a rate limit without a Retry-After hint. */
    rateLimitedMs: Number(process.env.AI_COOLDOWN_RATE_LIMITED_MS ?? 60_000),
    /** Quota resets are usually daily; re-probing every minute wastes attempts. */
    quotaExhaustedMs: Number(process.env.AI_COOLDOWN_QUOTA_MS ?? 900_000),
    /** Ceiling — a provider may never park itself beyond this. */
    maxMs: Number(process.env.AI_COOLDOWN_MAX_MS ?? 3_600_000),
  },
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY,
    model: process.env.AI_ANTHROPIC_MODEL ?? "claude-sonnet-4-5",
    baseUrl: process.env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com/v1",
    apiVersion: process.env.ANTHROPIC_API_VERSION ?? "2023-06-01",
  },
  gemini: {
    projectId: process.env.GCP_PROJECT_ID ?? "homigo-497619",
    location: process.env.VERTEX_LOCATION ?? "us-central1",
    model: process.env.AI_GEMINI_MODEL ?? "gemini-2.0-flash",
    // An API key selects the Gemini Developer API; without one the adapter uses Vertex
    // with application-default credentials. The two transports are not interchangeable.
    apiKey: process.env.GEMINI_API_KEY,
    apiBaseUrl: process.env.GEMINI_API_BASE_URL ?? "https://generativelanguage.googleapis.com/v1beta",
  },
  groq: {
    apiKey: process.env.GROQ_API_KEY,
    model: process.env.AI_GROQ_MODEL ?? "llama-3.3-70b-versatile",
    baseUrl: process.env.GROQ_BASE_URL ?? "https://api.groq.com/openai/v1",
  },
  openai: {
    apiKey: process.env.OPENAI_API_KEY,
    model: process.env.AI_OPENAI_MODEL ?? "gpt-4o-mini",
    baseUrl: process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
  },
  /** Cost per 1M tokens (USD) — approximate, for metering only. Never billing truth. */
  pricing: {
    gemini: { input: 0.075, output: 0.30, cached: 0.01875 },
    openai: { input: 0.15, output: 0.60, cached: 0.075 },
    anthropic: { input: 3.0, output: 15.0, cached: 0.30 },
    groq: { input: 0.59, output: 0.79, cached: 0.59 },
  },
  circuitBreaker: {
    failureThreshold: 5,
    resetMs: 60_000,
    halfOpenMax: 2,
  },
  cache: {
    enabled: process.env.AI_CACHE_ENABLED === "true",
    ttlSeconds: Number(process.env.AI_CACHE_TTL_SECONDS ?? 300),
  },
  dryRun: process.env.AI_GATEWAY_DRY_RUN === "true",
} as const;

export function isGeminiConfigured(): boolean {
  return Boolean(aiConfig.gemini.apiKey || process.env.GOOGLE_APPLICATION_CREDENTIALS);
}

export function isOpenAiConfigured(): boolean {
  return Boolean(aiConfig.openai.apiKey);
}

export function isAnthropicConfigured(): boolean {
  return Boolean(aiConfig.anthropic.apiKey);
}

export function isGroqConfigured(): boolean {
  return Boolean(aiConfig.groq.apiKey);
}

/** Presence check by provider — never reads or returns the credential itself. */
export function isProviderConfigured(provider: AiProviderType): boolean {
  switch (provider) {
    case "ANTHROPIC":
      return isAnthropicConfigured();
    case "GEMINI":
      return isGeminiConfigured();
    case "GROQ":
      return isGroqConfigured();
    case "OPENAI":
      return isOpenAiConfigured();
    default:
      return false;
  }
}

/** True when at least one provider in the configured chain has credentials. */
export function isAnyProviderConfigured(): boolean {
  return aiConfig.providerOrder.some(isProviderConfigured);
}

export function providerModel(provider: AiProviderType): string {
  switch (provider) {
    case "ANTHROPIC":
      return aiConfig.anthropic.model;
    case "GEMINI":
      return aiConfig.gemini.model;
    case "GROQ":
      return aiConfig.groq.model;
    case "OPENAI":
      return aiConfig.openai.model;
    default:
      return "unknown";
  }
}
