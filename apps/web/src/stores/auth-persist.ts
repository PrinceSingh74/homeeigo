import type { AuthUser } from "@/types/auth";

/**
 * Persisted shape of the `homigo-auth` store.
 *
 * Version 2 is the profile-only snapshot: the access token is memory-only and the refresh token is
 * an HttpOnly cookie, so nothing else may be read back from localStorage. Earlier versions persisted
 * `accessToken` / `refreshToken` / `status`; migrating keeps the profile (so the signed-in shell still
 * renders before the first refresh returns) and drops everything else. Without this, zustand logged
 * "couldn't be migrated since no migrate function was provided" for every existing user and threw
 * the whole snapshot away.
 */
export const AUTH_PERSIST_VERSION = 2;

export type PersistedAuth = { user: AuthUser | null };

export function migrateAuthSnapshot(persisted: unknown, _fromVersion: number): PersistedAuth {
  const user = persisted && typeof persisted === "object" ? (persisted as { user?: unknown }).user : null;
  return { user: user && typeof user === "object" ? (user as AuthUser) : null };
}
