import { useEffect } from "react";
import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import { useAuthStore } from "@/stores/auth-store";
import { ensureDeviceId } from "@/lib/auth/device";
import {
  canRegisterExpoPushToken,
  logExpoGoPushSkipped,
} from "@/lib/push-notifications-capability";
import {
  pushRegistrar,
  type PushOutcome,
  type PushPermission,
  type PushRegistrationDeps,
} from "@/lib/push/push-registration";
import { coreApi } from "@/services/core/api";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

function pushPlatform(): "IOS" | "ANDROID" | "WEB" {
  if (Platform.OS === "ios") return "IOS";
  if (Platform.OS === "android") return "ANDROID";
  return "WEB";
}

function toPermission(status: string): PushPermission {
  return status === "granted" || status === "denied" ? status : "undetermined";
}

/**
 * The native side of registration. The rules (what is registered, when, and what is never sent)
 * live in `@/lib/push/push-registration`, which the bun logic suite covers.
 */
const nativePush: PushRegistrationDeps = {
  isSupported: canRegisterExpoPushToken,
  getPermission: async () => toPermission((await Notifications.getPermissionsAsync()).status),
  requestPermission: async () => toPermission((await Notifications.requestPermissionsAsync()).status),
  getExpoPushToken: async (nativeToken) => {
    const token = await Notifications.getExpoPushTokenAsync(
      nativeToken ? { devicePushToken: nativeToken as Notifications.DevicePushToken } : undefined,
    );
    return token.data;
  },
  registerWithBackend: async (expoPushToken) => {
    const deviceId = await ensureDeviceId();
    await coreApi.users.registerPushToken({
      deviceId,
      expoPushToken,
      platform: pushPlatform(),
      deviceName: Platform.OS,
      appVersion: Constants.expoConfig?.version ?? undefined,
      osVersion: String(Platform.Version),
    });
  },
};

function reportOutcome(outcome: PushOutcome): void {
  // Registration is best-effort (the app works without push), but a failure must be visible
  // while developing instead of vanishing as an unhandled rejection.
  if (outcome.kind === "failed" && typeof __DEV__ !== "undefined" && __DEV__) {
    console.warn(`[Homeeigo] push registration failed at ${outcome.stage}`, outcome.error);
  }
}

export function usePushNotifications() {
  const userId = useAuthStore((s) => (s.status === "authenticated" ? (s.user?.id ?? null) : null));

  // Once per signed-in user per app launch (the server's upsert is idempotent). Keyed on the user,
  // not just "authenticated", so a different account on this phone always re-links the device.
  useEffect(() => {
    // Signed out by ANY path (logout, refused refresh, "log out everywhere" — which also deactivates
    // this device server-side): forget the registration so the next sign-in re-links the device.
    if (!userId) {
      pushRegistrar.forget();
      return;
    }
    if (!canRegisterExpoPushToken()) {
      logExpoGoPushSkipped();
      return;
    }
    void pushRegistrar.register(nativePush, userId).then(reportOutcome);
  }, [userId]);

  // The listener is handed the NATIVE token (and also fires on every token fetch): exchange it for
  // the Expo token before anything reaches the backend.
  useEffect(() => {
    if (!canRegisterExpoPushToken()) return;
    if (!userId) return;
    const sub = Notifications.addPushTokenListener((nativeToken) => {
      void pushRegistrar.onNativeTokenChanged(nativePush, userId, nativeToken).then(reportOutcome);
    });
    return () => sub.remove();
  }, [userId]);
}

export async function scheduleLocalNotification(input: {
  title: string;
  body: string;
  data?: Record<string, unknown>;
}) {
  if (Platform.OS === "web") return;
  await Notifications.scheduleNotificationAsync({
    content: {
      title: input.title,
      body: input.body,
      data: input.data,
    },
    trigger: null,
  });
}
