import { describe, expect, test } from "bun:test";
import { NextRequest } from "next/server";
import { middleware } from "../../src/middleware";

/**
 * `next start` builds `request.url` from its listen address, not the Host the browser sent.
 * Redirects must follow Host (and https from X-Forwarded-Proto), never localhost.
 */
function requestFor(path: string, extra: Record<string, string> = {}) {
  return new NextRequest(new URL(path, "http://localhost:3001"), {
    headers: { host: "app.homeeigo.example", ...extra },
  });
}

describe("middleware redirects stay on the browser's origin", () => {
  test("a signed-out protected route goes to /login on the Host the browser used", async () => {
    const res = await middleware(requestFor("/bookings?tab=past"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://app.homeeigo.example/login?returnUrl=%2Fbookings%3Ftab%3Dpast");
  });

  test("a signed-in auth route returns to a sanitized path on that same Host", async () => {
    const res = await middleware(requestFor("/login?returnUrl=%2Fbook%3Fservice%3Dx", { cookie: "homigo_session=1" }));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://app.homeeigo.example/book?service=x");
  });

  test("https from X-Forwarded-Proto is kept; a spoofed X-Forwarded-Host is not", async () => {
    const res = await middleware(
      requestFor("/bookings", { "x-forwarded-proto": "https", "x-forwarded-host": "evil.example" }),
    );
    expect(res.headers.get("location")).toBe("https://app.homeeigo.example/login?returnUrl=%2Fbookings");
  });

  test("127.0.0.1 stays 127.0.0.1 — localhost is a different cookie site", async () => {
    const res = await middleware(
      new NextRequest(new URL("/bookings", "http://localhost:3017"), { headers: { host: "127.0.0.1:3017" } }),
    );
    expect(res.headers.get("location")).toBe("http://127.0.0.1:3017/login?returnUrl=%2Fbookings");
  });

  test("an off-site returnUrl still lands on this app", async () => {
    const res = await middleware(requestFor("/login?returnUrl=https%3A%2F%2Fevil.example%2F", { cookie: "homigo_session=1" }));
    expect(res.headers.get("location")).toBe("http://app.homeeigo.example/");
  });
});
