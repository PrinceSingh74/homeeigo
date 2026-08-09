import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

const DEVICE_KEY = "homeeigo-partner-device-id";

export async function getDeviceId(): Promise<string> {
  const existing = await SecureStore.getItemAsync(DEVICE_KEY);
  if (existing) return existing;
  const id = `partner-${Platform.OS}-${Date.now().toString(36)}`;
  await SecureStore.setItemAsync(DEVICE_KEY, id);
  return id;
}

export function getDeviceName(): string {
  return `HOMEEIGO Partner · ${Platform.OS}`;
}
