import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

const memory = new Map<string, string>();

function webStore(): Storage | null {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

export async function getSecureItem(key: string): Promise<string | null> {
  if (Platform.OS === "web") {
    const ls = webStore();
    if (ls) return ls.getItem(key);
    return memory.get(key) ?? null;
  }
  return SecureStore.getItemAsync(key);
}

export async function setSecureItem(key: string, value: string): Promise<void> {
  if (Platform.OS === "web") {
    const ls = webStore();
    if (ls) ls.setItem(key, value);
    else memory.set(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

export async function deleteSecureItem(key: string): Promise<void> {
  if (Platform.OS === "web") {
    const ls = webStore();
    if (ls) ls.removeItem(key);
    else memory.delete(key);
    return;
  }
  await SecureStore.deleteItemAsync(key);
}

export const appStorage = {
  getItem: (name: string) => getSecureItem(name),
  setItem: (name: string, value: string) => setSecureItem(name, value),
  removeItem: (name: string) => deleteSecureItem(name),
};
