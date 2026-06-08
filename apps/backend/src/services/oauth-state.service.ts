import crypto from "crypto";

type OAuthProvider = "google" | "apple";

type OAuthStateRecord = {
  provider: OAuthProvider;
  state: string;
  expiresAt: number;
};

const STATE_TTL_MS = 10 * 60 * 1000;
const oauthStateStore = new Map<string, OAuthStateRecord>();

function cleanupExpiredStates() {
  const now = Date.now();
  for (const [key, record] of oauthStateStore.entries()) {
    if (record.expiresAt <= now) oauthStateStore.delete(key);
  }
}

function mapKey(provider: OAuthProvider, state: string) {
  return `${provider}:${state}`;
}

export class OAuthStateService {
  issue(provider: OAuthProvider, requestedState?: string): string {
    cleanupExpiredStates();
    const state = requestedState?.trim() || crypto.randomUUID();
    oauthStateStore.set(mapKey(provider, state), {
      provider,
      state,
      expiresAt: Date.now() + STATE_TTL_MS,
    });
    return state;
  }

  consume(provider: OAuthProvider, state?: string | null): boolean {
    cleanupExpiredStates();
    if (!state) return false;
    const key = mapKey(provider, state);
    const record = oauthStateStore.get(key);
    if (!record) return false;
    oauthStateStore.delete(key);
    return record.expiresAt > Date.now();
  }
}

export const oauthStateService = new OAuthStateService();
