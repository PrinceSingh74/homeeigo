/**
 * Cookie auth introduces a CSRF surface that bearer-only auth did not have. These tests hold the
 * properties that keep it closed (release certification Phase 14 / cookie plan):
 *
 *   1. the refresh cookie grants no ambient authority on ordinary APIs — those still need a bearer
 *      access token;
 *   2. within `Path=/api/auth` only, the cookie may drive `/refresh` and `/logout` (session
 *      teardown when access is missing/expired — see `auth.ts` + `auth-refresh-cookie` tests);
 *   3. a cookie-carried refresh needs the custom audience header, which a cross-site page cannot
 *      send without a CORS preflight the allowlist refuses;
 *   4. the CORS allowlist does not reflect an arbitrary origin, so that preflight cannot succeed.
 *
 * Contract (authoritative): cookie-only logout is intentional and must return 200 when a valid
 * refresh cookie is present. Expecting 401 for that case contradicted the implemented security
 * fix (independent review 2026-09-20) and the refresh-cookie / E2E suites.
 */
import "../load-env";
import { describe, it, expect, afterAll } from "bun:test";
import app from "../index";
import prisma from "../lib/prisma";
import { RefreshTokenService } from "../services/refresh-token.service";
import { JWTService } from "../services/jwt.service";
import { REFRESH_COOKIE } from "../lib/auth-cookies";

const service = new RefreshTokenService(prisma, new JWTService());
const RUN = `csrf${Date.now().toString(36)}`;
const userIds: string[] = [];

let seq = 0;
async function seedUser() {
  const u = await prisma.user.create({
    data: {
      email: `${RUN}-${++seq}@csrf.test`,
      phoneNumber: `+9172${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`,
      firstName: "Csrf",
      lastName: "Probe",
      password: "x".repeat(20),
      role: "CUSTOMER",
      isEmailVerified: true,
    },
  });
  userIds.push(u.id);
  return u;
}

afterAll(async () => {
  await prisma.refreshToken.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
});

describe("the refresh cookie grants no ambient authority", () => {
  it("cannot authenticate an ordinary API call — a bearer token is still required", async () => {
    const u = await seedUser();
    const { refreshToken, accessToken } = await service.createSessionTokens({ userId: u.id, email: u.email! });
    const cookie = `${REFRESH_COOKIE.customer}=${encodeURIComponent(refreshToken)}`;

    // Cookie only, with the audience header — still unauthenticated on a normal endpoint.
    const withCookie = await app.handle(
      new Request("http://localhost/api/users/addresses", {
        headers: { Cookie: cookie, "X-Homigo-Audience": "customer" },
      }),
    );
    expect(withCookie.status).toBe(401);

    // Positive control: the same request with the bearer token works.
    const withBearer = await app.handle(
      new Request("http://localhost/api/users/addresses", { headers: { Authorization: `Bearer ${accessToken}` } }),
    );
    expect(withBearer.status).toBe(200);
  });

  it("a state-changing non-auth endpoint is not reachable with the cookie alone", async () => {
    const u = await seedUser();
    const { refreshToken } = await service.createSessionTokens({ userId: u.id, email: u.email! });
    // DELETE still calls requireAuth before any DB work — proves no ambient cookie authority.
    const res = await app.handle(
      new Request("http://localhost/api/users/addresses/does-not-exist", {
        method: "DELETE",
        headers: {
          Cookie: `${REFRESH_COOKIE.customer}=${encodeURIComponent(refreshToken)}`,
          "X-Homigo-Audience": "customer",
          Origin: "https://evil.example",
        },
      }),
    );
    expect(res.status).toBe(401);
  });

  it("logout may tear down the session with the refresh cookie alone when access is absent", async () => {
    // Matches auth.ts (expired-access path) and auth-refresh-cookie.integration.test.ts.
    const u = await seedUser();
    const { refreshToken } = await service.createSessionTokens({ userId: u.id, email: u.email! });
    const res = await app.handle(
      new Request("http://localhost/api/auth/logout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: `${REFRESH_COOKIE.customer}=${encodeURIComponent(refreshToken)}`,
          "X-Homigo-Audience": "customer",
        },
        body: "{}",
      }),
    );
    expect(res.status).toBe(200);
    const row = await prisma.refreshToken.findUnique({
      where: { token: refreshToken },
      select: { revokedAt: true },
    });
    expect(row?.revokedAt).not.toBeNull();
  });
});

describe("CORS cannot be used to obtain the audience header", () => {
  it("does not reflect an arbitrary origin on the refresh preflight", async () => {
    const res = await app.handle(
      new Request("http://localhost/api/auth/refresh", {
        method: "OPTIONS",
        headers: {
          Origin: "https://evil.example",
          "Access-Control-Request-Method": "POST",
          "Access-Control-Request-Headers": "content-type,x-homigo-audience",
        },
      }),
    );
    const allowOrigin = res.headers.get("access-control-allow-origin") ?? "";
    expect(allowOrigin).not.toBe("https://evil.example");
    expect(allowOrigin).not.toBe("*");
  });

  it("allows a first-party origin, so the apps themselves still work", async () => {
    const res = await app.handle(
      new Request("http://localhost/api/auth/refresh", {
        method: "OPTIONS",
        headers: {
          Origin: "http://localhost:3001",
          "Access-Control-Request-Method": "POST",
          "Access-Control-Request-Headers": "content-type,x-homigo-audience",
        },
      }),
    );
    expect(res.headers.get("access-control-allow-origin")).toBe("http://localhost:3001");
    expect((res.headers.get("access-control-allow-headers") ?? "").toLowerCase()).toContain("x-homigo-audience");
    expect(res.headers.get("access-control-allow-credentials")).toBe("true");
  });
});
