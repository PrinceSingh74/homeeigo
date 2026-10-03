"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { AdminApiError, getErrorMessage } from "@/lib/api-error";
import { configureApiClient, ensureAccessToken } from "@/lib/api-client";
import { adminAuthApi } from "@/services/auth-api";
import { setSentryUser } from "@/lib/sentry";
import type { CurrentUser } from "@/types/admin";

type AdminAuthStatus = "idle" | "initializing" | "authenticated" | "unauthenticated";

type AdminState = {
  user: CurrentUser | null;
  accessToken: string | null;
  status: AdminAuthStatus;
  error: string | null;
  setSession: (user: CurrentUser, accessToken: string) => void;
  setError: (msg: string | null) => void;
  clearSession: () => void;
  bootstrap: () => Promise<void>;
  login: (email: string, password: string) => Promise<{ ok: true } | { ok: false; message: string }>;
  logout: () => Promise<void>;
};

export const useAdminStore = create<AdminState>()(
  persist(
    (set, get) => ({
      user: null,
      accessToken: null,
      status: "idle",
      error: null,

      setSession: (user, accessToken) => {
        setSentryUser({ id: (user as { id?: string })?.id, role: (user as { role?: string })?.role });
        set({
          user,
          accessToken,
          status: "authenticated",
          error: null,
        });
      },

      setError: (error) => set({ error }),

      clearSession: () => {
        setSentryUser(null);
        set({
          user: null,
          accessToken: null,
          status: "unauthenticated",
          error: null,
        });
      },

      bootstrap: async () => {
        const { user: persisted, status } = get();
        if (status === "initializing") return;
        set({ status: "initializing", error: null });

        // A persisted profile means a refresh cookie may exist; the refresh call proves it.
        if (!persisted) {
          set({ status: "unauthenticated" });
          return;
        }

        try {
          // accessToken is session-only. Refresh first so /me is not a guaranteed 401
          // → refresh → /me waterfall on every full reload.
          if (!get().accessToken) {
            const refreshed = await ensureAccessToken();
            if (!refreshed) {
              get().clearSession();
              return;
            }
          }
          const user = await adminAuthApi.me();
          if (user.role !== "ADMIN") {
            get().clearSession();
            set({
              status: "unauthenticated",
              error: "Account does not have admin access.",
            });
            return;
          }
          set({ user, status: "authenticated" });
        } catch {
          get().clearSession();
        }
      },

      login: async (email, password) => {
        set({ error: null });
        try {
          const payload = await adminAuthApi.login(email, password);
          if (payload.user.role && payload.user.role !== "ADMIN") {
            set({ error: "This account is not an admin." });
            return { ok: false, message: "This account is not an admin." };
          }

          // Login response doesn't include role in the user object — refetch /me to confirm.
          set({ accessToken: payload.accessToken });
          const user = await adminAuthApi.me();
          if (user.role !== "ADMIN") {
            // Wrong role — wipe and bail.
            get().clearSession();
            return { ok: false, message: "This account is not an admin." };
          }
          get().setSession(user, payload.accessToken);
          return { ok: true };
        } catch (error) {
          const message = getErrorMessage(error);
          set({ error: message });
          if (error instanceof AdminApiError && error.status === 401) {
            return { ok: false, message: "Invalid email or password." };
          }
          return { ok: false, message };
        }
      },

      logout: async () => {
        // Call the API first: it revokes the cookie's session server-side and clears the cookie.
        try {
          await adminAuthApi.logout();
        } catch {
          /* the local session is cleared regardless */
        }
        get().clearSession();
      },
    }),
    {
      name: "homigo-admin-store",
      /**
       * NO TOKENS IN localStorage. The access token is memory-only; the refresh token is an
       * HttpOnly, SameSite=Strict, audience-scoped cookie (hg_rt_admin) that JavaScript cannot read.
       */
      partialize: (state) => ({
        user: state.user,
      }),
      onRehydrateStorage: () => (state) => {
        if (state?.user) state.status = "idle";
        else if (state) state.status = "unauthenticated";
      },
    },
  ),
);

configureApiClient({
  getAccessToken: () => useAdminStore.getState().accessToken,
  // A persisted profile is the session marker; the credential is the HttpOnly cookie.
  hasSession: () => Boolean(useAdminStore.getState().user),
  setAccessToken: (accessToken) => {
    useAdminStore.setState({ accessToken });
  },
  clearSession: () => useAdminStore.getState().clearSession(),
});

export function useAdminUserName(): string {
  const user = useAdminStore((s) => s.user);
  if (!user) return "Admin";
  const name = `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim();
  return name || user.email || "Admin";
}
