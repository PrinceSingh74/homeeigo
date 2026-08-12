import { Platform } from "react-native";
import { isRunningInExpoGo } from "expo";

let expoGoPushWarningLogged = false;

export function isExpoGoEnvironment(): boolean {
  return isRunningInExpoGo();
}

/** Remote Expo push tokens require a dev or store build (not Expo Go SDK 53+). */
export function canRegisterExpoPushToken(): boolean {
  if (Platform.OS === "web") return false;
  return !isRunningInExpoGo();
}

export function logExpoGoPushSkipped(): void {
  if (!isExpoGoEnvironment() || expoGoPushWarningLogged) return;
  expoGoPushWarningLogged = true;
  console.warn(
    "[Homeeigo] Expo push registration is skipped in Expo Go (SDK 53+). Use a development build to test push notifications.",
  );
}
