/**
 * Backpressure for booking reschedule — caps concurrent DB transactions so burst
 * load cannot exhaust the Prisma/Postgres connection pool (P2037).
 */
const MAX_INFLIGHT = Math.max(
  4,
  Number(process.env.RESCHEDULE_MAX_INFLIGHT ?? process.env.PRISMA_RESCHEDULE_CONCURRENCY ?? 32),
);

let inFlight = 0;
const waiters: Array<() => void> = [];

function acquire(): Promise<void> {
  if (inFlight < MAX_INFLIGHT) {
    inFlight++;
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    waiters.push(() => {
      inFlight++;
      resolve();
    });
  });
}

function release(): void {
  inFlight = Math.max(0, inFlight - 1);
  const next = waiters.shift();
  if (next) next();
}

export function rescheduleGateStats(): { inFlight: number; max: number; queued: number } {
  return { inFlight, max: MAX_INFLIGHT, queued: waiters.length };
}

export async function withRescheduleGate<T>(fn: () => Promise<T>): Promise<T> {
  await acquire();
  try {
    return await fn();
  } finally {
    release();
  }
}
