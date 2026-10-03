/**
 * Pure unit tests — run with `npm run test:unit` (Node's built-in test runner; no device, no DB).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyRefreshResponse,
  createRefreshCoordinator,
  sendWithAuthRetry,
  type RefreshOutcome,
} from "../auth-refresh.ts";

type Res = { status: number; token: string | null };

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

test("single-flight: concurrent refresh() calls share one underlying refresh", async () => {
  let calls = 0;
  const gate = deferred<RefreshOutcome>();
  const c = createRefreshCoordinator(() => {
    calls += 1;
    return gate.promise;
  });
  const a = c.refresh();
  const b = c.refresh();
  const d = c.refresh();
  assert.equal(c.inFlight(), true);
  gate.resolve({ kind: "refreshed", accessToken: "new" });
  const results = await Promise.all([a, b, d]);
  assert.equal(calls, 1);
  for (const r of results) assert.deepEqual(r, { kind: "refreshed", accessToken: "new" });
  // After settling, a later refresh is a NEW refresh.
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(c.inFlight(), false);
  void c.refresh();
  assert.equal(calls, 2);
});

test("a thrown refresh is 'unavailable', never 'rejected' (network is not revocation)", async () => {
  const c = createRefreshCoordinator(async () => {
    throw new TypeError("Network request failed");
  });
  assert.deepEqual(await c.refresh(), { kind: "unavailable" });
});

test("concurrent 401s: one refresh, each request retried exactly once with the new token", async () => {
  let token: string | null = "old";
  let refreshCalls = 0;
  const gate = deferred<void>();
  const coordinator = createRefreshCoordinator(async () => {
    refreshCalls += 1;
    await gate.promise;
    token = "new";
    return { kind: "refreshed", accessToken: "new" };
  });
  const sends: Array<string | null> = [];
  const make = () =>
    sendWithAuthRetry<Res>({
      send: async (t) => {
        sends.push(t);
        return { status: t === "new" ? 200 : 401, token: t };
      },
      isUnauthorized: (r) => r.status === 401,
      getAccessToken: () => token,
      refresh: () => coordinator.refresh(),
      onSessionRejected: () => assert.fail("must not log out"),
      allowRefresh: true,
    });
  const p = Promise.all([make(), make(), make()]);
  await new Promise((r) => setTimeout(r, 0));
  gate.resolve();
  const results = await p;
  assert.equal(refreshCalls, 1);
  assert.deepEqual(
    results.map((r) => r.status),
    [200, 200, 200],
  );
  // 3 originals + 3 retries, never more.
  assert.equal(sends.length, 6);
  assert.equal(sends.filter((t) => t === "old").length, 3);
  assert.equal(sends.filter((t) => t === "new").length, 3);
});

test("at most one retry: a 401 after a successful refresh is returned, not looped", async () => {
  let sends = 0;
  let refreshes = 0;
  const res = await sendWithAuthRetry<Res>({
    send: async (t) => {
      sends += 1;
      return { status: 401, token: t };
    },
    isUnauthorized: (r) => r.status === 401,
    getAccessToken: () => "old",
    refresh: async () => {
      refreshes += 1;
      return { kind: "refreshed", accessToken: "new" };
    },
    onSessionRejected: () => undefined,
    allowRefresh: true,
  });
  assert.equal(res.status, 401);
  assert.equal(sends, 2);
  assert.equal(refreshes, 1);
});

test("refresh rejected: session torn down, original 401 returned, no retry", async () => {
  let rejectedCalls = 0;
  let sends = 0;
  const res = await sendWithAuthRetry<Res>({
    send: async (t) => {
      sends += 1;
      return { status: 401, token: t };
    },
    isUnauthorized: (r) => r.status === 401,
    getAccessToken: () => "old",
    refresh: async () => ({ kind: "rejected" }),
    onSessionRejected: () => {
      rejectedCalls += 1;
    },
    allowRefresh: true,
  });
  assert.equal(res.status, 401);
  assert.equal(sends, 1);
  assert.equal(rejectedCalls, 1);
});

test("refresh unavailable (offline / 5xx): session kept, original 401 returned", async () => {
  let rejectedCalls = 0;
  const res = await sendWithAuthRetry<Res>({
    send: async (t) => ({ status: 401, token: t }),
    isUnauthorized: (r) => r.status === 401,
    getAccessToken: () => "old",
    refresh: async () => ({ kind: "unavailable" }),
    onSessionRejected: () => {
      rejectedCalls += 1;
    },
    allowRefresh: true,
  });
  assert.equal(res.status, 401);
  assert.equal(rejectedCalls, 0);
});

test("auth endpoints never refresh (no recursion on /api/auth/refresh or login)", async () => {
  let refreshes = 0;
  const res = await sendWithAuthRetry<Res>({
    send: async (t) => ({ status: 401, token: t }),
    isUnauthorized: (r) => r.status === 401,
    getAccessToken: () => "old",
    refresh: async () => {
      refreshes += 1;
      return { kind: "refreshed", accessToken: "new" };
    },
    onSessionRejected: () => undefined,
    allowRefresh: false,
  });
  assert.equal(res.status, 401);
  assert.equal(refreshes, 0);
});

test("anonymous 401 (no token held) does not refresh", async () => {
  let refreshes = 0;
  await sendWithAuthRetry<Res>({
    send: async (t) => ({ status: 401, token: t }),
    isUnauthorized: (r) => r.status === 401,
    getAccessToken: () => null,
    refresh: async () => {
      refreshes += 1;
      return { kind: "rejected" };
    },
    onSessionRejected: () => undefined,
    allowRefresh: true,
  });
  assert.equal(refreshes, 0);
});

test("token already rotated by another request: retry with it, no second refresh", async () => {
  let token = "old";
  let refreshes = 0;
  const res = await sendWithAuthRetry<Res>({
    send: async (t) => {
      if (t === "old") token = "rotated"; // another request refreshed while this one was in flight
      return { status: t === "rotated" ? 200 : 401, token: t };
    },
    isUnauthorized: (r) => r.status === 401,
    getAccessToken: () => token,
    refresh: async () => {
      refreshes += 1;
      return { kind: "refreshed", accessToken: "x" };
    },
    onSessionRejected: () => undefined,
    allowRefresh: true,
  });
  assert.equal(res.status, 200);
  assert.equal(res.token, "rotated");
  assert.equal(refreshes, 0);
});

test("classifyRefreshResponse matches the backend /api/auth/refresh contract", () => {
  assert.deepEqual(
    classifyRefreshResponse(200, {
      success: true,
      data: { accessToken: "a", refreshToken: "r", sessionId: "s", expiresIn: 3600 },
    }),
    { kind: "ok", accessToken: "a", refreshToken: "r", sessionId: "s" },
  );
  assert.deepEqual(
    classifyRefreshResponse(401, { success: false, error: "Invalid or expired refresh token", code: "INVALID_TOKEN" }),
    { kind: "rejected" },
  );
  assert.deepEqual(classifyRefreshResponse(400, null), { kind: "rejected" });
  assert.deepEqual(classifyRefreshResponse(503, null), { kind: "unavailable" });
  assert.deepEqual(classifyRefreshResponse(429, null), { kind: "unavailable" });
  assert.deepEqual(classifyRefreshResponse(0, null), { kind: "unavailable" });
  // 200 without tokens is a broken server, not a revoked session.
  assert.deepEqual(classifyRefreshResponse(200, { success: true, data: {} }), { kind: "unavailable" });
});
