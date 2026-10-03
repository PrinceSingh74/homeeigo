import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import {
  configureAuthSession,
  PartnerApiError,
  partnerApi,
  refreshAccessTokenOnce,
  setApiAccessToken,
  type PartnerUser,
} from "@/services/partner-api";
import { appStorage } from "@/lib/secure-storage";
import { adoptRefreshedSession, resetPresenceSession } from "@/lib/presence-session";

type AuthState = {
  user: PartnerUser | null;
  accessToken: string | null;
  refreshToken: string | null;
  hydrated: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  bootstrap: () => Promise<void>;
};

class NotAPartnerError extends Error {}

function ensurePartnerRole(user: PartnerUser) {
  if (user.role === "VENDOR" || user.role === "PROVIDER") return;
  if (user.role === "ADMIN") {
    throw new NotAPartnerError("Admins can't sign into the partner app. Use the admin panel.");
  }
  throw new NotAPartnerError(
    "This account is not registered as a HOMEEIGO partner. Apply for partner onboarding to continue.",
  );
}

/**
 * Stop everything that acts on the partner's behalf with the old credentials: realtime sockets
 * (they key off `accessToken` and close when it becomes null — this closes them immediately),
 * background GPS, and cached server data from the previous account.
 * Dynamic imports: these modules import this store, so static imports would be circular.
 */
async function tearDownSessionSideEffects() {
  try {
    const { disconnectPartnerRealtime } = await import("@/lib/realtime-client");
    disconnectPartnerRealtime();
  } catch {
    /* best effort */
  }
  try {
    const { stopBackgroundLocation } = await import("@/lib/background-location");
    await stopBackgroundLocation();
  } catch {
    /* best effort */
  }
  try {
    const { queryClient } = await import("@/providers/query-client");
    queryClient.clear();
  } catch {
    /* best effort */
  }
  resetPresenceSession();
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      accessToken: null,
      refreshToken: null,
      hydrated: false,

      /**
       * Validate the persisted session. An expired 1 h access token is NOT a reason to sign out:
       * `/api/user/me` answers 401, the API layer refreshes once and retries. The session is wiped
       * only when the server refuses the refresh token (handled by `onSessionRejected`) or the
       * account is not a partner. A network failure keeps the session — a partner who opens the app
       * offline must not be logged out.
       */
      bootstrap: async () => {
        const { accessToken, refreshToken } = get();
        if (!accessToken && !refreshToken) {
          set({ hydrated: true });
          return;
        }
        setApiAccessToken(accessToken);
        try {
          if (!accessToken && refreshToken) {
            const outcome = await refreshAccessTokenOnce();
            if (outcome.kind !== "refreshed") {
              // rejected → already torn down by onSessionRejected; unavailable → stay signed in.
              set({ hydrated: true });
              return;
            }
          }
          const me = await partnerApi.me();
          ensurePartnerRole(me.user);
          set({ user: me.user, hydrated: true });
        } catch (err) {
          const definitive =
            err instanceof NotAPartnerError ||
            (err instanceof PartnerApiError && (err.status === 403 || (err.status === 401 && !get().refreshToken)));
          if (definitive) {
            setApiAccessToken(null);
            set({ user: null, accessToken: null, refreshToken: null, hydrated: true });
            await tearDownSessionSideEffects();
            return;
          }
          // Network / 5xx / refresh temporarily unreachable: keep the persisted session.
          set({ hydrated: true });
        }
      },

      login: async (email, password) => {
        const payload = await partnerApi.login(email.trim().toLowerCase(), password);
        // Login response omits role — confirm via /me (same as partner-web).
        setApiAccessToken(payload.accessToken);
        let me: { user: PartnerUser };
        try {
          me = await partnerApi.me();
          ensurePartnerRole(me.user);
        } catch (err) {
          setApiAccessToken(get().accessToken);
          throw err;
        }
        set({
          user: me.user,
          accessToken: payload.accessToken,
          refreshToken: payload.refreshToken,
          hydrated: true,
        });
      },

      logout: async () => {
        const { refreshToken, accessToken } = get();
        if (accessToken && refreshToken) {
          setApiAccessToken(accessToken);
          // Revoke this device's push token BEFORE the session is torn down — it needs the
          // still-valid access token to authenticate. Otherwise a signed-out phone keeps
          // receiving the next partner's job alerts on this device.
          const { revokePushTokenForLogout } = await import("@/hooks/use-push-notifications");
          await revokePushTokenForLogout();
          try {
            await partnerApi.logout(refreshToken);
          } catch {
            // Local session still cleared if server logout fails.
          }
        }
        setApiAccessToken(null);
        set({ user: null, accessToken: null, refreshToken: null });
        await tearDownSessionSideEffects();
      },
    }),
    {
      name: "homeeigo-partner-auth",
      storage: createJSONStorage(() => appStorage),
      partialize: (s) => ({
        user: s.user,
        accessToken: s.accessToken,
        refreshToken: s.refreshToken,
      }),
      onRehydrateStorage: () => (state) => {
        if (state?.accessToken) setApiAccessToken(state.accessToken);
        // Leave hydrated=false until bootstrap() validates the session. Otherwise HQ
        // screens fire queries with a stale token and stick on 401.
      },
    },
  ),
);

let sessionRejectionInFlight = false;

/**
 * Wire the API layer's refresh path to this store. Tokens are persisted through the store's
 * persist storage, i.e. expo-secure-store on device — the same place login writes them.
 */
configureAuthSession({
  getRefreshToken: () => useAuthStore.getState().refreshToken,
  onTokensRefreshed: ({ accessToken, refreshToken, sessionId }) => {
    useAuthStore.setState({ accessToken, refreshToken });
    adoptRefreshedSession(sessionId);
  },
  onSessionRejected: async () => {
    // Idempotent: several requests can observe the same rejected refresh.
    if (sessionRejectionInFlight) return;
    const s = useAuthStore.getState();
    if (!s.accessToken && !s.refreshToken && !s.user) {
      useAuthStore.setState({ hydrated: true });
      return;
    }
    sessionRejectionInFlight = true;
    try {
      // The push token cannot be revoked here — revoking needs a valid session, which is exactly
      // what was just refused. The server already revoked the session; the device row is reclaimed
      // on the next login from this phone (same deviceId).
      setApiAccessToken(null);
      useAuthStore.setState({ user: null, accessToken: null, refreshToken: null, hydrated: true });
      await tearDownSessionSideEffects();
      try {
        const { router } = await import("expo-router");
        router.replace("/login");
      } catch {
        // Navigation not mounted yet — app/index.tsx redirects to /login once hydrated.
      }
    } finally {
      sessionRejectionInFlight = false;
    }
  },
});
