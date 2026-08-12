import AsyncStorage from "@react-native-async-storage/async-storage";
import { isAuthRoute, sanitizeOAuthReturnUrl } from "@/lib/auth/routes";

const PENDING_KEY = "homigo_apple_oauth_pending";
const PROCESSED_PREFIX = "homigo_apple_oauth_done_";
const PENDING_TTL_MS = 10 * 60 * 1000;
const APPLE_USER_KEY = "homigo_apple_oauth_user";

export type AppleOAuthPending = {
  state: string;
  returnUrl: string;
  startedAt: number;
};

export type AppleOAuthUserParam = {
  email?: string;
  name?: { firstName?: string; lastName?: string };
};

function generateOAuthState(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export async function beginAppleOAuth(returnUrl?: string | null): Promise<string> {
  const state = generateOAuthState();
  const pending: AppleOAuthPending = {
    state,
    returnUrl: sanitizeOAuthReturnUrl(returnUrl),
    startedAt: Date.now(),
  };
  await AsyncStorage.setItem(PENDING_KEY, JSON.stringify(pending));
  return state;
}

export async function consumeAppleOAuthPending(
  urlState: string | null,
): Promise<{ valid: true; returnUrl: string } | { valid: false; returnUrl: string; error: string }> {
  const fallback = sanitizeOAuthReturnUrl("/(tabs)");
  const raw = await AsyncStorage.getItem(PENDING_KEY);
  await AsyncStorage.removeItem(PENDING_KEY);

  if (!raw) {
    return { valid: false, returnUrl: fallback, error: "OAuth session expired. Please sign in with Apple again." };
  }

  let pending: AppleOAuthPending;
  try {
    pending = JSON.parse(raw) as AppleOAuthPending;
  } catch {
    return { valid: false, returnUrl: fallback, error: "OAuth session was invalid. Please try again." };
  }

  if (Date.now() - pending.startedAt > PENDING_TTL_MS) {
    return { valid: false, returnUrl: fallback, error: "OAuth session expired. Please sign in with Apple again." };
  }

  if (!urlState || urlState !== pending.state) {
    return { valid: false, returnUrl: fallback, error: "OAuth security check failed. Please try again." };
  }

  return { valid: true, returnUrl: pending.returnUrl };
}

type OAuthCodeClaim = "proceed" | "duplicate" | "in_flight";

export async function claimAppleAuthorizationCode(code: string): Promise<OAuthCodeClaim> {
  const key = `${PROCESSED_PREFIX}${code}`;
  const existing = await AsyncStorage.getItem(key);
  if (existing === "done") return "duplicate";
  if (existing === "processing") return "in_flight";
  await AsyncStorage.setItem(key, "processing");
  return "proceed";
}

export async function finishAppleAuthorizationCode(code: string, success: boolean): Promise<void> {
  const key = `${PROCESSED_PREFIX}${code}`;
  if (success) await AsyncStorage.setItem(key, "done");
  else await AsyncStorage.removeItem(key);
}

export function getAppleOAuthUserMessage(errorCode: string | null): string {
  if (errorCode === "user_cancelled_authorize") {
    return "Apple sign-in was cancelled. You can try again when ready.";
  }
  if (errorCode === "invalid_grant") {
    return "This sign-in link has expired or was already used. Please try again.";
  }
  return "Apple sign-in could not be completed. Please try again.";
}

export async function saveAppleOAuthUserParam(raw: string | null | undefined): Promise<void> {
  if (!raw) return;
  await AsyncStorage.setItem(APPLE_USER_KEY, raw);
}

export async function readAppleOAuthUserParam(): Promise<AppleOAuthUserParam | undefined> {
  const raw = await AsyncStorage.getItem(APPLE_USER_KEY);
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as AppleOAuthUserParam;
    return parsed;
  } catch {
    return undefined;
  } finally {
    await AsyncStorage.removeItem(APPLE_USER_KEY);
  }
}
