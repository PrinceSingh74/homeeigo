/** Phase 4 Enterprise AI Brain configuration. */
export const aiBrainConfig = {
  enabled: process.env.AI_BRAIN_ENABLED !== "false",
  contextCacheTtlSeconds: Number(process.env.AI_CONTEXT_CACHE_TTL ?? 300),
  contextSnapshotTtlHours: Number(process.env.AI_CONTEXT_SNAPSHOT_TTL_HOURS ?? 24),
  memoryCleanupIntervalMs: Number(process.env.AI_MEMORY_CLEANUP_INTERVAL_MS ?? 3_600_000),
  promptCompressionThreshold: Number(process.env.AI_PROMPT_COMPRESSION_THRESHOLD ?? 0.8),
  maxMemorySearchResults: Number(process.env.AI_MEMORY_SEARCH_LIMIT ?? 50),
} as const;
