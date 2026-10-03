/**
 * Push registration rules (bun logic suite — see package.json "test:logic"). Pure: no device, no
 * network. The hook-level behaviour is covered by src/hooks/use-push-notifications.test.ts (Jest).
 */
import { describe, expect, test } from "bun:test";
import {
  createPushRegistrar,
  isExpoPushToken,
  type NativePushToken,
  type PushPermission,
  type PushRegistrationDeps,
} from "./push-registration";

const EXPO = "ExponentPushToken[abc123]";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function fakeDeps(overrides: Partial<PushRegistrationDeps> = {}) {
  const calls = { permission: 0, request: 0, token: [] as (NativePushToken | undefined)[], backend: [] as string[] };
  let permission: PushPermission = "granted";
  const deps: PushRegistrationDeps = {
    isSupported: () => true,
    getPermission: async () => {
      calls.permission += 1;
      return permission;
    },
    requestPermission: async () => {
      calls.request += 1;
      return permission;
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
  return { deps, calls, setPermission: (p: PushPermission) => (permission = p) };
}

describe("isExpoPushToken", () => {
  test("accepts Expo tokens, refuses native FCM/APNs tokens and junk", () => {
    expect(isExpoPushToken("ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]")).toBe(true);
    expect(isExpoPushToken("ExpoPushToken[xxxxxxxxxxxxxxxxxxxxxx]")).toBe(true);
    expect(isExpoPushToken("dGVzdA:APA91bHPRgkF3JUikC4ENAHEeMrd41Zxv3hVZjC9KtT8OvPVGJ")).toBe(false);
    expect(isExpoPushToken("a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90")).toBe(false);
    expect(isExpoPushToken("ExponentPushToken[]")).toBe(false);
    expect(isExpoPushToken(undefined)).toBe(false);
  });
});

describe("register — permission states", () => {
  test("unsupported (Expo Go / web): nothing is asked, fetched or sent", async () => {
    const { deps, calls } = fakeDeps({ isSupported: () => false });
    expect(await createPushRegistrar().register(deps, "u1")).toEqual({ kind: "unsupported" });
    expect(calls).toEqual({ permission: 0, request: 0, token: [], backend: [] });
  });

  test("denied: asked once, no token fetched, nothing sent", async () => {
    const { deps, calls, setPermission } = fakeDeps();
    setPermission("denied");
    expect(await createPushRegistrar().register(deps, "u1")).toEqual({ kind: "denied", permission: "denied" });
    expect(calls.request).toBe(1);
    expect(calls.token).toEqual([]);
    expect(calls.backend).toEqual([]);
  });

  test("undetermined + prompt:false (no prompt allowed): nothing fetched", async () => {
    const { deps, calls, setPermission } = fakeDeps();
    setPermission("undetermined");
    const out = await createPushRegistrar().register(deps, "u1", { prompt: false });
    expect(out).toEqual({ kind: "denied", permission: "undetermined" });
    expect(calls.request).toBe(0);
    expect(calls.token).toEqual([]);
  });

  test("granted: the Expo token is registered", async () => {
    const { deps, calls } = fakeDeps();
    expect(await createPushRegistrar().register(deps, "u1")).toEqual({ kind: "registered", token: EXPO });
    expect(calls.request).toBe(0);
    expect(calls.backend).toEqual([EXPO]);
  });

  test("a permission call that throws is an outcome, not a rejection", async () => {
    const { deps } = fakeDeps({
      getPermission: async () => {
        throw new Error("native module missing");
      },
    });
    const out = await createPushRegistrar().register(deps, "u1");
    expect(out.kind).toBe("failed");
    expect(out.kind === "failed" && out.stage).toBe("permission");
  });

  test("a token fetch that throws (no Google Play services / FCM config) is an outcome; nothing sent", async () => {
    const { deps, calls } = fakeDeps({
      getExpoPushToken: async () => {
        throw new Error("SERVICE_NOT_AVAILABLE");
      },
    });
    const out = await createPushRegistrar().register(deps, "u1");
    expect(out.kind === "failed" && out.stage).toBe("token");
    expect(calls.backend).toEqual([]);
  });
});

describe("register — once per user per process, and never stale", () => {
  test("the same user and token are registered once per process", async () => {
    const { deps, calls } = fakeDeps();
    const r = createPushRegistrar();
    await r.register(deps, "u1");
    expect(await r.register(deps, "u1")).toEqual({ kind: "unchanged", token: EXPO });
    expect(calls.backend).toEqual([EXPO]);
  });

  test("a different user on the same phone registers the same token again (the server re-links it)", async () => {
    const { deps, calls } = fakeDeps();
    const r = createPushRegistrar();
    await r.register(deps, "u1");
    expect((await r.register(deps, "u2")).kind).toBe("registered");
    expect(calls.backend).toEqual([EXPO, EXPO]);
  });

  test("after signOut the same user registers again (sign-out deactivated the device server-side)", async () => {
    const { deps, calls } = fakeDeps();
    const r = createPushRegistrar();
    await r.register(deps, "u1");
    await r.signOut(async () => undefined);
    expect((await r.register(deps, "u1")).kind).toBe("registered");
    expect(calls.backend).toEqual([EXPO, EXPO]);
  });

  test("a failed backend call is not remembered as registered — the next attempt retries", async () => {
    let fail = true;
    const sent: string[] = [];
    const { deps } = fakeDeps({
      registerWithBackend: async (t) => {
        sent.push(t);
        if (fail) throw new Error("503");
      },
    });
    const r = createPushRegistrar();
    const first = await r.register(deps, "u1");
    expect(first.kind === "failed" && first.stage).toBe("backend");
    fail = false;
    expect((await r.register(deps, "u1")).kind).toBe("registered");
    expect(sent).toEqual([EXPO, EXPO]);
  });

  test("a registration still queued when the user signs out is cancelled, not sent", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const sent: string[] = [];
    const { deps } = fakeDeps({
      registerWithBackend: async (t) => {
        sent.push(t);
        await gate;
      },
    });
    const r = createPushRegistrar();
    const first = r.register(deps, "u1");
    await sleep(0);
    const second = r.onNativeTokenChanged(deps, "u2", { type: "android", data: "fcm-2" });
    await sleep(0);
    const signedOut = r.signOut(async () => undefined);
    release();
    await Promise.all([first, signedOut]);
    expect(await second).toEqual({ kind: "cancelled" });
    expect(sent).toEqual([EXPO]);
  });
});

describe("token rotation (the push-token listener)", () => {
  test("the native token is exchanged for the Expo token — the native token is never sent", async () => {
    const rotatedExpo = "ExponentPushToken[rotated]";
    const { deps, calls } = fakeDeps({
      getExpoPushToken: async (nativeToken) => {
        calls.token.push(nativeToken);
        return nativeToken ? rotatedExpo : EXPO;
      },
    });
    const r = createPushRegistrar();
    await r.register(deps, "u1");
    const native = { type: "android", data: "dGVzdA:APA91bRotated" };
    expect(await r.onNativeTokenChanged(deps, "u1", native)).toEqual({ kind: "registered", token: rotatedExpo });
    expect(calls.token.at(-1)).toEqual(native);
    expect(calls.backend).toEqual([EXPO, rotatedExpo]);
  });

  test("anything that is not an Expo token is refused before the backend", async () => {
    const { deps, calls } = fakeDeps({ getExpoPushToken: async () => "dGVzdA:APA91bRaw" });
    const r = createPushRegistrar();
    expect(await r.onNativeTokenChanged(deps, "u1", { type: "android", data: "x" })).toEqual({
      kind: "not-an-expo-token",
    });
    expect(await r.register(deps, "u1")).toEqual({ kind: "not-an-expo-token" });
    expect(calls.backend).toEqual([]);
  });

  test("the listener firing DURING the launch fetch (as the native module does) sends one registration", async () => {
    const r = createPushRegistrar();
    let listener: ((t: NativePushToken) => void) | null = null;
    const results: Promise<unknown>[] = [];
    const { deps, calls } = fakeDeps({
      getExpoPushToken: async (nativeToken) => {
        calls.token.push(nativeToken);
        if (!nativeToken) listener?.({ type: "android", data: "dGVzdA:APA91bSame" });
        await sleep(5); // exp.host round trip
        return EXPO;
      },
      registerWithBackend: async (t) => {
        calls.backend.push(t);
        await sleep(5);
      },
    });
    listener = (t) => results.push(r.onNativeTokenChanged(deps, "u1", t));
    const launch = await r.register(deps, "u1");
    const fromListener = (await Promise.all(results)) as { kind: string }[];
    // Whichever path reaches the backend first registers; the other sees it done.
    expect([launch.kind, ...fromListener.map((o) => o.kind)].sort()).toEqual(["registered", "unchanged"]);
    expect(calls.backend).toEqual([EXPO]);
  });
});

describe("signOut", () => {
  test("revoke succeeds → revoked", async () => {
    expect(await createPushRegistrar().signOut(async () => undefined)).toBe("revoked");
  });

  test("revoke rejects → failed, and signOut itself never throws", async () => {
    const out = await createPushRegistrar().signOut(async () => {
      throw new Error("401");
    });
    expect(out).toBe("failed");
  });

  test("a hung revoke cannot block sign-out past the bound", async () => {
    const started = Date.now();
    const out = await createPushRegistrar().signOut(() => new Promise(() => undefined), 25);
    expect(out).toBe("timed-out");
    expect(Date.now() - started).toBeLessThan(1000);
  });
});
