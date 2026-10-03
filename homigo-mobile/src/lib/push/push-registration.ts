/**
 * Push-token registration, as pure TypeScript (no React Native imports) so it runs under the bun
 * logic suite. The hook supplies the native pieces (permission, Expo token) and the HTTP calls.
 *
 * ── What this replaces, and why ───────────────────────────────────────────────
 *
 * 1. The push-token listener registered the token it was handed. expo-notifications hands that
 *    listener the NATIVE token (FCM on Android, APNs on iOS) — not the Expo push token — and fires it
 *    on every `getExpoPushTokenAsync()` call, not only on rotation (PushTokenModule.kt resolves the
 *    fetch and then calls `onNewToken`; PushTokenModule.swift does the same). So every registration
 *    also PUT the raw native token as `expoPushToken`. The backend stores it, and its sender then drops
 *    it (`Expo.isExpoPushToken` fails), so that device silently received nothing. A changed native
 *    token is now exchanged for the Expo token (`getExpoPushToken(nativeToken)`), and anything that is
 *    not an Expo token is never sent to the backend.
 *
 * 2. "Already synced" was a persisted marker keyed by the token alone. The same phone signing in as a
 *    different account kept the marker, skipped the registration, and the device row stayed linked to
 *    the previous account — its pushes kept arriving on the new user's phone. A device the server had
 *    deactivated (sign-out, "log out everywhere", a DeviceNotRegistered sweep) was never re-registered
 *    either, because the marker still matched. The marker is now in memory, keyed by user AND token,
 *    and cleared on sign-out: a fresh process registers once per signed-in user, which also refreshes
 *    the server's `lastSeenAt`.
 *
 * 3. A token fetch that throws (emulator without Google Play services, no FCM configuration in the
 *    build) escaped as an unhandled promise rejection. Every stage now returns an outcome instead.
 */

export type PushPermission = "granted" | "denied" | "undetermined";

/** A native (FCM/APNs) token, as expo-notifications' push-token listener delivers it. */
export type NativePushToken = { type: string; data: unknown };

export type PushRegistrationDeps = {
  /** false in Expo Go (SDK 53+) and on web: remote push tokens need a development or store build. */
  isSupported: () => boolean;
  getPermission: () => Promise<PushPermission>;
  requestPermission: () => Promise<PushPermission>;
  /**
   * The Expo push token. Given a changed native token, exchange THAT token; never fetch the native
   * token again from the rotation handler (expo-notifications: that re-fires the listener).
   */
  getExpoPushToken: (nativeToken?: NativePushToken) => Promise<string>;
  /** PUT /api/users/me/devices/push-token for the signed-in user. */
  registerWithBackend: (expoPushToken: string) => Promise<void>;
};

export type PushOutcome =
  | { kind: "unsupported" }
  | { kind: "denied"; permission: PushPermission }
  | { kind: "registered"; token: string }
  | { kind: "unchanged"; token: string }
  | { kind: "not-an-expo-token" }
  | { kind: "cancelled" }
  | { kind: "failed"; stage: "permission" | "token" | "backend"; error: unknown };

export type SignOutResult = "revoked" | "failed" | "timed-out";

const EXPO_PUSH_TOKEN = /^Expo(nent)?PushToken\[[^\]]+\]$/;

export function isExpoPushToken(value: unknown): value is string {
  return typeof value === "string" && EXPO_PUSH_TOKEN.test(value);
}

export function createPushRegistrar() {
  /** `${userId}\n${token}` registered by THIS process. Never persisted (see header, point 2). */
  let synced: string | null = null;
  /** Bumped on sign-out: a registration still queued from the ended session must not run. */
  let generation = 0;
  let queue: Promise<unknown> = Promise.resolve();

  /** One backend registration at a time, so the rotation handler and the launch path never race. */
  function serial<T>(task: () => Promise<T>): Promise<T> {
    const run = queue.then(task, task);
    queue = run.catch(() => undefined);
    return run;
  }

  function sync(deps: PushRegistrationDeps, userId: string, token: unknown): Promise<PushOutcome> {
    if (!isExpoPushToken(token)) return Promise.resolve({ kind: "not-an-expo-token" });
    const startedIn = generation;
    return serial(async (): Promise<PushOutcome> => {
      if (startedIn !== generation) return { kind: "cancelled" };
      const key = `${userId}\n${token}`;
      if (synced === key) return { kind: "unchanged", token };
      try {
        await deps.registerWithBackend(token);
      } catch (error) {
        return { kind: "failed", stage: "backend", error };
      }
      if (startedIn === generation) synced = key;
      return { kind: "registered", token };
    });
  }

  return {
    /** Launch / sign-in path: permission, then the Expo token, then the backend. Never throws. */
    async register(
      deps: PushRegistrationDeps,
      userId: string,
      options: { prompt?: boolean } = {},
    ): Promise<PushOutcome> {
      if (!deps.isSupported()) return { kind: "unsupported" };
      let permission: PushPermission;
      try {
        permission = await deps.getPermission();
        if (permission !== "granted" && options.prompt !== false) {
          permission = await deps.requestPermission();
        }
      } catch (error) {
        return { kind: "failed", stage: "permission", error };
      }
      // Declining is a legitimate end state: nothing is fetched or registered.
      if (permission !== "granted") return { kind: "denied", permission };
      let token: string;
      try {
        token = await deps.getExpoPushToken();
      } catch (error) {
        return { kind: "failed", stage: "token", error };
      }
      return sync(deps, userId, token);
    },

    /** The push-token listener: exchange the native token for the Expo token, then register that. */
    async onNativeTokenChanged(
      deps: PushRegistrationDeps,
      userId: string,
      nativeToken: NativePushToken,
    ): Promise<PushOutcome> {
      if (!deps.isSupported()) return { kind: "unsupported" };
      let token: string;
      try {
        token = await deps.getExpoPushToken(nativeToken);
      } catch (error) {
        return { kind: "failed", stage: "token", error };
      }
      return sync(deps, userId, token);
    },

    /**
     * Sign-out: forget the registration and unlink this device server-side. Call it while the
     * session can still authenticate. Bounded and never throws: a dead network must not block
     * sign-out.
     */
    async signOut(revoke: () => Promise<unknown>, timeoutMs = 3000): Promise<SignOutResult> {
      generation += 1;
      synced = null;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<SignOutResult>((resolve) => {
        timer = setTimeout(() => resolve("timed-out"), timeoutMs);
      });
      const attempt = (async (): Promise<SignOutResult> => {
        try {
          await revoke();
          return "revoked";
        } catch {
          return "failed";
        }
      })();
      try {
        return await Promise.race([attempt, timeout]);
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
    },

    /** The session ended without a chance to unlink (refresh refused): forget the registration. */
    forget(): void {
      generation += 1;
      synced = null;
    },
  };
}

export type PushRegistrar = ReturnType<typeof createPushRegistrar>;

/** The app's registrar. Tests build their own with `createPushRegistrar()`. */
export const pushRegistrar = createPushRegistrar();
