/** Phase 5 Enterprise AI Tools configuration. */
export const aiToolsConfig = {
  enabled: process.env.AI_TOOLS_ENABLED !== "false",
  /** When true, bypasses per-tool rate limits (certification/load testing only). */
  get certificationMode() {
    return process.env.AI_TOOL_CERTIFICATION_MODE === "true";
  },
  rateLimitPerMinute: Number(process.env.AI_TOOL_RATE_LIMIT_PER_MINUTE ?? 30),
  approvalExpiryHours: Number(process.env.AI_TOOL_APPROVAL_EXPIRY_HOURS ?? 24),
  defaultTimeoutMs: Number(process.env.AI_TOOL_DEFAULT_TIMEOUT_MS ?? 30_000),
  maxConcurrentExecutions: Number(process.env.AI_TOOL_MAX_CONCURRENT ?? 50),
  idempotencyTtlHours: Number(process.env.AI_TOOL_IDEMPOTENCY_TTL_HOURS ?? 24),
  circuitBreakerThreshold: Number(process.env.AI_TOOL_CB_THRESHOLD ?? 5),
  circuitBreakerResetMs: Number(process.env.AI_TOOL_CB_RESET_MS ?? 60_000),
  maintenanceModeBlocksWrites: process.env.AI_TOOL_MAINTENANCE_BLOCK_WRITES !== "false",
} as const;
