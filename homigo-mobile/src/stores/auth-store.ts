import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getErrorMessage } from "@/lib/auth/errors";
import { authApi } from "@/services/auth/auth-api";
import { configureApiClient } from "@/services/auth/api-client";
import { secureTokens } from "@/lib/auth/secure-tokens";
import { withStartupTimeout } from "@/lib/startup-guards";
import { finishAsyncStep, startAsyncStep, startupMark } from "@/lib/startup-trace";
import { setSentryUser } from "@/lib/observability/sentry";
import { reportError } from "@/lib/observability/telemetry";
import type { AuthStatus, AuthUser, PendingRegistration } from "@/types/auth";

/** Prevents parallel bootstrap() calls and survives persisted "initializing" deadlocks. */
let bootstrapInFlight: Promise<void> | null = null;
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
  setSession: (user: AuthUser, accessToken: string, refreshToken: string) => void;
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

      setSession: (user, accessToken, refreshToken) => {
        set({
          user,
          accessToken,
          refreshToken,
          status: "authenticated",
          error: null,
        });
        setSentryUser(user);
        void secureTokens.set(refreshToken); // hardware-backed Keychain/Keystore, not AsyncStorage
      },

      clearSession: () => {
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
        get().setSession(session.user, session.accessToken, session.refreshToken);
      },

      signInWithGoogle: async (code, state) => {
        set({ error: null });
        const session = await authApi.googleCallback(code, state);
        get().setSession(session.user, session.accessToken, session.refreshToken);
      },

      signInWithApple: async (code, state, user) => {
        set({ error: null });
        const session = await authApi.appleCallback(code, state, user);
        get().setSession(session.user, session.accessToken, session.refreshToken);
      },

      register: async (payload) => {
        set({ error: null });
        const session = await authApi.register(payload);
        get().setSession(session.user, session.accessToken, session.refreshToken);
      },

      logout: async () => {
        const token = get().refreshToken;
        get().clearSession();
        if (token) {
          try {
            await authApi.logout(token);
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

      refreshSession: async () => {
        const currentRefresh = get().refreshToken;
        if (!currentRefresh) return false;
        try {
          const data = await authApi.refresh(currentRefresh);
          set({
            accessToken: data.accessToken,
            refreshToken: data.refreshToken,
          });
          void secureTokens.set(data.refreshToken); // persist rotated token securely
          return true;
        } catch {
          get().clearSession();
          return false;
        }
      },

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

configureApiClient({
  getAccessToken: () => useAuthStore.getState().accessToken,
  getRefreshToken: () => useAuthStore.getState().refreshToken,
  setTokens: (accessToken, refreshToken) => {
    useAuthStore.setState({ accessToken, refreshToken });
    void secureTokens.set(refreshToken); // keep SecureStore in sync on silent rotation
  },
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
