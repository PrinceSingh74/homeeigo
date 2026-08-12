import AsyncStorage from "@react-native-async-storage/async-storage";
import type { PendingRegistration } from "@/types/auth";

const STORAGE_KEY = "homigo_pending_registration";

export async function savePendingRegistration(data: PendingRegistration): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

export async function loadPendingRegistration(): Promise<PendingRegistration | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PendingRegistration;
  } catch {
    return null;
  }
}

export async function clearPendingRegistration(): Promise<void> {
  await AsyncStorage.removeItem(STORAGE_KEY);
}
