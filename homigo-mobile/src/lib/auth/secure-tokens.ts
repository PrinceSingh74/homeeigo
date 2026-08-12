import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * Long-lived refresh token storage. On iOS/Android the token lives in the hardware-backed
 * Keychain / Keystore via expo-secure-store (NOT plaintext AsyncStorage). On web (dev only —
 * SecureStore is unavailable there) it falls back to AsyncStorage.
 *
 * The short-lived access token is intentionally kept in memory only (never persisted).
 */
const KEY = "homigo_refresh_token";
const isWeb = Platform.OS === "web";

export const secureTokens = {
  async get(): Promise<string | null> {
    try {
      return isWeb ? await AsyncStorage.getItem(KEY) : await SecureStore.getItemAsync(KEY);
    } catch {
      return null;
    }
  },
  async set(token: string): Promise<void> {
    try {
      if (isWeb) await AsyncStorage.setItem(KEY, token);
      else await SecureStore.setItemAsync(KEY, token, { keychainAccessible: SecureStore.WHEN_UNLOCKED });
    } catch {
      /* storage unavailable — session simply won't persist */
    }
  },
  async clear(): Promise<void> {
    try {
      if (isWeb) await AsyncStorage.removeItem(KEY);
      else await SecureStore.deleteItemAsync(KEY);
    } catch {
      /* ignore */
    }
  },
  /** One-time migration: pull any token left in the old AsyncStorage persist blob into SecureStore. */
  async migrateFromLegacy(): Promise<string | null> {
    try {
      const raw = await AsyncStorage.getItem("homigo-auth");
      if (!raw) return null;
      const parsed = JSON.parse(raw) as { state?: { refreshToken?: string | null } };
      const legacy = parsed?.state?.refreshToken;
      if (legacy) {
        await this.set(legacy);
        // strip the token out of the legacy AsyncStorage blob
        if (parsed.state) {
          delete parsed.state.refreshToken;
          await AsyncStorage.setItem("homigo-auth", JSON.stringify(parsed));
        }
        return legacy;
      }
    } catch {
      /* ignore */
    }
    return null;
  },
};
