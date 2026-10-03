/**
 * SECTION 7E — one scheduler INSTANCE, as a separate process.
 *
 *   DATABASE_URL=... REDIS_URL=... bun run scripts/chaos/7e-contender.ts \
 *     --run <runId> --key <lockKey> --hold <ms> --attempts <n> [--exclusive] [--gap <ms>]
 *
 * Leadership is a cross-process property, and `INSTANCE_ID` in `lib/distributed-scheduler` is
 * module-global — one per process. Two calls inside a single process therefore share an identity and
 * cannot demonstrate anything about two nodes. This is that second node.
 *
 * Every entry into the protected section is recorded as a row so the orchestrator reads DATABASE
 * evidence rather than log lines: which instance, when it entered, when it left, and whether the
 * lease was reported lost. Overlapping intervals across two instances are what a double-leadership
 * defect actually looks like, and only timestamps can show them.
 */
import { assertChaosTargetIsolated } from "../../src/lib/chaos-isolation";

assertChaosTargetIsolated("7E contender");

const argv = process.argv.slice(2);
const arg = (name: string, fallback?: string): string => {
  const i = argv.indexOf(`--${name}`);
  if (i >= 0 && argv[i + 1] && !argv[i + 1]!.startsWith("--")) return argv[i + 1]!;
  if (fallback !== undefined) return fallback;
  throw new Error(`missing --${name}`);
};
const has = (name: string) => argv.includes(`--${name}`);

const RUN = arg("run");
const LOCK_KEY = arg("key");
const HOLD_MS = Number(arg("hold", "1500"));
const ATTEMPTS = Number(arg("attempts", "3"));
const GAP_MS = Number(arg("gap", "200"));
const TTL_SEC = Number(arg("ttl", "10"));
const EXCLUSIVE = has("exclusive");
/** Staggers this instance behind another so one is provably already inside when the other arrives. */
const DELAY_MS = Number(arg("delay", "0"));
/** Retry-until-in mode: stop as soon as the lock is won, so `attempts` becomes a polling budget. */
const STOP_AFTER_ENTRIES = Number(arg("stop-after-entries", "0"));
/** Models a job that reads `run.leadershipLost()` and yields, instead of one that ignores it. */
const STOP_ON_LEASE_LOSS = has("stop-on-lease-loss");

const prisma = (await import("../../src/lib/prisma")).default;
const { runWithLeaderLock, getSchedulerInstanceId } = await import("../../src/lib/distributed-scheduler");
const { redisClient } = await import("../../src/lib/redis");

/**
 * `redisClient` does NOT connect on import — the server calls `connect()` during boot, and a script
 * that skips it gets `isAvailable === false` forever. Every lock call then silently takes the
 * per-process in-memory fallback, where two contenders each hold their own private lock and both
 * enter the section. A contention harness that skipped this would produce a textbook double-leadership
 * result out of pure harness error, so the connection is established explicitly and its outcome is
 * reported in every summary rather than assumed.
 */
const CONNECT_TIMEOUT_MS = 8000;
let redisAvailable = false;
try {
  await Promise.race([
    redisClient.connect(),
    new Promise((_, rej) => setTimeout(() => rej(new Error("connect timeout")), CONNECT_TIMEOUT_MS)),
  ]);
  redisAvailable = redisClient.isAvailable;
} catch {
  redisAvailable = false;
}
/** Tests that are only meaningful with a live Redis pass this and abort loudly instead of degrading. */
if (has("require-redis") && !redisAvailable) {
  console.error(`[contender] FATAL: --require-redis given but Redis at ${process.env.REDIS_URL} is not available`);
  process.exit(3);
}

const INSTANCE = getSchedulerInstanceId();
const JOB_TYPE = `7e-${RUN}`;

/**
 * Recorded as a `scheduled_jobs` row with status "completed" and a run-scoped `jobType`.
 *
 * Deliberately a row that the real job processor will never claim: it only claims `pending` rows
 * whose `runAt` is due, so these markers cannot be executed as work by anything. Using an existing
 * table keeps the harness from inventing a second persistence path, and every row carries the run id
 * so cleanup is exact.
 */
async function record(entry: {
  phase: "entered" | "exited" | "refused";
  startedAt?: number;
  endedAt?: number;
  leadershipLost?: boolean;
}): Promise<void> {
  await prisma.scheduledJob.create({
    data: {
      jobType: JOB_TYPE,
      runAt: new Date(),
      status: "completed",
      completedAt: new Date(),
      payload: {
        run: RUN,
        instance: INSTANCE,
        pid: process.pid,
        lockKey: LOCK_KEY,
        exclusive: EXCLUSIVE,
        /**
         * Wall-clock at the moment the row is written. The orchestrator builds each instance's
         * occupancy interval from the "entered" and "exited" marks; every process runs on this one
         * machine, so the two clocks are the same clock and the intervals are comparable.
         */
        at: Date.now(),
        ...entry,
      },
    },
  });
}

console.log(`[contender] pid=${process.pid} instance=${INSTANCE} key=${LOCK_KEY} exclusive=${EXCLUSIVE} ttl=${TTL_SEC}s`);

if (DELAY_MS > 0) await new Promise((r) => setTimeout(r, DELAY_MS));

let entries = 0;
let refusals = 0;
for (let i = 0; i < ATTEMPTS; i++) {
  const startedAt = Date.now();
  let entered = false;
  let lostSeen = false;

  const ran = await runWithLeaderLock(
    LOCK_KEY,
    TTL_SEC,
    async (run) => {
      entered = true;
      entries++;
      await record({ phase: "entered", startedAt });
      /**
       * Poll the handle the scheduler hands every job. No production caller reads it, so this is the
       * only place its value is observed under real contention.
       *
       * By DEFAULT this job keeps working after the lease is lost, because that is what every real
       * caller does: all ~25 `runWithLeaderLock` call sites pass `async () => {...}` and never touch
       * the `run` argument, and the scheduler has no way to abort `fn` itself. Modelling a job that
       * politely stops would certify a discipline the codebase does not practise.
       *
       * `--stop-on-lease-loss` models the other kind of job, so the difference between the two is
       * measured rather than asserted.
       */
      const deadline = Date.now() + HOLD_MS;
      while (Date.now() < deadline) {
        if (run.leadershipLost()) {
          lostSeen = true;
          if (STOP_ON_LEASE_LOSS) break;
        }
        await new Promise((r) => setTimeout(r, 50));
      }
      await record({ phase: "exited", startedAt, endedAt: Date.now(), leadershipLost: lostSeen });
    },
    EXCLUSIVE ? { exclusive: true } : {},
  );

  if (!ran || !entered) {
    refusals++;
    await record({ phase: "refused", startedAt, endedAt: Date.now() });
  }
  if (STOP_AFTER_ENTRIES > 0 && entries >= STOP_AFTER_ENTRIES) break;
  if (i < ATTEMPTS - 1) await new Promise((r) => setTimeout(r, GAP_MS));
}

/**
 * Counters live in this process's own registry, so the orchestrator cannot scrape them over HTTP —
 * it would be reading the :3100 server's registry, which took part in none of this. They travel back
 * the same way everything else does: as a row.
 */
const { sumCounter, sumCounterWhere } = await import("../../src/lib/metrics");
await prisma.scheduledJob.create({
  data: {
    jobType: JOB_TYPE,
    runAt: new Date(),
    status: "completed",
    completedAt: new Date(),
    payload: {
      run: RUN,
      instance: INSTANCE,
      pid: process.pid,
      lockKey: LOCK_KEY,
      exclusive: EXCLUSIVE,
      at: Date.now(),
      phase: "summary",
      entries,
      refusals,
      /** Whether this process's lock calls went to Redis at all, or to its own in-memory map. */
      redisAvailable,
      lockFallbackTotal: sumCounter("homigo_lock_fallback_total"),
      /** Separates the designed Postgres anchor for exclusive jobs from a genuine Redis outage. */
      anchorTotal: sumCounterWhere("homigo_lock_fallback_total", "exclusive_anchor"),
      redisUnavailableTotal: sumCounterWhere("homigo_lock_fallback_total", "redis_unavailable"),
      leaseLostTotal: sumCounter("homigo_lock_lease_lost_total"),
    },
  },
});

console.log(`[contender] pid=${process.pid} entries=${entries} refusals=${refusals}`);

/**
 * The open Redis socket keeps the event loop alive, so without this the process finishes its work,
 * prints its result, and then simply never exits — the orchestrator's `settle()` waits on `exited`
 * forever and the whole run appears to hang after a test that actually succeeded.
 */
await prisma.$disconnect();
/**
 * `disconnect()` calls `quit()`, which waits for a reply. Against a frozen Redis that reply never
 * comes and the process hangs forever AFTER completing and reporting all of its work — which is how
 * a Redis-down scenario turned into a silent stall of the whole suite rather than a result. The
 * shutdown is bounded and then abandoned; the work is already durable in the database.
 */
await Promise.race([redisClient.disconnect().catch(() => {}), new Promise((r) => setTimeout(r, 2000))]);
process.exit(0);
