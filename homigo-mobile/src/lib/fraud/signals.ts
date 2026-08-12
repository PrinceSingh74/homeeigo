import Constants from "expo-constants";
import { Platform } from "react-native";
import { getDeviceId } from "@/lib/auth/device";

function hashString(input: string): string {
  let h = 5381;
  for (let i = 0; i < input.length; i++) h = (h * 33) ^ input.charCodeAt(i);
  return `df-${(h >>> 0).toString(16)}`;
}

export function getDeviceFingerprint(): string {
  const parts = [
    Platform.OS,
    String(Platform.Version),
    Constants.sessionId ?? "",
    getDeviceId(),
    Constants.expoConfig?.slug ?? "homigo",
  ];
  return hashString(parts.join("|"));
}

export function getTimezone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}

export function getFraudHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "x-device-id": getDeviceId(),
    "x-device-fingerprint": getDeviceFingerprint(),
  };
  const tz = getTimezone();
  if (tz) headers["x-timezone"] = tz;
  return headers;
}

export function getFraudBodyFields(): {
  deviceFingerprint?: string;
  timezone?: string;
} {
  return {
    deviceFingerprint: getDeviceFingerprint(),
    timezone: getTimezone(),
  };
}
