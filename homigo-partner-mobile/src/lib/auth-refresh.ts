/**
 * Access-token refresh, as pure logic (no React Native / Expo imports — unit-tested under Node).
 *
 * Mirrors apps/partner-web/src/lib/refresh-coordinator.ts + api-client.ts, with one deliberate
 * difference: a refresh that could not REACH the server is not treated as a revoked session.
 * A phone in a lift or on 2G must not be signed out because a request timed out — only an explicit
 * server refusal of the refresh token ends the session.
 *
 * Contract
 *  - Concurrent 401s share ONE in-flight `POST /api/auth/refresh` (the backend rotates refresh
 *    tokens; two parallel refreshes with the same token would race, and the loser would present
 *    an already-rotated token).
 *  - The original request is retried AT MOST ONCE, and only after a successful refresh.
 *  - The refresh call itself never goes through this path (it is issued by `doRefresh`, not by the
 *    wrapped `send`), so a 401 on refresh cannot recurse.
 *  - `rejected` → `onSessionRejected` runs (clear credentials, close sockets, go to login).
 *  - `unavailable` → nothing is cleared; the caller sees the original 401 response.
 */

export type RefreshOutcome =
  | { kind: "refreshed"; accessToken: string }
  /** Server refused the refresh token (invalid / expired / revoked / device mismatch) or none held. */
  | { kind: "rejected" }
  /** Network failure, 5xx or 429 — the session may still be valid; do not sign out. */
  | { kind: "unavailable" };

export type RefreshCoordinator = {
  /** Start a refresh, or join the one already in flight. */
  refresh: () => Promise<RefreshOutcome>;
  /** True while a refresh is in flight (diagnostics / tests). */
  inFlight: () => boolean;
  /** Test-only. */
  reset: () => void;
};

export function createRefreshCoordinator(doRefresh: () => Promise<RefreshOutcome>): RefreshCoordinator {
  let pending: Promise<RefreshOutcome> | null = null;
  return {
    refresh() {
      if (pending) return pending;
      const run = (async (): Promise<RefreshOutcome> => {
        try {
          return await doRefresh();
        } catch {
          // A thrown refresh (network, JSON) is "could not ask", never "was told no".
          return { kind: "unavailable" };
        }
      })();
      pending = run;
      void run.finally(() => {
        if (pending === run) pending = null;
      });
      return run;
    },
    inFlight: () => pending != null,
    reset: () => {
      pending = null;
    },
  };
}

/**
 * Classify the HTTP result of `POST /api/auth/refresh`.
 * The backend answers 401 `{ success:false, code:"INVALID_TOKEN" }` on any refusal and
 * 200 `{ success:true, data:{ accessToken, refreshToken, sessionId, expiresIn } }` on success.
 * 400 (malformed body) and 403 are refusals too: retrying the same token cannot succeed.
 */
export function classifyRefreshResponse(
  status: number,
  body: unknown,
): { kind: "ok"; accessToken: string; refreshToken: string; sessionId: string | null } | { kind: "rejected" } | { kind: "unavailable" } {
  if (status === 0 || status === 429 || status >= 500) return { kind: "unavailable" };
  const b = (body ?? {}) as { success?: unknown; data?: { accessToken?: unknown; refreshToken?: unknown; sessionId?: unknown } };
  if (status >= 200 && status < 300 && b.success === true) {
    const at = b.data?.accessToken;
    const rt = b.data?.refreshToken;
    if (typeof at === "string" && at && typeof rt === "string" && rt) {
      return {
        kind: "ok",
        accessToken: at,
        refreshToken: rt,
        sessionId: typeof b.data?.sessionId === "string" ? b.data.sessionId : null,
      };
    }
    // 200 without tokens is a broken server, not a revoked session.
    return { kind: "unavailable" };
  }
  if (status === 400 || status === 401 || status === 403) return { kind: "rejected" };
  return { kind: "unavailable" };
}

export type AuthRetryOptions<R> = {
  /** Performs the request with the given bearer token (null = anonymous). */
  send: (accessToken: string | null) => Promise<R>;
  isUnauthorized: (result: R) => boolean;
  getAccessToken: () => string | null;
  refresh: () => Promise<RefreshOutcome>;
  onSessionRejected: () => void | Promise<void>;
  /** false for auth endpoints (login / refresh / logout) — they must never trigger a refresh. */
  allowRefresh: boolean;
};

/**
 * Send once; on a 401 made WITH a token, refresh (single-flight) and retry exactly once.
 *
 * If another request already rotated the token while this one was in the air, the retry uses the
 * newer token without asking the server again.
 */
export async function sendWithAuthRetry<R>(opts: AuthRetryOptions<R>): Promise<R> {
  const tokenUsed = opts.getAccessToken();
  const first = await opts.send(tokenUsed);
  if (!opts.allowRefresh || !tokenUsed || !opts.isUnauthorized(first)) return first;

  const current = opts.getAccessToken();
  if (current && current !== tokenUsed) {
    // Someone else refreshed already — one retry with the fresh token, no second refresh.
    return opts.send(current);
  }

  const outcome = await opts.refresh();
  if (outcome.kind === "refreshed") return opts.send(outcome.accessToken);
  if (outcome.kind === "rejected") await opts.onSessionRejected();
  return first;
}
