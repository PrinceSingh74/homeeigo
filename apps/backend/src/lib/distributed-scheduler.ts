import crypto from "crypto";
import type { PrismaClient } from "@prisma/client";
import { redisClient } from "./redis";
import { logger } from "./logger";
import { incCounter, setGauge } from "./metrics";
import { createDedicatedPoolClient } from "./prisma-base";

const INSTANCE_ID = `inst_${crypto.randomBytes(6).toString("hex")}`;

/**
 * Leader-lock anchors live on their OWN small pool.
 *
 * Each anchor holds one connection open for its whole run (see holdAdvisoryAnchor). They used to take
 * it from the request pool: with nine exclusive jobs on independent timers and a pool of 5, boot
 * pinned every connection in anchors while the jobs' own queries waited for one — a 30 s pool deadlock
 * with /ready 503 (measured 2026-09-30; a pool of 15 merely hid it). A separate pool makes anchors
 * unable to starve requests or the jobs they guard, whatever the request pool size.
 *
 * Sized to cover every exclusive job at once (9 today) so no anchor has to wait for another. If it is
 * ever exhausted, the waiting anchor gives up after `pool_timeout` and the job runs on its Redis lease
 * alone, or skips the tick when Redis is down too — the existing fail-closed path, never a hang.
 */
const ANCHOR_POOL_SIZE = Math.max(1, Number(process.env.LEADER_ANCHOR_POOL_SIZE ?? 10));
const ANCHOR_POOL_TIMEOUT_SEC = 5;
let anchorClient: PrismaClient | null = null;
function anchorDb(): PrismaClient {
  anchorClient ??= createDedicatedPoolClient(ANCHOR_POOL_SIZE, ANCHOR_POOL_TIMEOUT_SEC);
  return anchorClient;
}
let anchorsHeld = 0;

/** Closes the anchor pool (graceful shutdown / tests). A later anchor reopens it. */
export async function disconnectLeaderAnchors(): Promise<void> {
  const c = anchorClient;
  anchorClient = null;
  await c?.$disconnect();
}

export type LeaderLockOptions = {
  /**
   * The job must never run on two nodes at once (it moves money, calls a gateway, spawns a backup).
   * When Redis cannot arbitrate, an exclusive job takes a Postgres transaction-scoped advisory
   * lock instead of the per-process fallback; Postgres is the system of record and is up whenever
   * the job could do anything at all. Non-exclusive jobs keep the per-process fallback because
   * they are idempotent (SKIP LOCKED claims, deleteMany-by-cutoff, pure recomputes).
   */
  exclusive?: boolean;
};

export type LeaderLockRun = {
  /** Set when a lease renewal failed: another node may now be leader. Long jobs should stop early. */
  leadershipLost: () => boolean;
};

/**
 * Run a maintenance task on exactly one instance.
 *
 * The lease is renewed every ttl/3 while `fn` runs, so `ttlSec` bounds how long a crashed holder
 * blocks the next tick — not how long the job may run. Before this, the TTL was the only bound and
 * four jobs (outbox 10 s, scheduled jobs 15 s, ops alerts 18 s, refund retry 240 s) could outlive it.
 */
export async function runWithLeaderLock(
  lockKey: string,
  ttlSec: number,
  fn: (run: LeaderLockRun) => Promise<void>,
  opts: LeaderLockOptions = {},
): Promise<boolean> {
  const token = `${INSTANCE_ID}_${crypto.randomBytes(4).toString("hex")}`;

  let redisHeld: boolean;
  let anchor: AdvisoryAnchor | null = null;

  if (opts.exclusive) {
    /**
     * An exclusive job is guarded by TWO independent things at once, and a second instance has to
     * get past both. Each covers the case where the other fails, and neither is sufficient alone:
     *
     *  - The Redis lease, renewed every ttl/3, is what lets a job run longer than its TTL. It is the
     *    only guard that survives a job outliving the anchor's transaction deadline.
     *  - The Postgres advisory lock, held inside an open transaction, is what survives Redis. A lease
     *    lapses when renewal fails for longer than `ttlSec` — a freeze, a failover, a partition — and
     *    the next instance's SET NX then succeeds while the first is still working. Measured on the
     *    Redis-only design, that was two instances inside the same job for ~2.1 s, in jobs whose whole
     *    reason for declaring `exclusive` is that this must never happen.
     *
     * Detection alone was never enough: `leadershipLost()` did flip, but the platform cannot abort
     * `fn` and no production caller reads the handle, so nothing acted on it. Exclusivity has to be
     * something a successor runs into, not something the predecessor is politely told about.
     */
    const res = await redisClient.tryAcquireDistributedLock(lockKey, token, ttlSec);
    if (res === "held") return false;
    redisHeld = res === "acquired";

    anchor = await holdAdvisoryAnchor(lockKey, Math.max(60_000, ttlSec * 1000));
    if (anchor.state === "held-by-other") {
      // Redis said the key was free but Postgres says someone is still inside — that is precisely
      // the lapsed-lease case, and the anchor is the guard that catches it.
      if (redisHeld) await redisClient.releaseLock(lockKey, token);
      return false;
    }
    if (anchor.state === "unavailable" && !redisHeld) {
      // Neither arbiter can answer. Failing closed keeps every node from electing itself.
      incCounter("homigo_lock_fallback_total", { key: lockKey, reason: "no_arbiter" });
      logger.error("leader_no_arbiter", { lockKey, instance: INSTANCE_ID });
      return false;
    }
    incCounter("homigo_lock_fallback_total", {
      key: lockKey,
      reason: redisHeld ? "exclusive_anchor" : "redis_unavailable",
    });
  } else {
    redisHeld = await redisClient.acquireLock(lockKey, token, ttlSec);
    if (!redisHeld) return false;
  }

  let leaseLost = !redisHeld;
  const renewEveryMs = Math.max(250, Math.floor((ttlSec * 1000) / 3));
  const renewal = redisHeld
    ? setInterval(() => {
        void redisClient.refreshLock(lockKey, token, ttlSec).then((ok) => {
          if (ok || leaseLost) return;
          leaseLost = true;
          incCounter("homigo_lock_lease_lost_total", { key: lockKey });
          logger.error("leader_lease_lost", { lockKey, instance: INSTANCE_ID });
        });
      }, renewEveryMs)
    : null;
  renewal?.unref?.();

  /**
   * Leadership is lost only when every guard this run actually holds has gone. Reporting it as lost
   * while one still stands would send long jobs into their abort path during an ordinary Redis blip
   * that never put exclusivity at risk.
   */
  const leadershipLost = () => (anchor ? leaseLost && anchor.lost() : leaseLost);

  try {
    await fn({ leadershipLost });
    return true;
  } catch (err) {
    logger.error("scheduled_job_failed", {
      lockKey,
      error: err instanceof Error ? err.message : String(err),
    });
    return true;
  } finally {
    if (renewal) clearInterval(renewal);
    anchor?.release();
    // The lock is granted until the transaction commits, which is after release() returns.
    await anchor?.released;
    if (redisHeld) await redisClient.releaseLock(lockKey, token);
  }
}

/**
 * Holds a Postgres advisory lock for as long as the caller wants it, and reports when it is gone.
 *
 * `pg_try_advisory_xact_lock` lives and dies with its transaction, so the transaction is opened, the
 * lock taken, and then the callback simply waits until `release()` is called. That is what makes this
 * guard impossible to lapse silently the way a TTL can: it is tied to a connection, not to a clock.
 *
 * It has one bound of its own. Prisma rolls the transaction back at `timeoutMs`, releasing the lock,
 * and cannot abort the caller's work — so beyond that deadline this guard is gone. `lost()` reports
 * exactly that, which is why it is only ever one of two guards and never the only one.
 *
 * The transaction holds one connection of the dedicated anchor pool (anchorDb) for the duration; the
 * job's own queries use the request client and its pool, which anchors never touch.
 */
type AdvisoryAnchor = {
  state: "acquired" | "held-by-other" | "unavailable";
  /** Ends the transaction, releasing the lock. Safe to call repeatedly, and safe after it has ended. */
  release: () => void;
  /**
   * Resolves only after that transaction has finished. `release()` merely unblocks the callback;
   * the advisory lock stays granted until Postgres commits, so a caller that returns before this
   * promise still looks like it holds the lock.
   */
  released: Promise<void>;
  /** True once this guard no longer holds — released, rolled back at its deadline, or never taken. */
  lost: () => boolean;
};

function holdAdvisoryAnchor(lockKey: string, timeoutMs: number): Promise<AdvisoryAnchor> {
  return new Promise<AdvisoryAnchor>((resolve) => {
    let releaseHold: () => void = () => {};
    const untilReleased = new Promise<void>((r) => {
      releaseHold = r;
    });
    let markReleased: () => void = () => {};
    const released = new Promise<void>((r) => {
      markReleased = r;
    });
    let ended = false;
    let settled = false;
    const settle = (anchor: AdvisoryAnchor) => {
      if (settled) return;
      settled = true;
      resolve(anchor);
    };

    void anchorDb()
      .$transaction(
        async (tx) => {
          const rows = await tx.$queryRaw<Array<{ locked: boolean }>>`
            SELECT pg_try_advisory_xact_lock(hashtext(${"leader:" + lockKey})) AS locked
          `;
          if (!rows[0]?.locked) {
            settle({ state: "held-by-other", release: () => {}, released: Promise.resolve(), lost: () => true });
            return;
          }
          // Resolving from inside the transaction hands the caller a live lock: the transaction stays
          // open, and therefore the lock stays held, until the caller releases it.
          anchorsHeld++;
          setGauge("homigo_leader_anchors_held", anchorsHeld);
          settle({ state: "acquired", release: releaseHold, released, lost: () => ended });
          try {
            await untilReleased;
          } finally {
            anchorsHeld--;
            setGauge("homigo_leader_anchors_held", anchorsHeld);
          }
        },
        { timeout: timeoutMs, maxWait: ANCHOR_POOL_TIMEOUT_SEC * 1000 },
      )
      .catch((err) => {
        const code = (err as { code?: string } | null)?.code;
        // P2028 is the deadline; anything else means the transaction could not be held at all.
        logger.error("leader_anchor_ended", {
          lockKey,
          instance: INSTANCE_ID,
          reason: code === "P2028" ? "deadline" : "error",
          error: err instanceof Error ? err.message : String(err),
        });
      })
      .finally(() => {
        ended = true;
        markReleased();
        // Only reached before `settle` if the transaction never got far enough to answer.
        settle({ state: "unavailable", release: () => {}, released, lost: () => true });
      });
  });
}

export function getSchedulerInstanceId(): string {
  return INSTANCE_ID;
}
