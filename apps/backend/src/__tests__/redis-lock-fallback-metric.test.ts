/**
 * P1-5 — Redis leader-lock fallback visibility.
 *
 * Every leader-locked maintenance job falls back to `memAcquireLock`/`memReleaseLock` (an
 * in-process-only mutex) when Redis is unavailable — correct and safe on a single instance, but on
 * N instances every one independently falls back to its OWN in-memory lock, silently losing
 * cross-instance mutual exclusion with no external signal that coordination has degraded. Added a
 * `homigo_lock_fallback_total{key,reason}` counter so this is observable instead of silent.
 *
 * `.env.test` deliberately leaves REDIS_URL empty for test isolation, so `redisClient.isAvailable`
 * is genuinely false here — this test exercises the real "redis_unavailable" fallback path, not a
 * simulation of it.
 */
import "../load-env";
import { describe, test, expect } from "bun:test";
import { redisClient } from "../lib/redis";
import { sumCounterWhere } from "../lib/metrics";

describe("P1-5 — lock fallback observability", () => {
  test("Redis is genuinely unavailable in this test env (real, not simulated)", () => {
    expect(redisClient.isAvailable).toBe(false);
  });

  test("acquireLock via the in-memory fallback increments homigo_lock_fallback_total, and still works correctly", async () => {
    const key = `p15-test-${Date.now()}`;
    const before = sumCounterWhere("homigo_lock_fallback_total", `key=${key}`);

    const token1 = "token-a";
    const acquired1 = await redisClient.acquireLock(key, token1, 5);
    expect(acquired1).toBe(true);

    const after = sumCounterWhere("homigo_lock_fallback_total", `key=${key}`);
    expect(after).toBe(before + 1);

    // Functional regression: fallback locking must still correctly exclude a second acquirer.
    const token2 = "token-b";
    const acquired2 = await redisClient.acquireLock(key, token2, 5);
    expect(acquired2).toBe(false);

    await redisClient.releaseLock(key, token1);
    const acquired3 = await redisClient.acquireLock(key, token2, 5);
    expect(acquired3).toBe(true); // released cleanly, a new holder can now acquire

    await redisClient.releaseLock(key, token2);
  });

  test("each acquireLock call while unavailable increments the counter exactly once", async () => {
    const key = `p15-count-${Date.now()}`;
    const before = sumCounterWhere("homigo_lock_fallback_total", `key=${key}`);

    await redisClient.acquireLock(key, "t1", 1);
    await redisClient.releaseLock(key, "t1");
    await redisClient.acquireLock(key, "t2", 1);
    await redisClient.releaseLock(key, "t2");
    await redisClient.acquireLock(key, "t3", 1);
    await redisClient.releaseLock(key, "t3");

    const after = sumCounterWhere("homigo_lock_fallback_total", `key=${key}`);
    expect(after).toBe(before + 3);
  });
});
