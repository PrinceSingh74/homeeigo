/**
 * Phase 4 Enterprise AI Brain Prometheus metrics.
 */
import { incCounter, observeHist, setGauge, registerScrapeSampler } from "./metrics";

export function recordContextBuild(role: string): void {
  incCounter("homigo_context_build_total", { role });
}

export function recordContextLatency(latencyMs: number, role: string, cached: boolean): void {
  observeHist("homigo_context_latency", latencyMs / 1000, { role, cached: String(cached) });
}

export function recordContextSize(size: number, role: string): void {
  observeHist("homigo_context_size", size, { role });
}

export function recordMemoryRead(memoryType: string): void {
  incCounter("homigo_memory_reads", { memory_type: memoryType });
}

export function recordMemoryWrite(memoryType: string): void {
  incCounter("homigo_memory_writes", { memory_type: memoryType });
}

export function recordMemoryHit(cacheType: string): void {
  incCounter("homigo_memory_hits", { cache_type: cacheType });
}

/**
 * A cached context was rejected because it did not belong to the requesting actor.
 *
 * This should sit at zero. Any non-zero value means a cache key collided across actors —
 * i.e. the isolation convention broke — and is worth alerting on.
 */
export function recordContextCacheDenied(reason: string): void {
  incCounter("homigo_ai_context_cache_denied_total", { reason });
}

/**
 * A memory was rejected for carrying a prompt-injection payload.
 *
 * `stage` distinguishes a blocked write (the payload never landed) from a blocked read
 * (a row that predates screening, or was written by a path that bypassed it) — the second
 * is the one worth investigating.
 */
export function recordMemoryInjectionBlocked(stage: string, memoryType: string): void {
  incCounter("homigo_ai_memory_injection_blocked_total", { stage, memory_type: memoryType });
}

/**
 * A durable preference or operational fact was learned.
 *
 * Both labels come from closed vocabularies (roles, and the fixed preference kinds), so
 * cardinality cannot grow from user input.
 */
export function recordPreferenceLearned(actorRole: string, kind: string): void {
  incCounter("homigo_ai_preference_learned_total", { actor_role: actorRole, kind });
}

/** An admin surface read memory across owners. Expected to be rare and reviewable. */
export function recordCrossOwnerMemoryRead(memoryType: string): void {
  incCounter("homigo_ai_memory_cross_owner_read_total", { memory_type: memoryType });
}

export function recordMemoryMiss(cacheType: string): void {
  incCounter("homigo_memory_misses", { cache_type: cacheType });
}

export function recordMemoryArchive(memoryType: string): void {
  incCounter("homigo_memory_writes", { memory_type: `${memoryType}_archived` });
}

export function recordPromptRegistryTotal(category: string): void {
  incCounter("homigo_prompt_registry_total", { category });
}

export function recordPromptVersionTotal(category: string): void {
  incCounter("homigo_prompt_version_total", { category });
}

export function recordPromptBlocked(reason: string, role: string): void {
  incCounter("homigo_prompt_blocked_total", { reason, role });
}

export function recordPromptTokens(tokens: number, role: string): void {
  observeHist("homigo_prompt_tokens", tokens, { role });
}

export function recordPromptCompression(ratio: number): void {
  observeHist("homigo_prompt_compression_ratio", ratio);
}

export function initAiBrainMetricsAtZero(): void {
  for (const role of ["CUSTOMER", "PARTNER", "ADMIN", "SUPPORT", "SYSTEM", "AUTOMATION"]) {
    incCounter("homigo_context_build_total", { role }, 0);
    observeHist("homigo_context_latency", 0, { role, cached: "false" });
    observeHist("homigo_context_latency", 0, { role, cached: "true" });
    observeHist("homigo_context_size", 0, { role });
    observeHist("homigo_prompt_tokens", 0, { role });
    incCounter("homigo_prompt_blocked_total", { reason: "token_budget_exceeded", role }, 0);
  }

  for (const memoryType of ["SESSION", "CONVERSATION", "SEMANTIC", "WORKING", "USER", "PARTNER", "ADMIN"]) {
    incCounter("homigo_memory_reads", { memory_type: memoryType }, 0);
    incCounter("homigo_memory_writes", { memory_type: memoryType }, 0);
  }

  incCounter("homigo_memory_hits", { cache_type: "context_cache" }, 0);
  incCounter("homigo_memory_misses", { cache_type: "context_cache" }, 0);

  for (const category of ["customer", "partner", "admin", "finance", "fraud", "support", "eta", "operations"]) {
    incCounter("homigo_prompt_registry_total", { category }, 0);
    incCounter("homigo_prompt_version_total", { category }, 0);
  }

  observeHist("homigo_prompt_compression_ratio", 1);
  setGauge("homigo_ai_brain_memory_total", 0);
  setGauge("homigo_ai_brain_prompts_active", 0);
}

export function registerAiBrainMetricSamplers(): void {
  registerScrapeSampler(async () => {
    try {
      const { default: prisma } = await import("./prisma");
      const [memoryCount, activePrompts] = await Promise.all([
        prisma.aiMemory.count({ where: { isArchived: false } }),
        prisma.aiPromptVersion.count({ where: { isActive: true } }),
      ]);
      setGauge("homigo_ai_brain_memory_total", memoryCount);
      setGauge("homigo_ai_brain_prompts_active", activePrompts);
    } catch {
      /* tables may not exist yet */
    }
  });
}
