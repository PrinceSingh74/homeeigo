import { useEffect } from "react";
import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import { useAuthStore } from "@/stores/auth-store";
import { ensureDeviceId } from "@/lib/auth/device";
import {
  canRegisterExpoPushToken,
  logExpoGoPushSkipped,
} from "@/lib/push-notifications-capability";
import { coreApi } from "@/services/core/api";

const PUSH_TOKEN_KEY = "homigo_expo_push_token";

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

async function syncPushTokenToBackend(token: string) {
  const deviceId = await ensureDeviceId();
  const stored = await AsyncStorage.getItem(PUSH_TOKEN_KEY);
  if (stored === token) {
    const lastSync = await AsyncStorage.getItem(`${PUSH_TOKEN_KEY}:synced`);
    if (lastSync === token) return;
  }

  await coreApi.users.registerPushToken({
    deviceId,
    expoPushToken: token,
    platform: pushPlatform(),
    deviceName: Platform.OS,
    appVersion: Constants.expoConfig?.version ?? undefined,
    osVersion: String(Platform.Version),
  });
  await AsyncStorage.multiSet([
    [PUSH_TOKEN_KEY, token],
    [`${PUSH_TOKEN_KEY}:synced`, token],
  ]);
}

async function registerForPushNotificationsAsync(): Promise<string | null> {
  if (!canRegisterExpoPushToken()) return null;

  const { status: existing } = await Notifications.getPermissionsAsync();
  let finalStatus = existing;
  if (existing !== "granted") {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  if (finalStatus !== "granted") return null;

  const token = await Notifications.getExpoPushTokenAsync();
  await AsyncStorage.setItem(PUSH_TOKEN_KEY, token.data);
  return token.data;
}

export function usePushNotifications() {
  const isAuthenticated = useAuthStore((s) => s.status === "authenticated");

  useEffect(() => {
    if (!canRegisterExpoPushToken()) {
      logExpoGoPushSkipped();
      return;
    }
    if (!isAuthenticated) return;
    void (async () => {
      const token = await registerForPushNotificationsAsync();
      if (token) {
        try {
          await syncPushTokenToBackend(token);
        } catch {
          await AsyncStorage.removeItem(`${PUSH_TOKEN_KEY}:synced`);
        }
      }
    })();
  }, [isAuthenticated]);

  useEffect(() => {
    if (!canRegisterExpoPushToken()) return;
    if (!isAuthenticated) return;
    const sub = Notifications.addPushTokenListener(({ data }) => {
      void syncPushTokenToBackend(data).catch(() => undefined);
    });
    return () => sub.remove();
  }, [isAuthenticated]);
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
