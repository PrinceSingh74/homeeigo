/**
 * Release certification Ph9. The three web apps still persist the refresh token in localStorage
 * (access tokens are memory-only), so a stolen refresh token is the residual XSS risk. The
 * mitigation that bounds it is rotation + reuse detection: once a rotated-out token is presented
 * again, the WHOLE family is revoked — including the token the legitimate client (or the thief)
 * rotated to. This pins that behaviour over real HTTP.
 */
import "../load-env";
import { provenanceForNewUser } from "../lib/data-provenance";
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import app from "../index";
import prisma from "../lib/prisma";
import { JWTService } from "../services/jwt.service";
import { RefreshTokenService } from "../services/refresh-token.service";

const service = new RefreshTokenService(prisma, new JWTService());

async function refresh(refreshToken: string) {
  const res = await app.handle(
    new Request("http://localhost/api/auth/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken, setAuthCookies: false }),
    }),
  );
  const json = (await res.json()) as { data?: { refreshToken?: string } };
  return { status: res.status, next: json.data?.refreshToken };
}

let userId: string;
let email: string;

beforeAll(async () => {
  const run = `rtr${Date.now().toString(36)}`;
  const u = await prisma.user.create({
    data: {
      ...provenanceForNewUser(`${run}@reuse.test`),
      email: `${run}@reuse.test`,
      phoneNumber: `+9174${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`,
      firstName: "Reuse",
      lastName: "Probe",
      password: "x".repeat(20),
      role: "CUSTOMER",
      isEmailVerified: true,
    },
  });
  userId = u.id;
  email = u.email!;
});

afterAll(async () => {
  // No money history, so the financial-history guard allows the delete; tokens/notifications first.
  await prisma.refreshToken.deleteMany({ where: { userId } });
  await prisma.notification.deleteMany({ where: { userId } });
  await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
});

describe("refresh token rotation and reuse detection", () => {
  it("rotates on use, and replaying the old token revokes the whole family", async () => {
    const { refreshToken: t0 } = await service.createSessionTokens({ userId, email });

    const first = await refresh(t0);
    expect(first.status).toBe(200);
    const t1 = first.next!;
    expect(t1).toBeTruthy();
    expect(t1).not.toBe(t0);

    // Attacker presents the rotated-out token AFTER the rotation grace window (an immediate replay
    // is a concurrent-refresh race and is answered with the live successor — covered separately).
    await prisma.refreshToken.updateMany({ where: { token: t0 }, data: { revokedAt: new Date(Date.now() - 10 * 60_000) } });
    const replay = await refresh(t0);
    expect(replay.status).toBe(401);

    // The token the other party rotated to is now dead too — the family is burned.
    const afterReuse = await refresh(t1);
    expect(afterReuse.status).toBe(401);

    const family = await prisma.refreshToken.findMany({ where: { userId }, select: { revokedAt: true, revokedReason: true } });
    expect(family.length).toBeGreaterThanOrEqual(2);
    expect(family.every((t) => t.revokedAt !== null)).toBe(true);
    expect(family.some((t) => t.revokedReason === "REUSE_ATTACK_DETECTED")).toBe(true);
  });

  /**
   * Concurrent refreshes share ONE cookie in a browser, so the loser presents a token that was
   * rotated milliseconds earlier. That is a race, not theft: it must not burn the family.
   */
  it("two simultaneous refreshes both succeed and the session survives", async () => {
    // Delta, not absolute: earlier cases in this file deliberately burn tokens for the same user.
    const burnedBefore = await prisma.refreshToken.count({ where: { userId, revokedReason: "REUSE_ATTACK_DETECTED" } });
    const { refreshToken } = await service.createSessionTokens({ userId, email });
    const [a, b] = await Promise.all([refresh(refreshToken), refresh(refreshToken)]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);

    // The family is intact: the surviving token still refreshes.
    const survivor = a.next ?? b.next!;
    expect((await refresh(survivor)).status).toBe(200);

    const burnedAfter = await prisma.refreshToken.count({ where: { userId, revokedReason: "REUSE_ATTACK_DETECTED" } });
    expect(burnedAfter).toBe(burnedBefore); // the race burned nothing
  });

  it("a token rotated long ago is still treated as reuse", async () => {
    const { refreshToken } = await service.createSessionTokens({ userId, email });
    const rotated = (await refresh(refreshToken)).next!;
    expect(rotated).toBeTruthy();
    // Age the rotation beyond the grace window.
    await prisma.refreshToken.updateMany({
      where: { token: refreshToken },
      data: { revokedAt: new Date(Date.now() - 10 * 60_000) },
    });
    expect((await refresh(refreshToken)).status).toBe(401);
    expect(
      await prisma.refreshToken.count({ where: { userId, revokedReason: "REUSE_ATTACK_DETECTED" } }),
    ).toBeGreaterThan(0);
  });

  it("reuse signs out EVERY session (auth epoch bump), including live access tokens", async () => {
    // Policy (refresh-token-family.service handleReuseAttack): reuse is treated as a compromise —
    // the family is revoked AND the user's auth epoch is bumped, so a parallel session on another
    // device and every outstanding access token die with it. The user is notified.
    const a = await service.createSessionTokens({ userId, email });
    const b = await service.createSessionTokens({ userId, email });
    const call = (token: string) =>
      app.handle(new Request("http://localhost/api/users/addresses", { headers: { Authorization: `Bearer ${token}` } }));
    expect((await call(b.accessToken)).status).toBe(200);

    const aNext = (await refresh(a.refreshToken)).next!;
    await prisma.refreshToken.updateMany({ where: { token: a.refreshToken }, data: { revokedAt: new Date(Date.now() - 10 * 60_000) } });
    expect((await refresh(a.refreshToken)).status).toBe(401); // reuse in family A
    expect((await refresh(aNext)).status).toBe(401);
    expect((await refresh(b.refreshToken)).status).toBe(401); // other device signed out too
    expect([401, 403]).toContain((await call(b.accessToken)).status); // outstanding access token dead

    // A fresh login after the incident works normally.
    const c = await service.createSessionTokens({ userId, email });
    expect((await refresh(c.refreshToken)).status).toBe(200);
  });
});
