/**
 * OAuth state store (2026-10-01).
 *
 * Three defects this pins:
 *  1. The store was a per-process Map, so a sign-in whose authorize and callback reached different
 *     instances always failed. It now lives in Redis when Redis can be asked.
 *  2. `POST /api/auth/google/authorize` needs no login and stored any client-supplied string for ten
 *     minutes, with no bound on its size or on the number kept. The state now has a fixed shape and
 *     the process-local fallback is capped.
 *  3. A state is single-use, also across instances (one atomic read-and-delete).
 */
import "../load-env";
import { afterEach, describe, expect, spyOn, test } from "bun:test";
import crypto from "crypto";
import app from "../index";
import { redisClient } from "../lib/redis";
import {
  MAX_LOCAL_OAUTH_STATES,
  OAuthStateError,
  localOAuthStateCountForTests,
  oauthStateService,
  resetLocalOAuthStatesForTests,
} from "../services/oauth-state.service";

afterEach(() => {
  resetLocalOAuthStatesForTests();
});

/** Stands in for one Redis shared by every instance: set-with-ttl and atomic take. */
function shareOneRedis() {
  const shared = new Map<string, string>();
  const set = spyOn(redisClient, "set").mockImplementation(async (key: string, value: string) => {
    shared.set(key, value);
    return true;
  });
  const take = spyOn(redisClient, "take").mockImplementation(async (key: string) => {
    const value = shared.get(key) ?? null;
    shared.delete(key);
    return { answered: true as const, value };
  });
  return { shared, restore: () => { set.mockRestore(); take.mockRestore(); } };
}

/** What a second instance looks like to the first one's pending sign-ins: none of its memory. */
const becomeAnotherInstance = resetLocalOAuthStatesForTests;

describe("OAuth state — single use", () => {
  test("an issued state is accepted once and then refused", async () => {
    const state = await oauthStateService.issue("google");
    expect(await oauthStateService.consume("google", state)).toBe(true);
    expect(await oauthStateService.consume("google", state)).toBe(false);
  });

  test("a state nobody issued, or issued for the other provider, is refused", async () => {
    expect(await oauthStateService.consume("google", crypto.randomUUID())).toBe(false);
    const state = await oauthStateService.issue("google");
    expect(await oauthStateService.consume("apple", state)).toBe(false);
    expect(await oauthStateService.consume("google", null)).toBe(false);
  });
});

describe("OAuth state — bounded", () => {
  test("a state outside the allowed shape is refused before anything is stored", async () => {
    for (const bad of ["short", "has space in it", "x".repeat(129), "a".repeat(300_000), "<script>alert(1)</script>"]) {
      await expect(oauthStateService.issue("google", bad)).rejects.toBeInstanceOf(OAuthStateError);
    }
    expect(localOAuthStateCountForTests()).toBe(0);
  });

  test("the process-local store never exceeds its cap; the oldest pending sign-in is the one dropped", async () => {
    const first = await oauthStateService.issue("google");
    let last = first;
    for (let i = 0; i < MAX_LOCAL_OAUTH_STATES + 25; i++) last = await oauthStateService.issue("google");
    expect(localOAuthStateCountForTests()).toBe(MAX_LOCAL_OAUTH_STATES);
    expect(await oauthStateService.consume("google", last)).toBe(true);
    expect(await oauthStateService.consume("google", first)).toBe(false);
  });

  test("the authorize route refuses an oversized state and stores nothing", async () => {
    const res = await app.handle(
      new Request("http://localhost/api/auth/google/authorize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state: "s".repeat(5_000) }),
      }),
    );
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(localOAuthStateCountForTests()).toBe(0);
  });

  test("the callback route refuses a state this API never issued", async () => {
    const res = await app.handle(
      new Request("http://localhost/api/auth/google/callback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: "attacker-code", state: crypto.randomUUID() }),
      }),
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code?: string }).code).toBe("INVALID_CODE");
  });
});

describe("OAuth state — across instances", () => {
  test("control: without a shared store, the instance that did not issue the state refuses it", async () => {
    const state = await oauthStateService.issue("google");
    becomeAnotherInstance();
    expect(await oauthStateService.consume("google", state)).toBe(false);
  });

  test("with Redis, a state issued on one instance is accepted on another — once", async () => {
    const redis = shareOneRedis();
    try {
      const state = await oauthStateService.issue("google");
      expect(localOAuthStateCountForTests()).toBe(0); // it went to the shared store, not this process
      becomeAnotherInstance();
      expect(await oauthStateService.consume("google", state)).toBe(true);
      expect(await oauthStateService.consume("google", state)).toBe(false);
      expect(redis.shared.size).toBe(0);
    } finally {
      redis.restore();
    }
  });

  test("a state issued while Redis was down is still honoured by the instance that issued it", async () => {
    const state = await oauthStateService.issue("google"); // test runtime has no Redis → local store
    const redis = shareOneRedis(); // Redis comes back and knows nothing of that state
    try {
      expect(await oauthStateService.consume("google", state)).toBe(true);
    } finally {
      redis.restore();
    }
  });
});
