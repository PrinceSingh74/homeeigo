import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getErrorMessage } from "@/lib/auth/errors";
import { coordinatedRefresh } from "@/lib/auth/refresh-coordinator";
import { authApi } from "@/services/auth/auth-api";
import { configureApiClient } from "@/services/auth/api-client";
import { secureTokens } from "@/lib/auth/secure-tokens";
import { withStartupTimeout } from "@/lib/startup-guards";
import { finishAsyncStep, startAsyncStep, startupMark } from "@/lib/startup-trace";
import { pushRegistrar } from "@/lib/push/push-registration";
import { setSentryUser } from "@/lib/observability/sentry";
import { reportError } from "@/lib/observability/telemetry";
import type { AuthStatus, AuthUser, PendingRegistration } from "@/types/auth";

/** Prevents parallel bootstrap() calls and survives persisted "initializing" deadlocks. */
let bootstrapInFlight: Promise<void> | null = null;
/**
 * Bumped by every sign-in and sign-out. A refresh that started in an earlier session must not write
 * its rotated token into the current one — otherwise a logout during an in-flight refresh would be
 * undone a moment later, and a new sign-in could be overwritten by the old account's tokens.
 */
let sessionEpoch = 0;
const SECURE_STORE_TIMEOUT_MS = 5000;
/** Hard cap — auth must never block the app past this (splash is already UI-decoupled). */
const BOOTSTRAP_DEADLINE_MS = 25000;

type AuthState = {
  user: AuthUser | null;
  accessToken: string | null;
  refreshToken: string | null;
  status: AuthStatus;
  error: string | null;
  /** Dev-only OTP surfaced by the backend when no SMS provider is configured. */
  devOtp: string | null;
  setSession: (user: AuthUser, accessToken: string, refreshToken: string) => Promise<void>;
  clearSession: () => void;
  setError: (message: string | null) => void;
  bootstrap: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  signInWithGoogle: (code: string, state?: string | null) => Promise<void>;
  signInWithApple: (
    code: string,
    state?: string | null,
    user?: { email?: string; name?: { firstName?: string; lastName?: string } },
  ) => Promise<void>;
  register: (payload: PendingRegistration & { otp?: string }) => Promise<void>;
  logout: () => Promise<void>;
  sendOtp: (phoneNumber: string, userId?: string) => Promise<void>;
  verifyOtp: (phoneNumber: string, otp: string, userId?: string) => Promise<void>;
  forgotPassword: (email: string) => Promise<void>;
  resetPassword: (token: string, newPassword: string) => Promise<void>;
  refreshSession: () => Promise<boolean>;
  fetchCurrentUser: () => Promise<void>;
};

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      accessToken: null,
      refreshToken: null,
      status: "idle",
      error: null,
      devOtp: null,

      setSession: async (user, accessToken, refreshToken) => {
        const epoch = ++sessionEpoch;
        await secureTokens.set(refreshToken); // hardware-backed Keychain/Keystore, not AsyncStorage
        if (epoch !== sessionEpoch) return; // signed out (or in again) while the write was running
        set({
          user,
          accessToken,
          refreshToken,
          status: "authenticated",
          error: null,
        });
        setSentryUser(user);
      },

      clearSession: () => {
        sessionEpoch += 1;
        set({
          user: null,
          accessToken: null,
          refreshToken: null,
          status: "unauthenticated",
          error: null,
        });
        setSentryUser(null);
        void secureTokens.clear();
      },

      setError: (error) => set({ error }),

      bootstrap: async () => {
        if (bootstrapInFlight) return bootstrapInFlight;

        bootstrapInFlight = (async () => {
          startAsyncStep("bootstrap");
          startupMark("BOOTSTRAP_START");
          set({ status: "initializing", error: null });

          const run = async (): Promise<void> => {
            try {
              // Hydrate the refresh token from SecureStore (it is no longer kept in the AsyncStorage blob).
              if (!get().refreshToken) {
                startAsyncStep("securestore");
                const fromSecure = await withStartupTimeout(secureTokens.get(), SECURE_STORE_TIMEOUT_MS, null);
                const secure =
                  fromSecure ??
                  (await withStartupTimeout(secureTokens.migrateFromLegacy(), SECURE_STORE_TIMEOUT_MS, null));
                finishAsyncStep("securestore", "resolved", secure ? "token-found" : "no-token");
                startupMark("SECURESTORE", secure ? "token-found" : "no-token");
                if (secure) set({ refreshToken: secure });
              } else {
                startupMark("SECURESTORE", "memory-token");
              }

              if (!get().refreshToken) {
                startupMark("TOKEN_CHECK", "absent");
                startupMark("REFRESH", "skipped-no-token");
                set({ status: "unauthenticated" });
                startupMark("AUTH_READY", "unauthenticated");
                return;
              }

              startupMark("TOKEN_CHECK", "present");
              startAsyncStep("refresh");
              const ok = await get().refreshSession();
              finishAsyncStep("refresh", ok ? "resolved" : "rejected", ok ? "ok" : "failed");
              startupMark("REFRESH", ok ? "ok" : "failed");
              if (!ok) {
                set({ status: "unauthenticated" });
                startupMark("AUTH_READY", "unauthenticated");
                return;
              }

              startAsyncStep("fetch-user");
              await get().fetchCurrentUser();
              finishAsyncStep("fetch-user", "resolved");
              set({ status: "authenticated" });
              startupMark("AUTH_READY", "authenticated");
            } catch (error) {
              if (__DEV__) console.error("[Homeeigo AUTH] bootstrap failed:", error);
              reportError(error, { phase: "auth-bootstrap" });
              finishAsyncStep("refresh", "rejected");
              finishAsyncStep("fetch-user", "rejected");
              get().clearSession();
              set({ status: "unauthenticated" });
              startupMark("AUTH_READY", "error-unauthenticated");
            } finally {
              if (get().status === "initializing") {
                set({ status: "unauthenticated" });
                startupMark("AUTH_READY", "finally-unauthenticated");
              }
            }
          };

          const timedOut = await withStartupTimeout(
            run().then(() => false),
            BOOTSTRAP_DEADLINE_MS,
            true,
          );
          if (timedOut) {
            if (__DEV__) console.warn(`[Homeeigo AUTH] bootstrap deadline ${BOOTSTRAP_DEADLINE_MS}ms exceeded`);
            finishAsyncStep("bootstrap", "timeout", `${BOOTSTRAP_DEADLINE_MS}ms`);
            if (get().status === "initializing") {
              get().clearSession();
              set({ status: "unauthenticated" });
              startupMark("AUTH_READY", "deadline-unauthenticated");
            }
            startupMark("BOOTSTRAP_END", "timeout");
          } else {
            finishAsyncStep("bootstrap", "resolved");
            startupMark("BOOTSTRAP_END", get().status);
          }
        })().finally(() => {
          bootstrapInFlight = null;
        });

        return bootstrapInFlight;
      },

      login: async (email, password) => {
        set({ error: null });
        const session = await authApi.login(email, password);
        await get().setSession(session.user, session.accessToken, session.refreshToken);
      },

      signInWithGoogle: async (code, state) => {
        set({ error: null });
        const session = await authApi.googleCallback(code, state);
        await get().setSession(session.user, session.accessToken, session.refreshToken);
      },

      signInWithApple: async (code, state, user) => {
        set({ error: null });
        const session = await authApi.appleCallback(code, state, user);
        await get().setSession(session.user, session.accessToken, session.refreshToken);
      },

      register: async (payload) => {
        set({ error: null });
        const session = await authApi.register(payload);
        await get().setSession(session.user, session.accessToken, session.refreshToken);
      },

      logout: async () => {
        const token = get().refreshToken;
        // Push: start unlinking this device with the access token clearSession() is about to drop
        // (the server's logout keeps the device active). Bounded, never throws, never refreshes.
        const accessToken = get().accessToken;
        const pushUnlink = accessToken
          ? pushRegistrar.signOut(() => authApi.unregisterPushDevice(accessToken))
          : Promise.resolve(pushRegistrar.forget());
        get().clearSession();
        await pushUnlink;
        if (token) {
          try {
            // The captured access token, not the store's (cleared above): a native client has no
            // refresh cookie, so the server revokes the refresh token only for a caller that proves
            // the session with a valid access token — without it the logout 401s and the session
            // stays alive server-side (seen on device: "Sign out" → POST /api/auth/logout 401).
            await authApi.logout(token, accessToken);
          } catch {
            /* client session already cleared */
          }
        }
      },

      sendOtp: async (phoneNumber, userId) => {
        set({ error: null });
        const res = await authApi.sendOtp(phoneNumber, userId);
        // Dev only: backend returns the code when no SMS provider is configured,
        // so the verify screen can show it (no real SMS in development).
        set({ devOtp: res?.data?.devOtp ?? null });
      },

      verifyOtp: async (phoneNumber, otp, userId) => {
        set({ error: null });
        await authApi.verifyOtp(phoneNumber, otp, userId);
        if (userId) await get().fetchCurrentUser();
      },

      forgotPassword: async (email) => {
        set({ error: null });
        await authApi.forgotPassword(email);
      },

      resetPassword: async (token, newPassword) => {
        set({ error: null });
        await authApi.resetPassword(token, newPassword);
      },

      // Shares the api-client's single in-flight refresh: at cold start an auth'd request that 401s
      // while bootstrap is refreshing used to rotate the SAME refresh token a second time; once that
      // second call landed outside the server's rotation grace window it was treated as token reuse,
      // the whole token family was revoked and the user was signed out everywhere.
      refreshSession: () =>
        coordinatedRefresh(async () => {
          const currentRefresh = get().refreshToken;
          if (!currentRefresh) return false;
          const epoch = sessionEpoch;
          let data: { accessToken: string; refreshToken: string };
          try {
            data = await authApi.refresh(currentRefresh);
          } catch {
            if (epoch === sessionEpoch) get().clearSession();
            return false;
          }
          return applyRotation(data.accessToken, data.refreshToken, epoch);
        }),

      fetchCurrentUser: async () => {
        const user = await authApi.fetchCurrentUser();
        set({ user });
      },
    }),
    {
      name: "homigo-auth",
      storage: createJSONStorage(() => AsyncStorage),
      // Tokens are NEVER written to AsyncStorage — only the non-sensitive user profile is.
      // The refresh token lives in SecureStore (Keychain/Keystore); see bootstrap() for hydration.
      partialize: (state) => ({
        user: state.user,
      }),
      onRehydrateStorage: () => {
        startupMark("HYDRATION_START");
        return (state) => {
          startupMark("HYDRATION_END", state ? "ok" : "empty");
          if (!state) return;
          // Status must never be rehydrated — a killed session can leave "initializing" in legacy blobs.
          state.status = "idle";
          state.accessToken = null;
          state.refreshToken = null;
        };
      },
    },
  ),
);

/**
 * A rotated token pair becomes the session in this order: SecureStore write finishes → memory is
 * updated → the caller retries. The server has already invalidated the old refresh token, so the
 * new one must be durable before anything relies on it (a kill right after a retry would otherwise
 * restart the app with a dead token). Returns false when the session this rotation belongs to has
 * ended meanwhile; nothing is written then.
 */
async function applyRotation(accessToken: string, refreshToken: string, epoch: number): Promise<boolean> {
  if (epoch !== sessionEpoch) return false;
  await secureTokens.set(refreshToken);
  // Ended while writing: the sign-out's clear is queued after this write, so SecureStore ends empty.
  if (epoch !== sessionEpoch) return false;
  useAuthStore.setState({ accessToken, refreshToken });
  return true;
}

configureApiClient({
  getAccessToken: () => useAuthStore.getState().accessToken,
  getRefreshToken: () => useAuthStore.getState().refreshToken,
  getSessionEpoch: () => sessionEpoch,
  setTokens: (accessToken, refreshToken, epoch) => applyRotation(accessToken, refreshToken, epoch ?? sessionEpoch),
  clearSession: () => useAuthStore.getState().clearSession(),
});

export async function runAuthAction<T>(
  action: () => Promise<T>,
  setError: (msg: string | null) => void,
): Promise<{ ok: true; data: T } | { ok: false; message: string }> {
  setError(null);
  try {
    const data = await action();
    return { ok: true, data };
  } catch (error) {
    const message = getErrorMessage(error);
    setError(message);
    return { ok: false, message };
  }
}
