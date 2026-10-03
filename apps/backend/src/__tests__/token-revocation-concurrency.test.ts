import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { dbReachable, prisma } from "./helpers/adversarial-fixtures";
import { tokenRevocationService } from "../services/token-revocation.service";

/**
 * SECTION 7B — `isAccessTokenValid` now issues its two lookups concurrently. The VERDICT must not
 * have moved.
 *
 * ── Why this file exists ────────────────────────────────────────────────────
 *
 * The change is a performance change on an authorization path, which is the most dangerous kind.
 * The old code short-circuited: if the jti was revoked it never read the epoch. The new code issues
 * both reads together and then decides. Identical logic, one fewer round trip — but "identical" is a
 * claim, and an authorization claim has to be tested rather than reasoned about.
 *
 * All four combinations are pinned, including the two that must REFUSE. A test that only proves a
 * valid token is accepted would pass just as well against a function that returns `true`
 * unconditionally, which is exactly the failure mode that matters here.
 */
const RUN = `tokrev-${Date.now().toString(36)}`;
let dbOk = false;
let userId = "";

/** A payload shaped like the real JWT claims the plugin passes in. */
function payload(over: Partial<{ jti: string; authEpoch: number }> = {}) {
  return {
    userId,
    email: `${RUN}@homigo.test`,
    role: "CUSTOMER",
    jti: over.jti,
    authEpoch: over.authEpoch,
  } as unknown as Parameters<typeof tokenRevocationService.isAccessTokenValid>[0];
}

beforeAll(async () => {
  dbOk = await dbReachable();
  if (!dbOk) return;
  const user = await prisma.user.findFirst({ where: { role: "CUSTOMER" }, select: { id: true } });
  if (!user) {
    dbOk = false;
    return;
  }
  userId = user.id;
  // Known starting point: no blacklist rows of ours, and a known epoch for this user.
  await prisma.tokenBlacklist.deleteMany({ where: { tokenJti: { startsWith: RUN } } });
}, 60_000);

afterAll(async () => {
  if (!dbOk) return;
  await prisma.tokenBlacklist.deleteMany({ where: { tokenJti: { startsWith: RUN } } });
}, 60_000);

async function currentEpoch(): Promise<number> {
  const row = await prisma.userAuthEpoch.findUnique({ where: { userId }, select: { epoch: true } });
  return row?.epoch ?? 0;
}

describe("the verdict is unchanged by running the two lookups together", () => {
  test("a clean token with a current epoch is accepted", async () => {
    if (!dbOk) return;
    const epoch = await currentEpoch();
    expect(await tokenRevocationService.isAccessTokenValid(payload({ jti: `${RUN}-ok`, authEpoch: epoch })))
      .toBe(true);
  }, 60_000);

  test("a REVOKED jti is refused", async () => {
    if (!dbOk) return;
    const jti = `${RUN}-revoked`;
    await prisma.tokenBlacklist.create({
      data: {
        tokenJti: jti,
        userId,
        revokedBy: "7b-test",
        reason: "MANUAL_REVOCATION",
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    });
    const epoch = await currentEpoch();

    // The case the removed short-circuit used to cover. It must still refuse.
    expect(await tokenRevocationService.isAccessTokenValid(payload({ jti, authEpoch: epoch }))).toBe(false);
  }, 60_000);

  test("a STALE epoch is refused", async () => {
    if (!dbOk) return;
    const epoch = await currentEpoch();
    expect(
      await tokenRevocationService.isAccessTokenValid(payload({ jti: `${RUN}-stale`, authEpoch: epoch - 1 })),
    ).toBe(false);
  }, 60_000);

  test("revoked AND stale is refused — neither check masks the other", async () => {
    if (!dbOk) return;
    const jti = `${RUN}-both`;
    await prisma.tokenBlacklist.create({
      data: {
        tokenJti: jti,
        userId,
        revokedBy: "7b-test",
        reason: "MANUAL_REVOCATION",
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    });
    const epoch = await currentEpoch();
    expect(await tokenRevocationService.isAccessTokenValid(payload({ jti, authEpoch: epoch - 1 }))).toBe(false);
  }, 60_000);

  test("a token with no jti and no epoch claim is still evaluated, not waved through by accident", async () => {
    if (!dbOk) return;
    /**
     * Both optional claims absent is the shape the concurrent version had to handle explicitly:
     * `Promise.all` needs a resolved value for each branch. Legacy tokens without these claims are
     * accepted — as they were before — and this pins that it is a decision rather than an
     * `undefined` slipping through a comparison.
     */
    expect(await tokenRevocationService.isAccessTokenValid(payload({}))).toBe(true);
  }, 60_000);

  test("a newer epoch than the server's is accepted, not rejected", async () => {
    if (!dbOk) return;
    // Only a token OLDER than the current epoch is stale; `<` not `!==`, unchanged by this edit.
    const epoch = await currentEpoch();
    expect(
      await tokenRevocationService.isAccessTokenValid(payload({ jti: `${RUN}-new`, authEpoch: epoch + 1 })),
    ).toBe(true);
  }, 60_000);
});

describe("revocation still takes effect immediately", () => {
  test("the same jti flips from valid to refused with no restart and no cache to wait on", async () => {
    if (!dbOk) return;
    const jti = `${RUN}-live`;
    const epoch = await currentEpoch();

    expect(await tokenRevocationService.isAccessTokenValid(payload({ jti, authEpoch: epoch }))).toBe(true);

    await prisma.tokenBlacklist.create({
      data: {
        tokenJti: jti,
        userId,
        revokedBy: "7b-test",
        reason: "MANUAL_REVOCATION",
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    });

    /**
     * The property that would have been destroyed by "optimising" this path with a cache. Both facts
     * are still read from the database on every call, so a revocation is effective on the very next
     * request.
     */
    expect(await tokenRevocationService.isAccessTokenValid(payload({ jti, authEpoch: epoch }))).toBe(false);
  }, 60_000);
});
