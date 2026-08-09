import * as SecureStore from "expo-secure-store";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { partnerApi, setApiAccessToken, type PartnerUser } from "@/services/partner-api";

const secureStorage = {
  getItem: (name: string) => SecureStore.getItemAsync(name),
  setItem: (name: string, value: string) => SecureStore.setItemAsync(name, value),
  removeItem: (name: string) => SecureStore.deleteItemAsync(name),
};

type AuthState = {
  user: PartnerUser | null;
  accessToken: string | null;
  refreshToken: string | null;
  hydrated: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  bootstrap: () => Promise<void>;
};

function ensurePartnerRole(user: PartnerUser) {
  if (user.role === "VENDOR" || user.role === "PROVIDER") return;
  if (user.role === "ADMIN") {
    throw new Error("Admins can't sign into the partner app. Use the admin panel.");
  }
  throw new Error(
    "This account is not registered as a HOMEEIGO partner. Apply for partner onboarding to continue.",
  );
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      accessToken: null,
      refreshToken: null,
      hydrated: false,

      bootstrap: async () => {
        const { accessToken, user } = get();
        if (!accessToken) {
          set({ hydrated: true });
          return;
        }
        setApiAccessToken(accessToken);
        try {
          const me = await partnerApi.me();
          ensurePartnerRole(me.user);
          set({ user: me.user, hydrated: true });
        } catch {
          set({ user: null, accessToken: null, refreshToken: null, hydrated: true });
          setApiAccessToken(null);
        }
      },

      login: async (email, password) => {
        const payload = await partnerApi.login(email.trim().toLowerCase(), password);
        // Login response omits role — confirm via /me (same as partner-web).
        setApiAccessToken(payload.accessToken);
        const me = await partnerApi.me();
        ensurePartnerRole(me.user);
        set({
          user: me.user,
          accessToken: payload.accessToken,
          refreshToken: payload.refreshToken,
        });
      },

      logout: async () => {
        const { refreshToken, accessToken } = get();
        if (accessToken && refreshToken) {
          setApiAccessToken(accessToken);
          try {
            await partnerApi.logout(refreshToken);
          } catch {
            // Local session still cleared if server logout fails.
          }
        }
        setApiAccessToken(null);
        set({ user: null, accessToken: null, refreshToken: null });
      },
    }),
    {
      name: "homeeigo-partner-auth",
      storage: createJSONStorage(() => secureStorage),
      partialize: (s) => ({
        user: s.user,
        accessToken: s.accessToken,
        refreshToken: s.refreshToken,
      }),
      onRehydrateStorage: () => (state) => {
        if (state?.accessToken) setApiAccessToken(state.accessToken);
        if (state) state.hydrated = true;
      },
    },
  ),
);
