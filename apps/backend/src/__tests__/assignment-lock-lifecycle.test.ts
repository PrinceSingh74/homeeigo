/**
 * Pass 11 — assignment processor lock lifecycle (in-memory fallback path).
 * Proves acquire → work → release, TTL expiry, stale owner denial, and tick deadline.
 */
import "../load-env";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "crypto";
import { redisClient, resetMemoryLocksForTests } from "../lib/redis";
import { assignmentEngine } from "../services/assignment-engine.service";

const LOCK_KEY = "assignment:processor";

describe.serial("assignment lock lifecycle (Pass 11)", () => {
  beforeEach(() => resetMemoryLocksForTests());
  afterEach(() => resetMemoryLocksForTests());

  test("CASE 1 — processQueue acquires then releases (probe succeeds)", async () => {
    const result = await assignmentEngine.processQueue();
    expect(typeof result.processed).toBe("number");
    expect(typeof result.dispatched).toBe("number");
    const probe = await redisClient.acquireLock(LOCK_KEY, "case1-probe", 5);
    expect(probe).toBe(true);
    await redisClient.releaseLock(LOCK_KEY, "case1-probe");
  }, 90_000);

  test("CASE 2 — held foreign lock blocks processQueue; release restores access", async () => {
    expect(await redisClient.acquireLock(LOCK_KEY, "foreign", 30)).toBe(true);
    const blocked = await assignmentEngine.processQueue();
    expect(blocked).toEqual({ processed: 0, dispatched: 0 });
    await redisClient.releaseLock(LOCK_KEY, "foreign");
    const after = await assignmentEngine.processQueue();
    expect(after).toBeDefined();
    expect(await redisClient.acquireLock(LOCK_KEY, "case2-probe", 5)).toBe(true);
    await redisClient.releaseLock(LOCK_KEY, "case2-probe");
  }, 90_000);

  test("CASE 5/6 — lock expires → new owner acquires; stale token cannot refresh", async () => {
    const stale = "stale-owner";
    expect(await redisClient.acquireLock(LOCK_KEY, stale, 1)).toBe(true);
    await new Promise((r) => setTimeout(r, 1100));
    expect(await redisClient.refreshLock(LOCK_KEY, stale, 5)).toBe(false);
    const successor = "successor";
    expect(await redisClient.acquireLock(LOCK_KEY, successor, 5)).toBe(true);
    expect(await redisClient.refreshLock(LOCK_KEY, stale, 5)).toBe(false);
    expect(await redisClient.refreshLock(LOCK_KEY, successor, 5)).toBe(true);
    await redisClient.releaseLock(LOCK_KEY, stale); // must not clear successor
    expect(await redisClient.refreshLock(LOCK_KEY, successor, 5)).toBe(true);
    await redisClient.releaseLock(LOCK_KEY, successor);
  });

  test("CASE 7/8 — wrong token refresh denied; wrong token release is a no-op", async () => {
    const owner = randomUUID();
    expect(await redisClient.acquireLock(LOCK_KEY, owner, 10)).toBe(true);
    expect(await redisClient.refreshLock(LOCK_KEY, "intruder", 10)).toBe(false);
    await redisClient.releaseLock(LOCK_KEY, "intruder");
    expect(await redisClient.refreshLock(LOCK_KEY, owner, 10)).toBe(true);
    await redisClient.releaseLock(LOCK_KEY, owner);
    expect(await redisClient.acquireLock(LOCK_KEY, "next", 5)).toBe(true);
    await redisClient.releaseLock(LOCK_KEY, "next");
  });

  test("CASE 3-ish — two sequential processQueue calls leave no leaked lock", async () => {
    const t0 = Date.now();
    await assignmentEngine.processQueue();
    const mid = Date.now();
    await assignmentEngine.processQueue();
    const t1 = Date.now();
    // Tick deadline (~20s) must keep each call bounded well under lock TTL storms.
    expect(mid - t0).toBeLessThan(45_000);
    expect(t1 - mid).toBeLessThan(45_000);
    expect(await redisClient.acquireLock(LOCK_KEY, "seq-probe", 5)).toBe(true);
    await redisClient.releaseLock(LOCK_KEY, "seq-probe");
  }, 120_000);
});
