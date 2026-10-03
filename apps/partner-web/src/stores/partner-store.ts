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
  status: AuthStatus;
  error: string | null;
  setSession: (user: PartnerUser, accessToken: string) => void;
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
          if (!get().accessToken) {
            const tokens = await partnerAuthApi.refresh();
            set({ accessToken: tokens.accessToken });
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
          set({ accessToken: payload.accessToken });
          const user = await partnerAuthApi.me();
          const guard = ensureProviderRole(user);
          if (!guard.ok) {
            get().clearSession();
            set({ error: guard.message });
            return { ok: false, message: guard.message };
          }
          get().setSession(user, payload.accessToken);
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
          if (!payload?.accessToken) {
            const message = "OTP verified but no session was issued. Please try again.";
            set({ error: message });
            return { ok: false, message };
          }
          set({ accessToken: payload.accessToken });
          const user = await partnerAuthApi.me();
          const guard = ensureProviderRole(user);
          if (!guard.ok) {
            get().clearSession();
            set({ error: guard.message });
            return { ok: false, message: guard.message };
          }
          get().setSession(user, payload.accessToken);
          return { ok: true };
        } catch (error) {
          const message = getErrorMessage(error);
          set({ error: message });
          return { ok: false, message };
        }
      },

      logout: async () => {
        // Call the API first: it revokes the cookie's session server-side and clears the cookie.
        try {
          await partnerAuthApi.logout();
        } catch {
          /* the local session is cleared regardless */
        }
        get().clearSession();
      },
    }),
    {
      name: "homigo-partner-store",
      /**
       * NO TOKENS IN localStorage. The access token is memory-only; the refresh token is an
       * HttpOnly, SameSite=Strict, audience-scoped cookie (hg_rt_partner) that JavaScript cannot
       * read. Only the profile is persisted, so the shell can render before the first refresh.
       */
      partialize: (state) => ({
        user: state.user,
        status: state.status === "authenticated" ? ("authenticated" as const) : undefined,
      }),
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        if (state.status === "authenticated" && state.user && state.accessToken) return;
        state.status = state.user ? "idle" : "unauthenticated";
      },
    },
  ),
);

configureApiClient({
  getAccessToken: () => usePartnerStore.getState().accessToken,
  // A persisted profile is the session marker; the credential is the HttpOnly cookie.
  hasSession: () => Boolean(usePartnerStore.getState().user),
  setAccessToken: (accessToken) => {
    usePartnerStore.setState({ accessToken });
  },
  clearSession: () => usePartnerStore.getState().clearSession(),
});

export function usePartnerUserName(): string {
  const user = usePartnerStore((s) => s.user);
  if (!user) return "Partner";
  const name = `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim();
  return name || user.email || "Partner";
}
