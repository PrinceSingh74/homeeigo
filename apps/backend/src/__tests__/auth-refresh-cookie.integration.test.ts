/**
 * Web refresh tokens live in an HttpOnly, audience-scoped cookie (release certification Phase 3).
 *
 * The properties that matter, over real HTTP:
 *   - the cookie is HttpOnly, SameSite=Strict and scoped to /api/auth, so JavaScript cannot read it
 *     and no cross-site request carries it;
 *   - in cookie mode the rotated token is NOT echoed in the response body;
 *   - the three audiences do not clobber each other in one browser (they share the API host);
 *   - logout clears only the audience that logged out;
 *   - mobile (no audience header) keeps working with body tokens and gets no cookie;
 *   - rotation and reuse detection still apply to a cookie-carried token.
 */
import "../load-env";
import { provenanceForNewUser } from "../lib/data-provenance";
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import app from "../index";
import prisma from "../lib/prisma";
import { RefreshTokenService } from "../services/refresh-token.service";
import { JWTService } from "../services/jwt.service";
import { REFRESH_COOKIE, type AuthAudience } from "../lib/auth-cookies";

const service = new RefreshTokenService(prisma, new JWTService());
const RUN = `arc${Date.now().toString(36)}`;
const userIds: string[] = [];

async function makeUser(tag: string) {
  const u = await prisma.user.create({
    data: {
      ...provenanceForNewUser(`${RUN}-${tag}@cookie.test`),
      email: `${RUN}-${tag}@cookie.test`,
      phoneNumber: `+9173${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`,
      firstName: "Cookie",
      lastName: tag,
      password: "x".repeat(20),
      role: "CUSTOMER",
      isEmailVerified: true,
    },
  });
  userIds.push(u.id);
  return u;
}

async function refresh(opts: { audience?: AuthAudience; cookie?: string; body?: Record<string, unknown> }) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.audience) headers["X-Homigo-Audience"] = opts.audience;
  if (opts.cookie) headers["Cookie"] = opts.cookie;
  const res = await app.handle(
    new Request("http://localhost/api/auth/refresh", { method: "POST", headers, body: JSON.stringify(opts.body ?? {}) }),
  );
  const setCookie = res.headers.getSetCookie?.() ?? [];
  return { status: res.status, json: (await res.json()) as { success: boolean; data?: { accessToken?: string; refreshToken?: string } }, setCookie };
}

const cookieFor = (a: AuthAudience, token: string) => `${REFRESH_COOKIE[a]}=${encodeURIComponent(token)}`;

beforeAll(async () => {
  // fail fast if the suite is pointed anywhere but an isolated database
  const [{ db }] = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
  expect(db).toMatch(/_test$/);
});

afterAll(async () => {
  await prisma.refreshToken.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
});

describe("refresh over an HttpOnly cookie", () => {
  it("accepts the cookie, rotates it, and never returns the token to JavaScript", async () => {
    const u = await makeUser("a");
    const { refreshToken } = await service.createSessionTokens({ userId: u.id, email: u.email! });

    const r = await refresh({ audience: "customer", cookie: cookieFor("customer", refreshToken) });
    expect(r.status).toBe(200);
    expect(r.json.data?.accessToken).toBeTruthy();
    expect(r.json.data?.refreshToken).toBeUndefined(); // not exposed to JS

    const set = r.setCookie.find((c) => c.startsWith(REFRESH_COOKIE.customer));
    expect(set).toBeTruthy();
    expect(set).toContain("HttpOnly");
    expect(set).toContain("SameSite=Strict");
    expect(set).toContain("Path=/api/auth");
    // the cookie carries a DIFFERENT token than the one presented (rotation)
    const rotated = decodeURIComponent(set!.split(";")[0]!.split("=").slice(1).join("="));
    expect(rotated).not.toBe(refreshToken);

    // the rotated cookie works, and the old one is now a reuse attempt
    expect((await refresh({ audience: "customer", cookie: cookieFor("customer", rotated) })).status).toBe(200);
    expect((await refresh({ audience: "customer", cookie: cookieFor("customer", refreshToken) })).status).toBe(401);
  });

  it("a refused cookie is cleared so the browser stops replaying it", async () => {
    const r = await refresh({ audience: "customer", cookie: cookieFor("customer", "not-a-token") });
    expect(r.status).toBe(401);
    const cleared = r.setCookie.find((c) => c.startsWith(REFRESH_COOKIE.customer));
    expect(cleared).toContain("Max-Age=0");
  });

  it("three audiences coexist in one browser and refresh independently", async () => {
    const [c, p, a] = await Promise.all([makeUser("c"), makeUser("p"), makeUser("adm")]);
    const tokens = {
      customer: (await service.createSessionTokens({ userId: c.id, email: c.email! })).refreshToken,
      partner: (await service.createSessionTokens({ userId: p.id, email: p.email! })).refreshToken,
      admin: (await service.createSessionTokens({ userId: a.id, email: a.email! })).refreshToken,
    };
    // one jar holding all three cookies, as a real browser would
    const jar = (["customer", "partner", "admin"] as const).map((x) => cookieFor(x, tokens[x])).join("; ");

    for (const audience of ["customer", "partner", "admin"] as const) {
      const r = await refresh({ audience, cookie: jar });
      expect(r.status).toBe(200);
      // it rotated ONLY its own cookie
      const names = r.setCookie.map((x) => x.split("=")[0]);
      expect(names).toEqual([REFRESH_COOKIE[audience]]);
    }
  });

  it("without an audience header the cookie is ignored (no ambient authority)", async () => {
    const u = await makeUser("noaud");
    const { refreshToken } = await service.createSessionTokens({ userId: u.id, email: u.email! });
    const r = await refresh({ cookie: cookieFor("customer", refreshToken) });
    expect(r.status).toBe(401);
    // …and the token itself is still valid when presented properly
    expect((await refresh({ audience: "customer", cookie: cookieFor("customer", refreshToken) })).status).toBe(200);
  });

  it("mobile keeps body tokens: no cookie is set and the token is returned", async () => {
    const u = await makeUser("mob");
    const { refreshToken } = await service.createSessionTokens({ userId: u.id, email: u.email! });
    const r = await refresh({ body: { refreshToken } });
    expect(r.status).toBe(200);
    expect(r.json.data?.refreshToken).toBeTruthy();
    expect(r.setCookie.length).toBe(0);
  });

  it("logout revokes the cookie's session server-side, not just the cookie", async () => {
    const u = await makeUser("revoke");
    const { accessToken, refreshToken } = await service.createSessionTokens({ userId: u.id, email: u.email! });
    const res = await app.handle(
      new Request("http://localhost/api/auth/logout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
          "X-Homigo-Audience": "customer",
          Cookie: cookieFor("customer", refreshToken),
        },
        body: JSON.stringify({}), // web sends no token in the body any more
      }),
    );
    expect(res.status).toBe(200);
    const row = await prisma.refreshToken.findUnique({ where: { token: refreshToken }, select: { revokedAt: true } });
    expect(row?.revokedAt).not.toBeNull();
    // and the token is dead on the wire
    expect((await refresh({ audience: "customer", cookie: cookieFor("customer", refreshToken) })).status).toBe(401);
  });

  it("logout still revokes and clears when the access token has expired", async () => {
    const u = await makeUser("expired");
    const { refreshToken } = await service.createSessionTokens({ userId: u.id, email: u.email! });
    // No Authorization header at all — the browser still holds the refresh cookie.
    const res = await app.handle(
      new Request("http://localhost/api/auth/logout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Homigo-Audience": "customer",
          Cookie: cookieFor("customer", refreshToken),
        },
        body: "{}",
      }),
    );
    expect(res.status).toBe(200);
    const cleared = (res.headers.getSetCookie?.() ?? []).find((c) => c.startsWith(REFRESH_COOKIE.customer));
    expect(cleared).toContain("Max-Age=0");
    const row = await prisma.refreshToken.findUnique({ where: { token: refreshToken }, select: { revokedAt: true } });
    expect(row?.revokedAt).not.toBeNull();
    expect((await refresh({ audience: "customer", cookie: cookieFor("customer", refreshToken) })).status).toBe(401);
  });

  it("logout never revokes another account's session sharing the browser", async () => {
    const victim = await makeUser("victim");
    const actor = await makeUser("actor");
    const victimSession = await service.createSessionTokens({ userId: victim.id, email: victim.email! });
    const actorSession = await service.createSessionTokens({ userId: actor.id, email: actor.email! });
    // The actor logs out with NO audience header, while the jar also holds the victim's cookie.
    const res = await app.handle(
      new Request("http://localhost/api/auth/logout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${actorSession.accessToken}`,
          Cookie: cookieFor("customer", victimSession.refreshToken),
        },
        body: "{}",
      }),
    );
    expect(res.status).toBe(200);
    const victimRow = await prisma.refreshToken.findUnique({
      where: { token: victimSession.refreshToken },
      select: { revokedAt: true },
    });
    expect(victimRow?.revokedAt).toBeNull(); // untouched
  });

  it("logout clears only its own audience's cookie", async () => {
    const u = await makeUser("out");
    const { accessToken, refreshToken } = await service.createSessionTokens({ userId: u.id, email: u.email! });
    const res = await app.handle(
      new Request("http://localhost/api/auth/logout", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}`, "X-Homigo-Audience": "partner" },
        body: JSON.stringify({ refreshToken }),
      }),
    );
    expect(res.status).toBe(200);
    const names = (res.headers.getSetCookie?.() ?? []).map((c) => c.split("=")[0]);
    expect(names).toEqual([REFRESH_COOKIE.partner]);
  });
});
