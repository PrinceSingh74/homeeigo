/** Phase 3 Enterprise AI Core — environment-driven configuration. */
export const aiConfig = {
  enabled: process.env.AI_GATEWAY_ENABLED !== "false",
  gemini: {
    projectId: process.env.GCP_PROJECT_ID ?? "homigo-497619",
    location: process.env.VERTEX_LOCATION ?? "us-central1",
    model: process.env.AI_GEMINI_MODEL ?? "gemini-2.0-flash",
    apiKey: process.env.GEMINI_API_KEY,
  },
  openai: {
    apiKey: process.env.OPENAI_API_KEY,
    model: process.env.AI_OPENAI_MODEL ?? "gpt-4o-mini",
    baseUrl: process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
  },
  /** Cost per 1M tokens (USD) — approximate, for metering only. */
  pricing: {
    gemini: { input: 0.075, output: 0.30, cached: 0.01875 },
    openai: { input: 0.15, output: 0.60, cached: 0.075 },
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
