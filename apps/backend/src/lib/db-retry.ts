import { Prisma } from "@prisma/client";
import { isRetryablePrismaError } from "./prisma-errors";

/**
 * Retry a DB operation on transient Postgres concurrency / pool errors:
 *   - P2034 — write conflict / deadlock (40001 serialization_failure, 40P01 deadlock)
 *   - P2028 — transaction API timeout
 *   - P2010 — raw query failed (deadlocks on `$queryRaw … FOR UPDATE` surface here)
 *   - P2024 — connection pool timeout (transient under burst load)
 *   - P2037 — too many database connections (transient when pool recovers)
 *
 * Safe ONLY for IDEMPOTENT transactions — the wrapped work must reach the same
 * end state if re-run (e.g. `SELECT … FOR UPDATE` + status/idempotency checks),
 * so a retry can never double-apply. Non-concurrency errors propagate immediately.
 */
export async function withTxRetry<T>(fn: () => Promise<T>, attempts = 20): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (!isRetryablePrismaError(err)) throw err;
      lastErr = err;
      // Exponential-ish jittered backoff so colliding transactions don't re-collide
      // in lockstep (the jitter is what actually breaks a 2-way deadlock).
      const base = err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2037" ? 40 : 15;
      await new Promise((r) => setTimeout(r, base * (attempt + 1) + Math.random() * 50));
    }
  }
  throw lastErr;
}
