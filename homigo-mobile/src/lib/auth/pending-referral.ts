import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "homigo_pending_referral";

export async function savePendingReferralCode(code: string): Promise<void> {
  const normalized = code.trim().toUpperCase();
  if (!normalized) return;
  try {
    await AsyncStorage.setItem(KEY, normalized);
  } catch {
    /* ignore */
  }
}

export async function readPendingReferralCode(): Promise<string | undefined> {
  try {
    const v = await AsyncStorage.getItem(KEY);
    return v?.trim() ? v.toUpperCase() : undefined;
  } catch {
    return undefined;
  }
}

export async function consumePendingReferralCode(): Promise<string | undefined> {
  const code = await readPendingReferralCode();
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  return code;
}
