/**
 * Singleton JWT refresh coordinator. Concurrent 401 responses share one in-flight
 * refresh so we never issue parallel /api/auth/refresh calls (refresh storms).
 */
let refreshInFlight: Promise<boolean> | null = null;

export async function coordinatedRefresh(doRefresh: () => Promise<boolean>): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = doRefresh().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

/** Test-only reset. */
export function resetRefreshCoordinator(): void {
  refreshInFlight = null;
}
