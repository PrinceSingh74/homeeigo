/**
 * First-party session marker cookie.
 *
 * The real tokens live in the auth store (and are validated by the backend on
 * every API call). This lightweight, non-sensitive marker simply tells the
 * Next.js middleware "this browser has a session" so protected routes can be
 * redirected on the server — before any protected content is streamed —
 * eliminating the client-side auth flash.
 */
export const SESSION_COOKIE = "homigo_session";

/** Mirrors the backend refresh-token lifetime (30 days). */
const MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

export function setSessionCookie(): void {
  if (typeof document === "undefined") return;
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${SESSION_COOKIE}=1; Path=/; Max-Age=${MAX_AGE_SECONDS}; SameSite=Lax${secure}`;
}

export function clearSessionCookie(): void {
  if (typeof document === "undefined") return;
  document.cookie = `${SESSION_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
}
