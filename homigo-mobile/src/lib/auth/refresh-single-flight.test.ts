/**
 * One refresh per rotation, across EVERY caller (bun logic suite — see package.json "test:logic").
 *
 * The server rotates the refresh token on each /api/auth/refresh and treats a second use of the
 * old token as theft: it revokes the whole family and the user is signed out. The app has several
 * refresh callers — cold-start bootstrap and the realtime 4401 handler (both through the store's
 * refreshSession) and the api client's 401 path — so they must all share ONE in-flight refresh.
 *
 * These tests drive the REAL auth store and the REAL api client against a strict fake server
 * (no grace window). Only the native leaves (storage, device id, telemetry) are stubbed.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { resetRefreshCoordinator } from "./refresh-coordinator";
import { createSerialQueue } from "./serial-queue";

type StoreModule = typeof import("@/stores/auth-store");
type ClientModule = typeof import("@/services/auth/api-client");

const BASE = "http://api.test.invalid";
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Strict fake of the server's rotation rules. */
const server = {
  generation: 1,
  validRefresh: "rt-1",
  validAccess: "at-1",
  revoked: false,
  refreshBodies: [] as string[],
  /** Every logout that reached the server: the bearer it carried, the body token, and the answer. */
  logouts: [] as { bearer: string; refreshToken: string; status: number }[],
  /** True once a logout the server accepted named the live refresh token (the session is revoked). */
  sessionRevoked: false,
  reset() {
    this.generation = 1;
    this.validRefresh = "rt-1";
    this.validAccess = "at-1";
    this.revoked = false;
    this.refreshBodies = [];
    this.logouts = [];
    this.sessionRevoked = false;
  },
  rotate() {
    this.generation += 1;
    this.validRefresh = "rt-" + this.generation;
    this.validAccess = "at-" + this.generation;
    return { accessToken: this.validAccess, refreshToken: this.validRefresh };
  },
};

let deviceDelayMs = 0;

/** One ordered log of what hit the network, SecureStore and the in-memory session. */
const events: string[] = [];

/** SecureStore stand-in with the same serial ordering as the real module, and a settable write latency. */
const serial = createSerialQueue();
const secure = {
  value: null as string | null,
  writeDelayMs: 0,
  reset() {
    this.value = null;
    this.writeDelayMs = 0;
  },
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

async function fakeFetch(input: unknown, init?: { method?: string; headers?: Record<string, string>; body?: string }): Promise<Response> {
  const url = String(input);
  if (url.endsWith("/api/auth/logout")) {
    // Same rule as the server (routes/auth.ts "/logout"): a native client has no refresh cookie, so the
    // refresh token in the body is revoked ONLY for a caller that proves the session with a valid
    // access token. Without one the answer is 401 and the session stays alive server-side.
    events.push("fetch:logout");
    const bearer = (init?.headers?.Authorization ?? "").replace("Bearer ", "");
    const sent = String((JSON.parse(init?.body ?? "{}") as { refreshToken?: string }).refreshToken ?? "");
    const status = !server.revoked && bearer === server.validAccess ? 200 : 401;
    server.logouts.push({ bearer: bearer || "-", refreshToken: sent, status });
    if (status === 401) return json(401, { success: false, error: "Invalid or expired token", code: "UNAUTHORIZED" });
    if (sent === server.validRefresh) server.sessionRevoked = true;
    return json(200, { success: true, data: {} });
  }
  if (url.endsWith("/api/auth/refresh")) {
    const sent = String((JSON.parse(init?.body ?? "{}") as { refreshToken?: string }).refreshToken ?? "");
    server.refreshBodies.push(sent);
    // The decision is taken on ARRIVAL; the response travels back afterwards.
    if (server.revoked || sent !== server.validRefresh) {
      server.revoked = true;
      await sleep(30);
      return json(401, { success: false, error: "Refresh token reuse detected", code: "TOKEN_REUSE" });
    }
    const tokens = server.rotate();
    await sleep(30);
    return json(200, { success: true, data: tokens });
  }
  const bearer = init?.headers?.Authorization ?? "";
  events.push(`fetch:${new URL(url).pathname}:${bearer.replace("Bearer ", "") || "-"}`);
  await sleep(2);
  if (server.revoked || bearer !== "Bearer " + server.validAccess) {
    return json(401, { success: false, error: "Unauthorized", code: "UNAUTHORIZED" });
  }
  return json(200, { success: true, data: { ok: true } });
}

let store: StoreModule;
let client: ClientModule;
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
      get: () => serial(async () => secure.value),
      set: (token: string) =>
        serial(async () => {
          if (secure.writeDelayMs > 0) await sleep(secure.writeDelayMs);
          secure.value = token;
          events.push(`secure:set:${token}`);
        }),
      clear: () =>
        serial(async () => {
          secure.value = null;
          events.push("secure:clear");
        }),
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
    ensureDeviceId: async () => {
      if (deviceDelayMs > 0) await sleep(deviceDelayMs);
      return "device-test";
    },
    getDeviceId: () => "device-test",
    getDeviceName: () => "bun-test",
  }));
  mock.module("@/lib/fraud/signals", () => ({
    getFraudHeaders: () => ({}),
    getFraudBodyFields: () => ({}),
  }));
  mock.module("@/lib/auth/pending-referral", () => ({ consumePendingReferralCode: async () => undefined }));

  store = await import("@/stores/auth-store");
  client = await import("@/services/auth/api-client");
  let lastRefresh: string | null = null;
  store.useAuthStore.subscribe((s) => {
    if (s.refreshToken !== lastRefresh) {
      lastRefresh = s.refreshToken;
      events.push(`memory:${s.refreshToken ?? "null"}`);
    }
  });
});

afterAll(() => {
  globalThis.fetch = realFetch;
});

beforeEach(async () => {
  // A write the previous test left in flight must not land in this test's event log.
  await sleep(60);
  await serial(async () => undefined);
  server.reset();
  secure.reset();
  deviceDelayMs = 0;
  resetRefreshCoordinator();
  events.length = 0;
});

/** A cold start: the refresh token came back from SecureStore, the access token lives in memory only. */
function coldStartSession(): void {
  store.useAuthStore.setState({ refreshToken: "rt-1", accessToken: null, status: "initializing" });
}

describe("refresh is single-flight across the store and the api client", () => {
  test("a request that 401s while bootstrap is refreshing shares that refresh — one POST, session kept", async () => {
    coldStartSession();

    const bootstrapRefresh = store.useAuthStore.getState().refreshSession();
    const screenRequest = client.apiRequest<{ success: boolean }>("/api/geo/route", { auth: true });
    const [refreshed, screen] = await Promise.all([bootstrapRefresh, screenRequest]);

    expect(server.refreshBodies).toEqual(["rt-1"]);
    expect(server.revoked).toBe(false);
    expect(refreshed).toBe(true);
    expect(screen.success).toBe(true);
    expect(store.useAuthStore.getState().refreshToken).toBe("rt-2");

    // The session is still usable afterwards, and nothing refreshes again.
    const next = await client.apiRequest<{ success: boolean }>("/api/user/me", { auth: true });
    expect(next.success).toBe(true);
    expect(server.refreshBodies.length).toBe(1);
  });

  test("two refreshSession callers at once (bootstrap + realtime 4401) issue one POST", async () => {
    coldStartSession();

    const results = await Promise.all([
      store.useAuthStore.getState().refreshSession(),
      store.useAuthStore.getState().refreshSession(),
    ]);

    expect(server.refreshBodies).toEqual(["rt-1"]);
    expect(results).toEqual([true, true]);
    expect(server.revoked).toBe(false);
    expect(store.useAuthStore.getState().refreshToken).toBe("rt-2");
  });

  test("the 401 path sends the refresh token that is current when it sends, not one read before its awaits", async () => {
    store.useAuthStore.setState({ refreshToken: "rt-1", accessToken: "at-stale", status: "authenticated" });
    deviceDelayMs = 60; // the device id lookup (SecureStore / lazy module) can take seconds on a phone

    const request = client.apiRequest<{ success: boolean }>("/api/users/bookings", { auth: true });
    await sleep(25); // the 401 is back and the refresh is waiting on the device id
    const rotated = server.rotate(); // meanwhile a sign-in / another rotation lands
    store.useAuthStore.setState({ refreshToken: rotated.refreshToken, accessToken: rotated.accessToken });

    const result = await request;

    expect(server.refreshBodies).toEqual(["rt-2"]);
    expect(server.revoked).toBe(false);
    expect(result.success).toBe(true);
    expect(store.useAuthStore.getState().refreshToken).toBe("rt-3");
  });
});

describe("a rotated refresh token is durable before it is used, and a logout or new sign-in wins", () => {
  const at = (e: string) => {
    const i = events.indexOf(e);
    if (i < 0) throw new Error(`event "${e}" never happened; events: ${events.join(" | ")}`);
    return i;
  };

  test("401 → refresh → SecureStore write finishes → memory updated → the request is retried exactly once", async () => {
    store.useAuthStore.setState({ refreshToken: "rt-1", accessToken: "at-stale", status: "authenticated" });
    secure.value = "rt-1";
    secure.writeDelayMs = 40; // the Keystore write is slow on a real phone

    const result = await client.apiRequest<{ success: boolean }>("/api/users/bookings", { auth: true });

    expect(result.success).toBe(true);
    expect(server.refreshBodies).toEqual(["rt-1"]);
    expect(at("secure:set:rt-2")).toBeLessThan(at("memory:rt-2"));
    expect(at("memory:rt-2")).toBeLessThan(at("fetch:/api/users/bookings:at-2"));
    // one failed attempt with the stale token, one retry — no more
    expect(events.filter((e) => e.startsWith("fetch:/api/users/bookings:")).length).toBe(2);
    expect(secure.value).toBe("rt-2");
  });

  test("two requests 401 together: one refresh, one durable write, both retried once and succeed", async () => {
    store.useAuthStore.setState({ refreshToken: "rt-1", accessToken: "at-stale", status: "authenticated" });
    secure.writeDelayMs = 25;

    const [a, b] = await Promise.all([
      client.apiRequest<{ success: boolean }>("/api/users/bookings", { auth: true }),
      client.apiRequest<{ success: boolean }>("/api/user/me", { auth: true }),
    ]);

    expect(a.success && b.success).toBe(true);
    expect(server.refreshBodies).toEqual(["rt-1"]);
    expect(events.filter((e) => e.startsWith("secure:set:")).length).toBe(1);
    expect(at("secure:set:rt-2")).toBeLessThan(at("fetch:/api/users/bookings:at-2"));
    expect(at("secure:set:rt-2")).toBeLessThan(at("fetch:/api/user/me:at-2"));
  });

  test("logout while a refresh is in flight: the rotated token is NOT written back and the user stays signed out", async () => {
    store.useAuthStore.setState({ refreshToken: "rt-1", accessToken: "at-stale", status: "authenticated" });
    secure.value = "rt-1";

    const request = client.apiRequest<{ success: boolean }>("/api/users/bookings", { auth: true }).catch((e: unknown) => e);
    await sleep(8); // the 401 is back and the refresh request is on the wire
    await store.useAuthStore.getState().logout();
    await request;
    await sleep(60); // let every queued write settle

    const s = store.useAuthStore.getState();
    expect(s.status).toBe("unauthenticated");
    expect(s.refreshToken).toBeNull();
    expect(s.accessToken).toBeNull();
    expect(secure.value).toBeNull();
    expect(events.filter((e) => e.startsWith("secure:set:")).length).toBe(0);
  });

  test("a new sign-in during an in-flight refresh keeps the NEW session (memory and SecureStore)", async () => {
    store.useAuthStore.setState({ refreshToken: "rt-1", accessToken: "at-stale", status: "authenticated" });

    const request = client.apiRequest<{ success: boolean }>("/api/users/bookings", { auth: true }).catch((e: unknown) => e);
    await sleep(8);
    await store.useAuthStore.getState().setSession({ id: "u-new" } as never, "at-new", "rt-new");
    await request;
    await sleep(60);

    const s = store.useAuthStore.getState();
    expect(s.refreshToken).toBe("rt-new");
    expect(s.accessToken).toBe("at-new");
    expect(s.status).toBe("authenticated");
    expect(secure.value).toBe("rt-new");
  });

  test("cold start: SecureStore token → one refresh → rotated token durable → authenticated", async () => {
    store.useAuthStore.setState({ refreshToken: null, accessToken: null, status: "idle" });
    secure.value = "rt-1";
    secure.writeDelayMs = 20;

    await store.useAuthStore.getState().bootstrap();

    const s = store.useAuthStore.getState();
    expect(s.status).toBe("authenticated");
    expect(server.refreshBodies).toEqual(["rt-1"]);
    expect(secure.value).toBe("rt-2");
    expect(at("secure:set:rt-2")).toBeLessThan(at("memory:rt-2"));
    expect(at("memory:rt-2")).toBeLessThan(at("fetch:/api/user/me:at-2"));
  });
});

describe("logout revokes the session on the server, not only on the device", () => {
  test("the logout request carries the access token captured BEFORE the local session is cleared", async () => {
    store.useAuthStore.setState({ refreshToken: "rt-1", accessToken: "at-1", status: "authenticated" });
    secure.value = "rt-1";

    await store.useAuthStore.getState().logout();

    expect(server.logouts).toEqual([{ bearer: "at-1", refreshToken: "rt-1", status: 200 }]);
    expect(server.sessionRevoked).toBe(true);
    expect(server.refreshBodies).toEqual([]);
    const s = store.useAuthStore.getState();
    expect(s.status).toBe("unauthenticated");
    expect(s.refreshToken).toBeNull();
  });
});
