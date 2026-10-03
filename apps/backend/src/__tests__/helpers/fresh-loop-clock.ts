import { spawnSync, type SpawnSyncOptionsWithStringEncoding, type SpawnSyncReturns } from "node:child_process";

/**
 * Refresh the clock a TIMED spawnSync measures its `timeout` from. Call it immediately before every
 * timed `spawnSync` / `Bun.spawnSync` in a test.
 *
 * Bun (1.3.14, Windows) runs spawnSync on its own private loop, and that loop's cached time is only
 * advanced by a spawnSync. The `timeout` deadline is computed from that cached time, so when the
 * PREVIOUS spawnSync in the process was longer ago than the timeout, the deadline is already in the
 * past and the child is killed at once. Turning the main event loop does not help — it is a different
 * clock. Probe, 2026-10-01 (timeout 3 s, idle gap 4.5 s):
 *
 *   first spawn in the process, and one right after it        → ok
 *   after an ASYNC gap (main loop turning the whole time)     → SIGTERM in 12 ms
 *   after a sync gap + one macrotask turn (the earlier remedy) → SIGTERM in 12 ms
 *   after a gap, an UNTIMED spawnSync first, then the timed   → ok
 *   Bun.spawnSync after a gap                                 → SIGTERM in 10 ms
 *
 * The earlier remedy here was a single `setTimeout` turn. Its probe was confounded: the spawn that
 * failed had itself refreshed the clock, so whatever ran next looked like the cure. It then failed in a
 * full run (check-ddl-guard-coverage killed in 59 ms against a 60 s budget).
 *
 * The remedy that holds is an untimed spawnSync first: it cannot be expired, and it leaves the clock
 * current for the timed call that follows. `spawn-sync-clock.test.ts` proves it for both APIs and logs
 * whether the runtime still has the defect.
 */
export function freshLoopClock(): Promise<void> {
  // No `timeout` here on purpose — a timed primer would be killed by the very defect it works around.
  spawnSync(process.execPath, ["--version"], { stdio: "ignore" });
  return Promise.resolve();
}

/** A timed spawnSync whose `timeout` is measured from now (see above). Use for every timed child in tests. */
export async function spawnSyncFreshClock(
  command: string,
  args: readonly string[],
  options: SpawnSyncOptionsWithStringEncoding,
): Promise<SpawnSyncReturns<string>> {
  await freshLoopClock();
  return spawnSync(command, args, options);
}
