"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { PartnerApiError, getErrorMessage } from "@/lib/api-error";
import { configureApiClient } from "@/lib/api-client";
import { partnerAuthApi } from "@/services/auth-api";
import { setSentryUser } from "@/lib/sentry";
import type { AuthStatus, PartnerUser } from "@/types/partner";

type PartnerAuthState = {
  user: PartnerUser | null;
  accessToken: string | null;
  refreshToken: string | null;
  status: AuthStatus;
  error: string | null;
  setSession: (user: PartnerUser, accessToken: string, refreshToken: string) => void;
  setError: (msg: string | null) => void;
  clearSession: () => void;
  bootstrap: () => Promise<void>;
  login: (
    email: string,
    password: string,
  ) => Promise<{ ok: true } | { ok: false; message: string }>;
  loginWithOtp: (
    phoneNumber: string,
    otp: string,
  ) => Promise<{ ok: true } | { ok: false; message: string }>;
  sendOtp: (
    phoneNumber: string,
  ) => Promise<{ ok: true; devOtp?: string } | { ok: false; message: string }>;
  logout: () => Promise<void>;
};

function ensureProviderRole(user: PartnerUser): { ok: true } | { ok: false; message: string } {
  // Backend uses "VENDOR" as the partner/provider role; accept "PROVIDER" too for forward-compat.
  if (user.role === "VENDOR" || user.role === "PROVIDER") return { ok: true };
  if (user.role === "ADMIN") {
    return {
      ok: false,
      message: "Admins can't sign into the partner console. Use the admin panel.",
    };
  }
  return {
    ok: false,
    message:
      "This account is not registered as a HOMEEIGO partner. Apply for partner onboarding to continue.",
  };
}

export const usePartnerStore = create<PartnerAuthState>()(
  persist(
    (set, get) => ({
      user: null,
      accessToken: null,
      refreshToken: null,
      status: "idle",
      error: null,

      setSession: (user, accessToken, refreshToken) => {
        setSentryUser({ id: (user as { id?: string })?.id, role: (user as { role?: string })?.role });
        set({
          user,
          accessToken,
          refreshToken,
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
          refreshToken: null,
          status: "unauthenticated",
          error: null,
        });
      },

      bootstrap: async () => {
        const { refreshToken, status } = get();
        if (status === "initializing") return;
        set({ status: "initializing", error: null });

        if (!refreshToken) {
          set({ status: "unauthenticated" });
          return;
        }

        try {
          if (!get().accessToken && refreshToken) {
            const tokens = await partnerAuthApi.refresh(refreshToken);
            set({
              accessToken: tokens.accessToken,
              refreshToken: tokens.refreshToken,
            });
          }
          const user = await partnerAuthApi.me();
          const guard = ensureProviderRole(user);
          if (!guard.ok) {
            get().clearSession();
            set({ status: "unauthenticated", error: guard.message });
            return;
          }
          set({ user, status: "authenticated" });
        } catch {
          get().clearSession();
          set({ status: "unauthenticated" });
        }
      },

      login: async (email, password) => {
        set({ error: null });
        try {
          const payload = await partnerAuthApi.login(email, password);
          // Login response doesn't always include role — confirm via /me.
          set({
            accessToken: payload.accessToken,
            refreshToken: payload.refreshToken,
          });
          const user = await partnerAuthApi.me();
          const guard = ensureProviderRole(user);
          if (!guard.ok) {
            get().clearSession();
            set({ error: guard.message });
            return { ok: false, message: guard.message };
          }
          get().setSession(user, payload.accessToken, payload.refreshToken);
          return { ok: true };
        } catch (error) {
          const message = getErrorMessage(error);
          set({ error: message });
          if (error instanceof PartnerApiError && error.status === 401) {
            return { ok: false, message: "Invalid email or password." };
          }
          return { ok: false, message };
        }
      },

      sendOtp: async (phoneNumber) => {
        set({ error: null });
        try {
          const res = await partnerAuthApi.sendOtp(phoneNumber);
          return { ok: true, devOtp: res.data?.devOtp };
        } catch (error) {
          const message = getErrorMessage(error);
          set({ error: message });
          return { ok: false, message };
        }
      },

      loginWithOtp: async (phoneNumber, otp) => {
        set({ error: null });
        try {
          const payload = await partnerAuthApi.verifyOtp(phoneNumber, otp);
          if (!payload?.accessToken || !payload?.refreshToken) {
            const message = "OTP verified but no session was issued. Please try again.";
            set({ error: message });
            return { ok: false, message };
          }
          set({
            accessToken: payload.accessToken,
            refreshToken: payload.refreshToken,
          });
          const user = await partnerAuthApi.me();
          const guard = ensureProviderRole(user);
          if (!guard.ok) {
            get().clearSession();
            set({ error: guard.message });
            return { ok: false, message: guard.message };
          }
          get().setSession(user, payload.accessToken, payload.refreshToken);
          return { ok: true };
        } catch (error) {
          const message = getErrorMessage(error);
          set({ error: message });
          return { ok: false, message };
        }
      },

      logout: async () => {
        const token = get().refreshToken;
        get().clearSession();
        if (token) {
          try {
            await partnerAuthApi.logout(token);
          } catch {
            /* already cleared locally */
          }
        }
      },
    }),
    {
      name: "homigo-partner-store",
      partialize: (state) => ({
        user: state.user,
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
        status: state.status === "authenticated" ? ("authenticated" as const) : undefined,
      }),
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        if (state.status === "authenticated" && state.user && (state.accessToken || state.refreshToken)) {
          return;
        }
        if (state.refreshToken) state.status = "idle";
        else state.status = "unauthenticated";
      },
    },
  ),
);

configureApiClient({
  getAccessToken: () => usePartnerStore.getState().accessToken,
  getRefreshToken: () => usePartnerStore.getState().refreshToken,
  setTokens: (accessToken, refreshToken) => {
    usePartnerStore.setState({ accessToken, refreshToken });
  },
  clearSession: () => usePartnerStore.getState().clearSession(),
});

export function usePartnerUserName(): string {
  const user = usePartnerStore((s) => s.user);
  if (!user) return "Partner";
  const name = `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim();
  return name || user.email || "Partner";
}
