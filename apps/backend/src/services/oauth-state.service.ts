import crypto from "crypto";
import { redisClient } from "../lib/redis";

type OAuthProvider = "google" | "apple";

const STATE_TTL_SEC = 10 * 60;

/**
 * What a state may look like. The clients send a UUID (or `oauth-<time>-<random>` where no crypto is
 * available); anything else is refused. Without a bound, `POST /auth/google/authorize` — which needs no
 * login — stored whatever string the caller sent for ten minutes, up to the request body limit.
 */
export const OAUTH_STATE_PATTERN = "^[A-Za-z0-9._~-]{8,128}$";
const STATE_RE = new RegExp(OAUTH_STATE_PATTERN);

/**
 * Process-local store, used only when Redis cannot be asked (local development, tests, an outage).
 * It is capped: when full, the oldest pending sign-in is dropped, which costs that one user a retry.
 */
const MAX_LOCAL_STATES = 10_000;
const SWEEP_INTERVAL_MS = 30_000;
const localStates = new Map<string, number>(); // key → expiresAt
let lastSweepAt = 0;

function sweepExpired(now: number): void {
  if (now - lastSweepAt < SWEEP_INTERVAL_MS) return;
  lastSweepAt = now;
  for (const [key, expiresAt] of localStates) {
    if (expiresAt <= now) localStates.delete(key);
  }
}

function storeKey(provider: OAuthProvider, state: string): string {
  return `oauth:state:${provider}:${state}`;
}

export class OAuthStateError extends Error {
  readonly code = "INVALID_OAUTH_STATE" as const;
  constructor() {
    super("Invalid OAuth state");
  }
}

/**
 * Pending OAuth sign-ins: issued at authorize, consumed exactly once at callback.
 *
 * Kept in Redis when it is available, so the callback may land on a different instance than the one
 * that issued the state — with the process-local map alone, every sign-in whose two requests reached
 * different instances failed with INVALID_CODE. The state proves the callback belongs to a sign-in
 * this API started; binding it to the browser that started it is the client's half (the web and app
 * callbacks refuse a state their own tab did not create).
 */
export class OAuthStateService {
  async issue(provider: OAuthProvider, requestedState?: string): Promise<string> {
    const state = requestedState?.trim() || crypto.randomUUID();
    if (!STATE_RE.test(state)) throw new OAuthStateError();
    const key = storeKey(provider, state);
    if (await redisClient.set(key, "1", STATE_TTL_SEC)) return state;

    const now = Date.now();
    sweepExpired(now);
    localStates.delete(key); // re-insert so a re-issued state counts as newest
    while (localStates.size >= MAX_LOCAL_STATES) {
      const oldest = localStates.keys().next().value;
      if (oldest === undefined) break;
      localStates.delete(oldest);
    }
    localStates.set(key, now + STATE_TTL_SEC * 1000);
    return state;
  }

  async consume(provider: OAuthProvider, state?: string | null): Promise<boolean> {
    if (!state || !STATE_RE.test(state)) return false;
    const key = storeKey(provider, state);
    const taken = await redisClient.take(key);
    if (taken.answered && taken.value !== null) return true;

    // Not in Redis (or Redis could not be asked): it may have been issued while Redis was down.
    const expiresAt = localStates.get(key);
    if (expiresAt === undefined) return false;
    localStates.delete(key);
    return expiresAt > Date.now();
  }
}

export const oauthStateService = new OAuthStateService();

/** Test hooks: the local store's size, and a way to empty it between cases. */
export function localOAuthStateCountForTests(): number {
  return localStates.size;
}
export function resetLocalOAuthStatesForTests(): void {
  localStates.clear();
  lastSweepAt = 0;
}
export const MAX_LOCAL_OAUTH_STATES = MAX_LOCAL_STATES;
