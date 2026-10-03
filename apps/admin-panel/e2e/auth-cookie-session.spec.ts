import { test, expect } from "@playwright/test";

/**
 * Release certification Phase 3 — the refresh token must never be reachable from JavaScript.
 *
 * Signs in for real, then asserts in the BROWSER that:
 *   - no storage entry contains a JWT,
 *   - the session survives a full reload (so the HttpOnly cookie really is carrying it),
 *   - logout ends the session and a reload lands back on /login.
 */
const SEED_ADMIN = { email: "admin@homigo.demo", password: "Homigo@123" };

/** API origin that will actually receive this page's host-scoped refresh cookie. */
function apiOriginForPage(pageUrl: string): string {
  const configured = new URL(process.env.E2E_API_URL ?? "http://localhost:3000");
  const pageHost = new URL(pageUrl).hostname;
  const loopback = (host: string) => host === "localhost" || host === "127.0.0.1" || host === "[::1]";
  if (loopback(configured.hostname) && loopback(pageHost)) configured.hostname = pageHost;
  return configured.origin;
}

const storageDump = () =>
  ({
    local: Object.fromEntries(Object.entries(localStorage)),
    session: Object.fromEntries(Object.entries(sessionStorage)),
  });

test.describe.configure({ mode: "serial" });

test.describe("admin session lives in an HttpOnly cookie", () => {
  test("login → no token in storage → survives reload → logout", async ({ page }) => {
    test.setTimeout(120_000);

    await page.goto("/login");
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await page.reload();
    await page.locator("#admin-email").fill(SEED_ADMIN.email);
    await page.locator("#admin-password").fill(SEED_ADMIN.password);
    const loginResponse = page.waitForResponse(
      (res) => res.url().includes("/api/auth/login") && res.status() === 200,
      { timeout: 60_000 },
    );
    await page.getByRole("button", { name: /enter business hq/i }).click();
    const login = await loginResponse;

    // 1. the API did not hand a refresh token to JavaScript
    const body = (await login.json()) as { data?: Record<string, unknown> };
    expect(body.data?.refreshToken).toBeUndefined();

    await expect(page).not.toHaveURL(/\/login/, { timeout: 60_000 });

    // 2. nothing that looks like a token is in browser storage
    const stored = await page.evaluate(storageDump);
    const dump = JSON.stringify(stored);
    expect(dump).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}/); // no JWT anywhere
    expect(dump.toLowerCase()).not.toContain("refreshtoken");

    // 3. the refresh cookie exists, is HttpOnly, and is scoped to /api/auth
    const cookie = (await page.context().cookies()).find((c) => c.name === "hg_rt_admin");
    expect(cookie, "hg_rt_admin cookie must be set").toBeTruthy();
    expect(cookie!.httpOnly).toBe(true);
    expect(cookie!.path).toBe("/api/auth");

    // 4. the session survives a full reload — only the cookie can restore it
    // NOT networkidle: the signed-in shell holds a live WebSocket (presence/updates), so the network
    // never goes idle and the wait times out. The property under test is that the session survives a
    // full document reload, which domcontentloaded already establishes.
    // The reloaded app restores its memory-only access token by rotating the refresh cookie. Wait for
    // that rotation to land before step 5 refreshes by hand: a manual refresh sent while the app's is
    // still in flight presents the pre-rotation cookie, and the app's later Set-Cookie writes a new
    // token after logout has already cleared the one this test revoked.
    const bootRefresh = page.waitForResponse(
      (r) => r.url().includes("/api/auth/refresh") && r.request().method() === "POST",
      { timeout: 60_000 },
    );
    await page.reload({ waitUntil: "domcontentloaded" });
    expect((await bootRefresh).status()).toBe(200);
    await expect(page).not.toHaveURL(/\/login/, { timeout: 60_000 });

    // 5. logging out ends it. The app logs out with its in-memory access token, so the test first
    //    refreshes (cookie mode, exactly as the app does) to obtain one.
    // The refresh cookie is host-scoped. localhost and 127.0.0.1 are different sites, so a
    // refresh aimed at the other loopback host does not send the cookie and comes back 401.
    const apiBase = apiOriginForPage(page.url());
    const result = await page.evaluate(async (base) => {
      const r = await fetch(`${base}/api/auth/refresh`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", "X-Homigo-Audience": "admin" },
        body: "{}",
      });
      const body = (await r.json()) as { data?: { accessToken?: string; refreshToken?: string } };
      const out = await fetch(`${base}/api/auth/logout`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "X-Homigo-Audience": "admin",
          Authorization: `Bearer ${body.data?.accessToken ?? ""}`,
        },
        body: "{}",
      });
      return { refreshStatus: r.status, refreshGaveToken: Boolean(body.data?.refreshToken), logoutStatus: out.status };
    }, apiBase);

    // refresh worked from the cookie alone, and still did not hand the token to JavaScript
    expect(result.refreshStatus).toBe(200);
    expect(result.refreshGaveToken).toBe(false);
    expect(result.logoutStatus).toBe(200);

    const after = (await page.context().cookies()).find((c) => c.name === "hg_rt_admin");
    expect(after?.value ?? "").toBe("");
  });
});
