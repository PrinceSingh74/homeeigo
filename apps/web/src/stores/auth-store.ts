"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { getErrorMessage } from "@/lib/auth/errors";
import { clearPendingRegistration } from "@/lib/auth/pending-registration";
import { clearSessionCookie, setSessionCookie } from "@/lib/auth/session-cookie";
import { setSentryUser } from "@/lib/sentry";
import { authApi } from "@/services/auth/auth-api";
import { configureApiClient } from "@/services/auth/api-client";
import type { AuthStatus, AuthUser, PendingRegistration } from "@/types/auth";
import { AUTH_PERSIST_VERSION, migrateAuthSnapshot } from "./auth-persist";

type AuthState = {
  user: AuthUser | null;
  accessToken: string | null;
  status: AuthStatus;
  error: string | null;
  setSession: (user: AuthUser, accessToken: string) => void;
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
      status: "idle",
      error: null,

      setSession: (user, accessToken) => {
        setSessionCookie();
        setSentryUser({ id: (user as { id?: string })?.id, role: (user as { role?: string })?.role });
        set({
          user,
          accessToken,
          status: "authenticated",
          error: null,
        });
      },

      clearSession: () => {
        clearSessionCookie();
        setSentryUser(null);
        set({
          user: null,
          accessToken: null,
          status: "unauthenticated",
          error: null,
        });
      },

      setError: (error) => set({ error }),

      bootstrap: async () => {
        const { user, status } = get();
        if (status === "initializing") return;
        const { markBootstrapStart, markBootstrapComplete } = await import("@/lib/auth/bootstrap-gate");
        markBootstrapStart();
        set({ status: "initializing", error: null });

        // A persisted user means "a refresh cookie may exist" — the refresh call is what proves it.
        if (!user) {
          set({ status: "unauthenticated" });
          markBootstrapComplete();
          return;
        }

        try {
          const ok = await get().refreshSession();
          if (!ok) {
            set({ status: "unauthenticated" });
            markBootstrapComplete();
            return;
          }
          await get().fetchCurrentUser();
          set({ status: "authenticated" });
        } catch {
          get().clearSession();
          set({ status: "unauthenticated" });
        } finally {
          markBootstrapComplete();
        }
      },

      login: async (email, password) => {
        set({ error: null });
        const session = await authApi.login(email, password);
        get().setSession(session.user, session.accessToken);
      },

      signInWithGoogle: async (code, state) => {
        set({ error: null });
        const session = await authApi.googleCallback(code, state);
        get().setSession(session.user, session.accessToken);
      },

      signInWithApple: async (code, state, user) => {
        set({ error: null });
        const session = await authApi.appleCallback(code, state, user);
        get().setSession(session.user, session.accessToken);
      },

      register: async (payload) => {
        set({ error: null });
        const session = await authApi.register(payload);
        clearPendingRegistration();
        get().setSession(session.user, session.accessToken);
      },

      logout: async () => {
        // Tell the API first (it revokes the cookie's session and clears the cookie), then drop
        // local state — the browser holds the credential, so a local-only clear would leave the
        // refresh session alive server-side.
        try {
          await authApi.logout();
        } catch {
          /* ignore — the local session is cleared regardless */
        }
        get().clearSession();
      },

      sendOtp: async (phoneNumber, userId) => {
        set({ error: null });
        await authApi.sendOtp(phoneNumber, userId);
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
        // The cookie is the credential; a persisted user says a session may exist.
        // The same coordinator as a 401 retry: two callers must not both present the
        // current refresh cookie, or the second one is a reuse and the family is revoked.
        if (!get().user && !get().accessToken) return false;
        const { refreshSessionCredential } = await import("@/services/auth/api-client");
        const ok = await refreshSessionCredential();
        if (!ok) get().clearSession();
        return ok;
      },

      fetchCurrentUser: async () => {
        const user = await authApi.fetchCurrentUser();
        set({ user });
      },
    }),
    {
      name: "homigo-auth",
      version: AUTH_PERSIST_VERSION,
      // Older snapshots carried tokens: keep the profile, drop the rest (see auth-persist.ts).
      migrate: (persisted, fromVersion) => migrateAuthSnapshot(persisted, fromVersion) as unknown as AuthState,
      /**
       * NO TOKENS IN localStorage. The access token is memory-only and the refresh token is an
       * HttpOnly, SameSite=Strict, audience-scoped cookie the browser holds for /api/auth — so an
       * XSS read of localStorage yields a user profile, not a session. Only the profile is persisted,
       * to render the signed-in shell before the first refresh returns.
       */
      partialize: (state) => ({
        user: state.user,
      }),
      // Never let a stale localStorage snapshot replace store actions.
      merge: (persisted, current) => {
        const p = persisted as { user?: AuthUser | null } | undefined;
        return {
          ...current,
          user: p && "user" in p ? (p.user ?? null) : current.user,
        };
      },
      onRehydrateStorage: () => (state) => {
        if (state?.user) {
          state.status = "idle";
          // Keep the middleware marker cookie in sync with the persisted session.
          setSessionCookie();
        } else {
          state!.status = "unauthenticated";
          clearSessionCookie();
        }
      },
    },
  ),
);

configureApiClient({
  getAccessToken: () => useAuthStore.getState().accessToken,
  // A persisted user is the session marker; the refresh token itself is an HttpOnly cookie now.
  hasSession: () => Boolean(useAuthStore.getState().user),
  setAccessToken: (accessToken) => {
    useAuthStore.setState({ accessToken });
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
