import { useEffect } from "react";
import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import { router } from "expo-router";
import { useAuthStore } from "@/stores/auth-store";
import { getDeviceId, getDeviceName } from "@/lib/device";
import { deleteSecureItem } from "@/lib/secure-storage";
import { canRegisterExpoPushToken, logExpoGoPushSkipped } from "@/lib/push-notifications-capability";
import { resolveNotificationHref } from "@/lib/notification-routing";
import {
  pushRegistrar,
  type PushOutcome,
  type PushPermission,
  type PushRegistrationDeps,
} from "@/lib/push-registration";
import { partnerApi } from "@/services/partner-api";

export { resolveNotificationHref };

/** Legacy persisted markers (superseded by the in-memory registrar); still cleared on logout. */
const PUSH_TOKEN_KEY = "homeeigo-partner-expo-push-token";
const PUSH_TOKEN_SYNCED_KEY = "homeeigo-partner-expo-push-token-synced";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

/** Notification taps already routed in this app launch (see the tap-routing effect). */
const routedTaps = new Set<string>();

function pushReady(): boolean {
  return canRegisterExpoPushToken();
}

function pushPlatform(): "IOS" | "ANDROID" | "WEB" {
  if (Platform.OS === "ios") return "IOS";
  if (Platform.OS === "android") return "ANDROID";
  return "WEB";
}

function toPermission(status: string): PushPermission {
  return status === "granted" || status === "denied" ? status : "undetermined";
}

/**
 * The native side of registration. The rules (what is registered, when, and what is never sent —
 * e.g. the raw FCM/APNs token the push-token listener is handed) live in `@/lib/push-registration`,
 * covered by `npm run test:unit`.
 */
const nativePush: PushRegistrationDeps = {
  isSupported: pushReady,
  getPermission: async () => toPermission((await Notifications.getPermissionsAsync()).status),
  requestPermission: async () => toPermission((await Notifications.requestPermissionsAsync()).status),
  getExpoPushToken: async (nativeToken) => {
    const token = await Notifications.getExpoPushTokenAsync(
      nativeToken ? { devicePushToken: nativeToken as Notifications.DevicePushToken } : undefined,
    );
    return token.data;
  },
  registerWithBackend: async (expoPushToken) => {
    const deviceId = await getDeviceId();
    await partnerApi.devices.registerPushToken({
      deviceId,
      expoPushToken,
      platform: pushPlatform(),
      deviceName: getDeviceName(),
      appVersion: Constants.expoConfig?.version ?? undefined,
      osVersion: String(Platform.Version),
    });
  },
};

function reportOutcome(outcome: PushOutcome): void {
  // Declining permission is a legitimate end state (the app falls back to pull-to-refresh/polling
  // for new job requests); a failure is best-effort too, but must be visible while developing.
  if (outcome.kind === "failed" && typeof __DEV__ !== "undefined" && __DEV__) {
    console.warn(`[Homeeigo Partner] push registration failed at ${outcome.stage}`, outcome.error);
  }
}

/**
 * Revoke this device's push token server-side. Called on logout, while the access token is still
 * set, so a signed-out phone stops receiving job alerts. The server's `/api/auth/logout` does NOT
 * unlink the device when a refresh token is sent (apps/backend/src/routes/auth.ts), so this DELETE
 * is the only unlink. Bounded and best-effort: a failed or hung revoke never blocks logout.
 */
export async function revokePushTokenForLogout(): Promise<void> {
  await pushRegistrar.signOut(async () => partnerApi.devices.revoke(await getDeviceId()));
  await deleteSecureItem(PUSH_TOKEN_SYNCED_KEY).catch(() => undefined);
  await deleteSecureItem(PUSH_TOKEN_KEY).catch(() => undefined);
}

export function usePushNotifications(): void {
  // The partner store has no `status` field (that's the customer app's shape) — an authenticated
  // session here is a hydrated store holding both a user and an access token.
  const userId = useAuthStore((s) => (s.hydrated && s.user && s.accessToken ? s.user.id : null));
  const isAuthenticated = userId !== null;

  // Registration, once per signed-in partner per app launch (the server's upsert is idempotent).
  // Keyed on the partner, so a different account on this phone always re-links the device.
  useEffect(() => {
    // Signed out by ANY path — including a refused session, where no revoke is possible: forget
    // the registration so the next sign-in re-links the device.
    if (!userId) {
      pushRegistrar.forget();
      return;
    }
    if (!pushReady()) {
      logExpoGoPushSkipped();
      return;
    }
    void pushRegistrar.register(nativePush, userId).then(reportOutcome);
  }, [userId]);

  // The listener is handed the NATIVE token (and also fires on every token fetch): exchange it for
  // the Expo token before anything reaches the backend.
  useEffect(() => {
    if (!pushReady() || !userId) return;
    const sub = Notifications.addPushTokenListener((nativeToken) => {
      void pushRegistrar.onNativeTokenChanged(nativePush, userId, nativeToken).then(reportOutcome);
    });
    return () => sub.remove();
  }, [userId]);

  // Tap routing — both the warm case (app running) and the cold case (killed, opened by tap).
  useEffect(() => {
    if (!pushReady() || !isAuthenticated) return;

    /**
     * A tapped notification that carries a booking opens that job (`/job/<id>`); the rest go where
     * `resolveNotificationHref` says. Each tap is routed ONCE: the warm listener and the cold-start
     * "last response" can both deliver the same tap, and the last response is also returned again on
     * every later sign-in until the app is killed.
     */
    const open = (response: Notifications.NotificationResponse) => {
      const key = `${response.notification.request.identifier}:${response.notification.date}`;
      if (routedTaps.has(key)) return;
      routedTaps.add(key);
      const data = response.notification.request.content.data as Record<string, unknown> | undefined;
      router.push(resolveNotificationHref(data) as never);
    };

    const sub = Notifications.addNotificationResponseReceivedListener(open);

    void Notifications.getLastNotificationResponseAsync().then((response) => {
      if (response) open(response);
    });

    return () => sub.remove();
  }, [isAuthenticated]);
}
