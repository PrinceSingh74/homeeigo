import { describe, expect, it } from "bun:test";
import { runWithLeaderLock } from "../lib/distributed-scheduler";
import { redisClient } from "../lib/redis";
import { dbReachable } from "./helpers/adversarial-fixtures";

/**
 * Leadership must last as long as the job, not as long as the TTL. Tests run with REDIS_URL empty
 * (see .env.test), i.e. on the per-process fallback for non-exclusive keys and on the Postgres
 * advisory path for exclusive ones — exactly the two paths a Redis outage exercises in production.
 */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const key = (tag: string) => `test:lease:${tag}:${Date.now().toString(36)}`;

describe("runWithLeaderLock lease renewal", () => {
  it("a job that outlives its TTL keeps the lock because the lease is renewed", async () => {
    const k = key("renew");
    const timeline: string[] = [];
    const long = runWithLeaderLock(k, 1, async () => {
      timeline.push("A:start");
      await sleep(2_300); // > 2× TTL
      timeline.push("A:end");
    });
    await sleep(1_400); // TTL has lapsed; without renewal the key would now be free
    const contender = await runWithLeaderLock(k, 1, async () => {
      timeline.push("B:ran");
    });
    expect(contender).toBe(false);
    expect(await long).toBe(true);
    expect(timeline).toEqual(["A:start", "A:end"]);
    // Released after completion → a later run acquires normally.
    expect(await runWithLeaderLock(k, 1, async () => undefined)).toBe(true);
  });

  it("reports leadership loss to the job when a renewal fails", async () => {
    const k = key("lost");
    let observed = false;
    const original = redisClient.refreshLock.bind(redisClient);
    (redisClient as unknown as { refreshLock: typeof original }).refreshLock = async () => false;
    try {
      await runWithLeaderLock(k, 1, async (run) => {
        await sleep(900); // ≥ two renewal attempts at ttl/3
        observed = run.leadershipLost();
      });
    } finally {
      (redisClient as unknown as { refreshLock: typeof original }).refreshLock = original;
    }
    expect(observed).toBe(true);
  });
});

describe("exclusive jobs without Redis", () => {
  it("fall back to a Postgres advisory lock: two concurrent runs → exactly one executes", async () => {
    if (!(await dbReachable())) return;
    expect(redisClient.isAvailable).toBe(false); // precondition of this test
    const k = key("pg");
    let ran = 0;
    const job = () =>
      runWithLeaderLock(
        k,
        5,
        async () => {
          ran += 1;
          await sleep(700);
        },
        { exclusive: true },
      );
    const [a, b] = await Promise.all([job(), sleep(150).then(job)]);
    expect([a, b].filter(Boolean).length).toBe(1);
    expect(ran).toBe(1);
    // Serial re-run after release works.
    expect(await job()).toBe(true);
    expect(ran).toBe(2);
  });

  it("non-exclusive jobs still use the per-process fallback (idempotent work keeps running)", async () => {
    const k = key("mem");
    let ran = 0;
    expect(await runWithLeaderLock(k, 5, async () => { ran += 1; })).toBe(true);
    expect(ran).toBe(1);
  });
});
