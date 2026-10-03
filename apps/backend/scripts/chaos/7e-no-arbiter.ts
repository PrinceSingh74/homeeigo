/**
 * SECTION 7E — positive control for the `no_arbiter` path and the alert that watches it.
 *
 *   DATABASE_URL="<test>?connection_limit=1" REDIS_URL=... bun run scripts/chaos/7e-no-arbiter.ts --key <lockKey>
 *
 * The fix added a branch: an exclusive job refuses to run when NEITHER Redis nor Postgres can
 * arbitrate, incrementing `homigo_lock_fallback_total{reason="no_arbiter"}` and firing the
 * LockNoArbiter alert. A branch nobody can reach and an alert that cannot fire are the same thing as
 * no branch and no alert, so this drives the condition deliberately: Redis frozen by the caller, and
 * the connection pool pinned to one connection that is already held open by a transaction, so the
 * anchor's own `$transaction` cannot get a connection and times out at `maxWait`.
 *
 * Results come back on stdout rather than as database rows. Every other scenario in 7E reports
 * through the database on purpose, but this one makes the database unreachable to the process under
 * test — a row write here would either block or quietly prove the pool was not exhausted after all.
 */
import { assertChaosTargetIsolated } from "../../src/lib/chaos-isolation";

assertChaosTargetIsolated("7E no-arbiter control");

const argv = process.argv.slice(2);
const arg = (name: string, fallback?: string): string => {
  const i = argv.indexOf(`--${name}`);
  if (i >= 0 && argv[i + 1] && !argv[i + 1]!.startsWith("--")) return argv[i + 1]!;
  if (fallback !== undefined) return fallback;
  throw new Error(`missing --${name}`);
};

const LOCK_KEY = arg("key");
const HOLD_POOL_MS = Number(arg("hold-pool", "25000"));

const prisma = (await import("../../src/lib/prisma")).default;
const { redisClient } = await import("../../src/lib/redis");
const { runWithLeaderLock } = await import("../../src/lib/distributed-scheduler");
const { sumCounterWhere } = await import("../../src/lib/metrics");

// Redis is already frozen by the caller; this connect attempt is expected to fail, and a success
// would mean the scenario is not set up and the result below would be meaningless.
await Promise.race([
  redisClient.connect().catch(() => {}),
  new Promise((r) => setTimeout(r, 6000)),
]);
const redisUp = redisClient.isAvailable;

/**
 * Pins the single pooled connection. The sleep runs server-side, so the connection is genuinely busy
 * rather than merely checked out by an idle client.
 */
let poolPinned = false;
const pinning = prisma
  .$transaction(
    async (tx) => {
      await tx.$queryRawUnsafe(`SELECT pg_sleep(${Math.ceil(HOLD_POOL_MS / 1000)})`);
    },
    { timeout: HOLD_POOL_MS + 10_000, maxWait: 10_000 },
  )
  .catch(() => {});

// Give the pin time to actually take the connection before the lock attempt asks for one.
await new Promise((r) => setTimeout(r, 2500));
poolPinned = true;

let jobRan = false;
const acquired = await runWithLeaderLock(
  LOCK_KEY,
  30,
  async () => {
    jobRan = true;
  },
  { exclusive: true },
);

const result = {
  redisUp,
  poolPinned,
  acquired,
  jobRan,
  noArbiter: sumCounterWhere("homigo_lock_fallback_total", "no_arbiter"),
  exclusiveAnchor: sumCounterWhere("homigo_lock_fallback_total", "exclusive_anchor"),
  redisUnavailable: sumCounterWhere("homigo_lock_fallback_total", "redis_unavailable"),
};
console.log(`RESULT ${JSON.stringify(result)}`);

void pinning;
process.exit(0);
