import { isAuthRoute } from "@/lib/auth/routes";

const PENDING_KEY = "homigo_apple_oauth_pending";
const PROCESSED_PREFIX = "homigo_apple_oauth_done_";
const PENDING_TTL_MS = 10 * 60 * 1000;

export type AppleOAuthPending = {
  state: string;
  returnUrl: string;
  startedAt: number;
};

function generateOAuthState(): string {
  const cryptoObj = typeof globalThis !== "undefined" ? globalThis.crypto : undefined;
  if (cryptoObj?.randomUUID) return cryptoObj.randomUUID();

  if (cryptoObj?.getRandomValues) {
    const bytes = new Uint8Array(16);
    cryptoObj.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  return `oauth-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export function sanitizeOAuthReturnUrl(url: string | null | undefined): string {
  if (!url || typeof url !== "string") return "/";
  const path = url.split("?")[0] ?? url;
  if (!path.startsWith("/") || path.startsWith("//")) return "/";
  if (path.startsWith("/auth/") || isAuthRoute(path)) return "/";
  return url.startsWith("/") ? url : "/";
}

export function beginAppleOAuth(returnUrl?: string | null): string {
  const state = generateOAuthState();
  const pending: AppleOAuthPending = {
    state,
    returnUrl: sanitizeOAuthReturnUrl(returnUrl),
    startedAt: Date.now(),
  };
  if (typeof sessionStorage !== "undefined") {
    sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending));
  }
  return state;
}

export function consumeAppleOAuthPending(
  urlState: string | null,
): { valid: true; returnUrl: string } | { valid: false; returnUrl: string; error: string } {
  const fallback = sanitizeOAuthReturnUrl("/");

  if (typeof sessionStorage === "undefined") {
    return {
      valid: false,
      returnUrl: fallback,
      error: "OAuth session could not be verified. Please try again.",
    };
  }

  const raw = sessionStorage.getItem(PENDING_KEY);
  sessionStorage.removeItem(PENDING_KEY);

  if (!raw) {
    return {
      valid: false,
      returnUrl: fallback,
      error: "OAuth session expired. Please sign in with Apple again.",
    };
  }

  let pending: AppleOAuthPending;
  try {
    pending = JSON.parse(raw) as AppleOAuthPending;
  } catch {
    return {
      valid: false,
      returnUrl: fallback,
      error: "OAuth session was invalid. Please try again.",
    };
  }

  if (Date.now() - pending.startedAt > PENDING_TTL_MS) {
    return {
      valid: false,
      returnUrl: fallback,
      error: "OAuth session expired. Please sign in with Apple again.",
    };
  }

  if (!urlState || urlState !== pending.state) {
    return {
      valid: false,
      returnUrl: fallback,
      error: "OAuth security check failed. Please try again.",
    };
  }

  return { valid: true, returnUrl: pending.returnUrl };
}

type OAuthCodeClaim = "proceed" | "duplicate" | "in_flight";

export function claimAppleAuthorizationCode(code: string): OAuthCodeClaim {
  if (typeof sessionStorage === "undefined") return "proceed";
  const key = `${PROCESSED_PREFIX}${code}`;
  const existing = sessionStorage.getItem(key);
  if (existing === "done") return "duplicate";
  if (existing === "processing") return "in_flight";
  sessionStorage.setItem(key, "processing");
  return "proceed";
}

export function finishAppleAuthorizationCode(code: string, success: boolean): void {
  if (typeof sessionStorage === "undefined") return;
  const key = `${PROCESSED_PREFIX}${code}`;
  if (success) sessionStorage.setItem(key, "done");
  else sessionStorage.removeItem(key);
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

export type AppleOAuthUserParam = {
  email?: string;
  name?: { firstName?: string; lastName?: string };
};

/** Apple posts user info only once on first sign-in; persist on the client to support
 *  page reloads during the callback. */
const APPLE_USER_KEY = "homigo_apple_oauth_user";

export function saveAppleOAuthUserParam(raw: string | null | undefined): void {
  if (!raw || typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(APPLE_USER_KEY, raw);
  } catch {
    /* ignore quota errors */
  }
}

export function readAppleOAuthUserParam(): AppleOAuthUserParam | undefined {
  if (typeof sessionStorage === "undefined") return undefined;
  const raw = sessionStorage.getItem(APPLE_USER_KEY);
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as AppleOAuthUserParam;
    return parsed;
  } catch {
    return undefined;
  } finally {
    sessionStorage.removeItem(APPLE_USER_KEY);
  }
}
