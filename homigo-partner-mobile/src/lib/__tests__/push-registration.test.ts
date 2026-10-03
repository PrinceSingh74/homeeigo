/**
 * Push-token registration rules — pure unit tests, run with `npm run test:unit` (Node's built-in
 * test runner; no device, no network, no DB).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createPushRegistrar,
  isExpoPushToken,
  type NativePushToken,
  type PushPermission,
  type PushRegistrationDeps,
} from "../push-registration.ts";

const EXPO = "ExponentPushToken[partner-abc]";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function fakeDeps(overrides: Partial<PushRegistrationDeps> = {}) {
  const calls = { request: 0, token: [] as (NativePushToken | undefined)[], backend: [] as string[] };
  const state = { permission: "granted" as PushPermission };
  const deps: PushRegistrationDeps = {
    isSupported: () => true,
    getPermission: async () => state.permission,
    requestPermission: async () => {
      calls.request += 1;
      return state.permission;
    },
    getExpoPushToken: async (nativeToken) => {
      calls.token.push(nativeToken);
      return EXPO;
    },
    registerWithBackend: async (token) => {
      calls.backend.push(token);
    },
    ...overrides,
  };
  return { deps, calls, state };
}

test("isExpoPushToken refuses native FCM/APNs tokens", () => {
  assert.equal(isExpoPushToken("ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]"), true);
  assert.equal(isExpoPushToken("dGVzdA:APA91bHPRgkF3JUikC4ENAHEeMrd41Zxv3hVZjC9KtT8OvPVGJ"), false);
  assert.equal(isExpoPushToken("a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90"), false);
});

test("Expo Go / web: nothing asked, fetched or sent", async () => {
  const { deps, calls } = fakeDeps({ isSupported: () => false });
  assert.deepEqual(await createPushRegistrar().register(deps, "p1"), { kind: "unsupported" });
  assert.deepEqual(calls, { request: 0, token: [], backend: [] });
});

test("permission denied: no token fetched, nothing registered", async () => {
  const { deps, calls, state } = fakeDeps();
  state.permission = "denied";
  assert.deepEqual(await createPushRegistrar().register(deps, "p1"), { kind: "denied", permission: "denied" });
  assert.deepEqual(calls.token, []);
  assert.deepEqual(calls.backend, []);
});

test("a token fetch that throws (no Google Play services / FCM config) is an outcome, not a rejection", async () => {
  const { deps, calls } = fakeDeps({
    getExpoPushToken: async () => {
      throw new Error("SERVICE_NOT_AVAILABLE");
    },
  });
  const out = await createPushRegistrar().register(deps, "p1");
  assert.equal(out.kind, "failed");
  assert.equal(out.kind === "failed" && out.stage, "token");
  assert.deepEqual(calls.backend, []);
});

test("the push-token listener's NATIVE token is exchanged for the Expo token — never registered raw", async () => {
  const rotated = "ExponentPushToken[partner-rotated]";
  const { deps, calls } = fakeDeps({
    getExpoPushToken: async (nativeToken) => {
      calls.token.push(nativeToken);
      return nativeToken ? rotated : EXPO;
    },
  });
  const r = createPushRegistrar();
  await r.register(deps, "p1");
  const native = { type: "android", data: "dGVzdA:APA91bRotatedPartnerToken" };
  assert.deepEqual(await r.onNativeTokenChanged(deps, "p1", native), { kind: "registered", token: rotated });
  assert.deepEqual(calls.token.at(-1), native);
  assert.deepEqual(calls.backend, [EXPO, rotated]);
});

test("a non-Expo token never reaches the backend", async () => {
  const { deps, calls } = fakeDeps({ getExpoPushToken: async () => "dGVzdA:APA91bRaw" });
  assert.deepEqual(await createPushRegistrar().register(deps, "p1"), { kind: "not-an-expo-token" });
  assert.deepEqual(calls.backend, []);
});

test("registered once per partner per process; a different partner on the same phone re-links the token", async () => {
  const { deps, calls } = fakeDeps();
  const r = createPushRegistrar();
  await r.register(deps, "p1");
  assert.equal((await r.register(deps, "p1")).kind, "unchanged");
  assert.equal((await r.register(deps, "p2")).kind, "registered");
  assert.deepEqual(calls.backend, [EXPO, EXPO]);
});

test("session refused (forget, no revoke possible): the same partner signing in again re-registers", async () => {
  const { deps, calls } = fakeDeps();
  const r = createPushRegistrar();
  await r.register(deps, "p1");
  r.forget();
  assert.equal((await r.register(deps, "p1")).kind, "registered");
  assert.deepEqual(calls.backend, [EXPO, EXPO]);
});

test("logout: signOut revokes, and the next sign-in registers again", async () => {
  const { deps, calls } = fakeDeps();
  const r = createPushRegistrar();
  await r.register(deps, "p1");
  let revoked = 0;
  assert.equal(await r.signOut(async () => void (revoked += 1)), "revoked");
  assert.equal(revoked, 1);
  assert.equal((await r.register(deps, "p1")).kind, "registered");
  assert.deepEqual(calls.backend, [EXPO, EXPO]);
});

test("signOut never throws and is bounded when the revoke fails or hangs", async () => {
  const r = createPushRegistrar();
  assert.equal(
    await r.signOut(async () => {
      throw new Error("401");
    }),
    "failed",
  );
  const started = Date.now();
  assert.equal(await r.signOut(() => new Promise(() => undefined), 25), "timed-out");
  assert.ok(Date.now() - started < 1000);
});

test("the listener firing during the launch fetch (as the native module does) sends ONE registration", async () => {
  const r = createPushRegistrar();
  let listener: ((t: NativePushToken) => void) | null = null;
  const fromListener: Promise<unknown>[] = [];
  const { deps, calls } = fakeDeps({
    getExpoPushToken: async (nativeToken) => {
      calls.token.push(nativeToken);
      if (!nativeToken) listener?.({ type: "android", data: "dGVzdA:APA91bSame" });
      await sleep(5);
      return EXPO;
    },
    registerWithBackend: async (t) => {
      calls.backend.push(t);
      await sleep(5);
    },
  });
  listener = (t) => fromListener.push(r.onNativeTokenChanged(deps, "p1", t));
  await r.register(deps, "p1");
  await Promise.all(fromListener);
  assert.deepEqual(calls.backend, [EXPO]);
});
