import { describe, expect, test } from "bun:test";
import { AUTH_PERSIST_VERSION, migrateAuthSnapshot } from "../src/stores/auth-persist";

/**
 * `homigo-auth` moved to version 2 when tokens left localStorage (access token memory-only, refresh
 * token an HttpOnly cookie). Without a migrate function, zustand's persist logs "State loaded from
 * storage couldn't be migrated since no migrate function was provided" for every browser still
 * holding a version-0 snapshot — every existing user — and throws the snapshot away wholesale.
 */
describe("homigo-auth persisted snapshot migration", () => {
  const user = { id: "u1", email: "a@b.test", firstName: "A", role: "CUSTOMER" };

  test("current version is 2", () => {
    expect(AUTH_PERSIST_VERSION).toBe(2);
  });

  test("a version-0 snapshot keeps only the profile — tokens and status never survive", () => {
    const v0 = { user, accessToken: "at-secret", refreshToken: "rt-secret", status: "authenticated", error: null };
    const migrated = migrateAuthSnapshot(v0, 0);
    expect(migrated).toEqual({ user });
    expect(JSON.stringify(migrated)).not.toContain("secret");
  });

  test("version 1 is treated the same way", () => {
    expect(migrateAuthSnapshot({ user, accessToken: "x" }, 1)).toEqual({ user });
  });

  test("garbage or empty snapshots migrate to a signed-out profile instead of throwing", () => {
    expect(migrateAuthSnapshot(undefined, 0)).toEqual({ user: null });
    expect(migrateAuthSnapshot(null, 0)).toEqual({ user: null });
    expect(migrateAuthSnapshot("nonsense", 0)).toEqual({ user: null });
    expect(migrateAuthSnapshot({ user: "not-an-object" }, 0)).toEqual({ user: null });
  });
});
