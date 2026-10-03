/**
 * Liveness / readiness for orchestrator probes (2026-10-01).
 *
 *   /livez  — the process is up and its event loop answers. No dependency is consulted: a database
 *             outage must not make the orchestrator kill and restart every healthy process.
 *   /readyz — this instance should receive traffic: the database answers and it is not draining.
 *             Public and minimal (status only); the detailed /ready stays behind the ops token.
 *
 * Both read the dependency check through one single-flight cache, so a flood of unauthenticated
 * probe or /health requests costs at most one database round trip per TTL per instance instead of
 * one pooled connection per request.
 */
export type DependencyStatus = { database: "ok" | "down"; redis: "ok" | "degraded" | "disabled" };

export function createDependencyProbe(check: () => Promise<DependencyStatus>, ttlMs = 1_000) {
  let cached: { at: number; value: DependencyStatus } | null = null;
  let inFlight: Promise<DependencyStatus> | null = null;
  return async function probe(): Promise<DependencyStatus> {
    if (cached && Date.now() - cached.at < ttlMs) return cached.value;
    if (inFlight) return inFlight;
    inFlight = check()
      .then((value) => {
        cached = { at: Date.now(), value };
        return value;
      })
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  };
}

let draining = false;

/** First step of a graceful shutdown: /readyz answers 503 so the load balancer stops routing here. */
export function markDraining(): void {
  draining = true;
}

export function isDraining(): boolean {
  return draining;
}

/** Tests only: a test run shares one module instance across files, so a drained probe must be undone. */
export function resetDrainingForTests(): void {
  if (process.env.NODE_ENV !== "test") throw new Error("resetDrainingForTests is for the test runtime only");
  draining = false;
}

/** How long to keep serving after going not-ready, so in-flight routing converges. */
export function shutdownDrainMs(deployed: boolean): number {
  const raw = Number(process.env.SHUTDOWN_DRAIN_MS);
  if (Number.isFinite(raw) && raw >= 0) return raw;
  return deployed ? 5_000 : 0;
}
