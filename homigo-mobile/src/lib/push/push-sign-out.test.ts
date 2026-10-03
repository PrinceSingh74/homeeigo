/**
 * Sign-out unlinks this device's push token (bun logic suite — see package.json "test:logic").
 *
 * Drives the REAL auth store and the REAL api client against a fake server; only the native leaves
 * (storage, SecureStore, device id, telemetry) are stubbed — the same leaves
 * `src/lib/auth/refresh-single-flight.test.ts` stubs.
 *
 * Why this matters: the server's POST /api/auth/logout only deactivates push devices for
 * `allDevices` or a body `deviceId` sent WITHOUT a refresh token (apps/backend/src/routes/auth.ts);
 * the app sends a refresh token, so that path never unlinks the device. The explicit
 * DELETE /api/users/me/devices/:deviceId is the only unlink — and it needs the access token that
 * `clearSession()` drops. Without it a signed-out phone keeps receiving the account's pushes.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";

type StoreModule = typeof import("@/stores/auth-store");

const BASE = "http://push-sign-out.test";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Seen = { method: string; path: string; bearer: string };
const seen: Seen[] = [];
const events: string[] = [];
const server = {
  /** Access tokens the fake server accepts. */
  validAccess: new Set<string>(["at-live"]),
  unlinkDelayMs: 0,
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

async function fakeFetch(input: unknown, init?: { method?: string; headers?: Record<string, string> }): Promise<Response> {
  const url = new URL(String(input));
  const bearer = (init?.headers?.Authorization ?? "").replace("Bearer ", "") || "-";
  const method = init?.method ?? "GET";
  seen.push({ method, path: url.pathname, bearer });
  events.push(`fetch:${method}:${url.pathname}:${bearer}`);
  if (url.pathname === "/api/auth/refresh") {
    return json(401, { success: false, code: "INVALID_TOKEN" });
  }
  if (url.pathname.startsWith("/api/users/me/devices/") && method === "DELETE") {
    if (server.unlinkDelayMs > 0) await sleep(server.unlinkDelayMs);
    events.push("unlink:done");
    if (!server.validAccess.has(bearer)) return json(401, { success: false, code: "UNAUTHORIZED" });
    return json(200, { success: true, message: "Device push token revoked" });
  }
  if (url.pathname === "/api/auth/logout") {
    return json(bearer === "-" ? 401 : 200, { success: bearer !== "-" });
  }
  return json(404, { success: false });
}

let store: StoreModule;
const realFetch = globalThis.fetch;

beforeAll(async () => {
  (globalThis as unknown as { __DEV__: boolean }).__DEV__ = false;
  globalThis.fetch = fakeFetch as unknown as typeof fetch;

  const memory = new Map<string, string>();
  mock.module("@react-native-async-storage/async-storage", () => ({
    default: {
      getItem: async (k: string) => memory.get(k) ?? null,
      setItem: async (k: string, v: string) => void memory.set(k, v),
      removeItem: async (k: string) => void memory.delete(k),
    },
  }));
  mock.module("@/lib/auth/secure-tokens", () => ({
    secureTokens: {
      get: async () => null,
      set: async () => undefined,
      clear: async () => void events.push("secure:clear"),
      migrateFromLegacy: async () => null,
    },
  }));
  mock.module("@/lib/startup-guards", () => ({
    withStartupTimeout: <T>(p: Promise<T>) => p,
    installStartupErrorHooks: () => undefined,
  }));
  mock.module("@/lib/startup-trace", () => ({
    startupMark: () => undefined,
    startAsyncStep: () => undefined,
    finishAsyncStep: () => undefined,
  }));
  mock.module("@/lib/observability/sentry", () => ({ setSentryUser: () => undefined }));
  mock.module("@/lib/observability/telemetry", () => ({
    reportError: () => undefined,
    reportVital: () => undefined,
    reportRecoverySignal: () => undefined,
  }));
  mock.module("@/lib/api-config", () => ({ getApiBaseUrl: () => BASE }));
  mock.module("@/lib/auth/device", () => ({
    ensureDeviceId: async () => "device-test",
    getDeviceId: () => "device-test",
    getDeviceName: () => "bun-test",
  }));
  mock.module("@/lib/fraud/signals", () => ({
    getFraudHeaders: () => ({}),
    getFraudBodyFields: () => ({}),
  }));
  mock.module("@/lib/auth/pending-referral", () => ({ consumePendingReferralCode: async () => undefined }));

  store = await import("@/stores/auth-store");
  store.useAuthStore.subscribe((s, prev) => {
    if (s.status !== prev.status) events.push(`status:${s.status}`);
  });
});

afterAll(() => {
  globalThis.fetch = realFetch;
});

beforeEach(() => {
  seen.length = 0;
  events.length = 0;
  server.validAccess = new Set(["at-live"]);
  server.unlinkDelayMs = 0;
  const { pushRegistrar } = require("@/lib/push/push-registration") as typeof import("@/lib/push/push-registration");
  pushRegistrar.forget();
});

function signedIn(accessToken: string | null): void {
  store.useAuthStore.setState({
    user: { id: "user-a" } as never,
    accessToken,
    refreshToken: "rt-live",
    status: "authenticated",
  });
}

const unlinks = () => seen.filter((s) => s.method === "DELETE" && s.path === "/api/users/me/devices/device-test");

describe("logout unlinks this device's push token", () => {
  test("the DELETE carries the access token the session held — it is not lost to clearSession()", async () => {
    signedIn("at-live");
    server.unlinkDelayMs = 15; // the request is still on the wire when the session is cleared

    await store.useAuthStore.getState().logout();

    expect(unlinks()).toEqual([{ method: "DELETE", path: "/api/users/me/devices/device-test", bearer: "at-live" }]);
    const s = store.useAuthStore.getState();
    expect(s.status).toBe("unauthenticated");
    expect(s.accessToken).toBeNull();
  });

  test("the local session is cleared at once; the unlink finishes before the server logout is sent", async () => {
    signedIn("at-live");
    server.unlinkDelayMs = 15;

    await store.useAuthStore.getState().logout();

    const at = (e: string) => {
      const i = events.findIndex((x) => x.startsWith(e));
      if (i < 0) throw new Error(`event "${e}" never happened; events: ${events.join(" | ")}`);
      return i;
    };
    // Signing out never waits on the network…
    expect(at("status:unauthenticated")).toBeLessThan(at("unlink:done"));
    // …and a server logout that revokes the access token cannot overtake the unlink that uses it.
    expect(at("unlink:done")).toBeLessThan(at("fetch:POST:/api/auth/logout"));
  });

  test("an expired access token: the unlink 401s and sign-out completes WITHOUT a refresh", async () => {
    signedIn("at-expired");

    await store.useAuthStore.getState().logout();

    expect(unlinks().map((u) => u.bearer)).toEqual(["at-expired"]);
    expect(seen.some((s) => s.path === "/api/auth/refresh")).toBe(false);
    expect(store.useAuthStore.getState().status).toBe("unauthenticated");
  });

  test("no access token in memory: nothing to authenticate with, so no unlink is attempted", async () => {
    signedIn(null);

    await store.useAuthStore.getState().logout();

    expect(unlinks()).toEqual([]);
    expect(store.useAuthStore.getState().status).toBe("unauthenticated");
  });
});
