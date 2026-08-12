import { isAuthRoute } from "@/lib/auth/routes";

const PENDING_KEY = "homigo_google_oauth_pending";
const PROCESSED_PREFIX = "homigo_google_oauth_done_";
const PENDING_TTL_MS = 10 * 60 * 1000;

export type GoogleOAuthPending = {
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
    // RFC4122 v4 shape: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  return `oauth-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/** Safe in-app redirect target (no open redirects, no auth loops). */
export function sanitizeOAuthReturnUrl(url: string | null | undefined): string {
  if (!url || typeof url !== "string") return "/";
  const path = url.split("?")[0] ?? url;
  if (!path.startsWith("/") || path.startsWith("//")) return "/";
  if (path.startsWith("/auth/") || isAuthRoute(path)) return "/";
  return url.startsWith("/") ? url : "/";
}

export function beginGoogleOAuth(returnUrl?: string | null): string {
  const state = generateOAuthState();
  const pending: GoogleOAuthPending = {
    state,
    returnUrl: sanitizeOAuthReturnUrl(returnUrl),
    startedAt: Date.now(),
  };
  if (typeof sessionStorage !== "undefined") {
    sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending));
  }
  return state;
}

type ConsumeResult =
  | { valid: true; returnUrl: string }
  /**
   * `localMismatch` distinguishes a genuine CSRF failure (the URL state does not
   * match the token we issued) from a merely-missing local token. The latter is
   * recoverable: the backend independently validates the state via oauthStateService,
   * so the caller can proceed and defer to it rather than hard-blocking a legit login.
   */
  | { valid: false; returnUrl: string; error: string; localMismatch: boolean };

export function consumeGoogleOAuthPending(urlState: string | null): ConsumeResult {
  const fallback = sanitizeOAuthReturnUrl("/");

  if (typeof sessionStorage === "undefined") {
    return {
      valid: false,
      returnUrl: fallback,
      error: "OAuth session could not be verified. Please try again.",
      localMismatch: false,
    };
  }

  const raw = sessionStorage.getItem(PENDING_KEY);
  sessionStorage.removeItem(PENDING_KEY);

  if (!raw) {
    return {
      valid: false,
      returnUrl: fallback,
      error: "OAuth session expired. Please sign in with Google again.",
      localMismatch: false,
    };
  }

  let pending: GoogleOAuthPending;
  try {
    pending = JSON.parse(raw) as GoogleOAuthPending;
  } catch {
    return {
      valid: false,
      returnUrl: fallback,
      error: "OAuth session was invalid. Please try again.",
      localMismatch: false,
    };
  }

  if (Date.now() - pending.startedAt > PENDING_TTL_MS) {
    return {
      valid: false,
      returnUrl: fallback,
      error: "OAuth session expired. Please sign in with Google again.",
      localMismatch: false,
    };
  }

  if (!urlState || urlState !== pending.state) {
    return {
      valid: false,
      returnUrl: fallback,
      error: "OAuth security check failed. Please try again.",
      localMismatch: true,
    };
  }

  return { valid: true, returnUrl: pending.returnUrl };
}

type OAuthCodeClaim = "proceed" | "duplicate" | "in_flight";

/** Prevents double exchange (React Strict Mode, refresh, back button). */
export function claimOAuthAuthorizationCode(code: string): OAuthCodeClaim {
  if (typeof sessionStorage === "undefined") return "proceed";
  const key = `${PROCESSED_PREFIX}${code}`;
  const existing = sessionStorage.getItem(key);
  if (existing === "done") return "duplicate";
  if (existing === "processing") return "in_flight";
  sessionStorage.setItem(key, "processing");
  return "proceed";
}

export function finishOAuthAuthorizationCode(code: string, success: boolean): void {
  if (typeof sessionStorage === "undefined") return;
  const key = `${PROCESSED_PREFIX}${code}`;
  if (success) sessionStorage.setItem(key, "done");
  else sessionStorage.removeItem(key);
}

export function getGoogleOAuthUserMessage(errorCode: string | null): string {
  if (errorCode === "access_denied") {
    return "Google sign-in was cancelled. You can try again when ready.";
  }
  if (errorCode === "invalid_grant") {
    return "This sign-in link has expired or was already used. Please try again.";
  }
  return "Google sign-in could not be completed. Please try again.";
}
