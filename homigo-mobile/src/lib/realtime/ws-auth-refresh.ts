/**
 * Should a realtime socket that the server closed with 4401 (token expired / revoked) trigger a token
 * refresh?
 *
 * Found on the Android emulator with 60-second access tokens: the API client refreshed on a REST 401,
 * the visible channels reconnected on the new token, but a channel on a frozen (unfocused) screen kept
 * its socket on the OLD token. The server's expiry sweep closed that socket with 4401 a few seconds
 * later and the channel refreshed AGAIN — two refreshes for one expiry, each rotating the session.
 *
 * A socket refused with an older token than the store now holds proves nothing about the current
 * session: it was already refreshed. The channel reconnects on the new token when its URL is rebuilt.
 */
export function shouldRefreshAfterWsUnauthorized(input: {
  socketUrl: string | null;
  currentAccessToken: string | null;
  now: number;
  lastWsAuthRefreshAt: number;
  windowMs: number;
}): boolean {
  const refused = tokenFromWsUrl(input.socketUrl);
  if (refused && input.currentAccessToken && refused !== input.currentAccessToken) return false;
  // Refresh once per window: if a just-refreshed token is refused too, another refresh cannot help,
  // and each one rotates the session — an unbounded retry is a refresh storm.
  return input.now - input.lastWsAuthRefreshAt >= input.windowMs;
}

/** The access token a realtime URL authenticates with (`?token=`), or null when it carries none. */
export function tokenFromWsUrl(url: string | null): string | null {
  if (!url) return null;
  const match = /[?&]token=([^&#]*)/.exec(url);
  if (!match || !match[1]) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}
