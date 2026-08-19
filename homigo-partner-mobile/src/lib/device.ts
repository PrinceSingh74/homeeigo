import { Platform } from "react-native";
import { getSecureItem, setSecureItem } from "@/lib/secure-storage";

const DEVICE_KEY = "homeeigo-partner-device-id";

export async function getDeviceId(): Promise<string> {
  const existing = await getSecureItem(DEVICE_KEY);
  if (existing) return existing;
  const id = `partner-${Platform.OS}-${Date.now().toString(36)}`;
  await setSecureItem(DEVICE_KEY, id);
  return id;
}

export function getDeviceName(): string {
  return `HOMEEIGO Partner · ${Platform.OS}`;
}
