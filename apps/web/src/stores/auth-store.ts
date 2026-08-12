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

type AuthState = {
  user: AuthUser | null;
  accessToken: string | null;
  refreshToken: string | null;
  status: AuthStatus;
  error: string | null;
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

      setSession: (user, accessToken, refreshToken) => {
        setSessionCookie();
        setSentryUser({ id: (user as { id?: string })?.id, role: (user as { role?: string })?.role });
        set({
          user,
          accessToken,
          refreshToken,
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
          refreshToken: null,
          status: "unauthenticated",
          error: null,
        });
      },

      setError: (error) => set({ error }),

      bootstrap: async () => {
        const { refreshToken, status } = get();
        if (status === "initializing") return;
        const { markBootstrapStart, markBootstrapComplete } = await import("@/lib/auth/bootstrap-gate");
        markBootstrapStart();
        set({ status: "initializing", error: null });

        if (!refreshToken) {
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
        clearPendingRegistration();
        get().setSession(session.user, session.accessToken, session.refreshToken);
      },

      logout: async () => {
        const token = get().refreshToken;
        get().clearSession();
        if (token) {
          try {
            await authApi.logout(token);
          } catch {
            /* ignore — client session already cleared */
          }
        }
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
        const currentRefresh = get().refreshToken;
        if (!currentRefresh) return false;
        try {
          const data = await authApi.refresh(currentRefresh);
          set({
            accessToken: data.accessToken,
            refreshToken: data.refreshToken,
          });
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
      partialize: (state) => ({
        user: state.user,
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
      }),
      onRehydrateStorage: () => (state) => {
        if (state?.refreshToken) {
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
  getRefreshToken: () => useAuthStore.getState().refreshToken,
  setTokens: (accessToken, refreshToken) => {
    useAuthStore.setState({ accessToken, refreshToken });
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
