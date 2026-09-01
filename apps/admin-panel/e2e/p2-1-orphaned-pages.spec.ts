import { test, expect } from "@playwright/test";

const SEED_ADMIN = { email: "admin@homigo.demo", password: "Homigo@123" };

/**
 * P2-1 — the two built-but-unreachable admin pages, now wired into navigation.
 *
 * Discovery found `/observability/logs` was a pure wiring gap (correctly built, uses the
 * authenticated `adminApi`), but `/vision` was additionally BROKEN: it used a bare
 * `fetch("/api/vision/status")` with no Authorization header (backend answered 401, verified
 * directly against the running server) and read stats straight off the response instead of
 * unwrapping `{ success, data }`. Wiring it into the nav without fixing that would have surfaced
 * a permanently-empty page to every admin — so both defects were fixed as part of this item.
 */
async function loginAsAdmin(page: import("@playwright/test").Page): Promise<void> {
  await page.goto("/login");
  await page.locator("#admin-email").fill(SEED_ADMIN.email);
  await page.locator("#admin-password").fill(SEED_ADMIN.password);
  await page.getByRole("button", { name: /enter business hq/i }).click();
  await expect(page.getByRole("heading", { name: /Executive HQ|business overview/i })).toBeVisible({
    timeout: 30_000,
  });
}

test.describe("P2-1 previously-orphaned pages are reachable and functional", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test("Vision Analytics is reachable from the sidebar and renders REAL data (not undefined)", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));

    const sidebar = page.locator("[data-admin-shell]");
    // Intelligence HQ (formerly "AI") owns this entry — expand the section, then follow the real nav link.
    await sidebar.getByText("Intelligence", { exact: true }).first().click();
    await sidebar.getByRole("link", { name: /Vision Analytics/i }).click();

    await expect(page.getByRole("heading", { name: /Vision Analytics/i })).toBeVisible({ timeout: 20_000 });

    // The KPI must show a real number. Before the fix this could never resolve, because the
    // request 401'd and the response envelope was never unwrapped.
    // `data-stat-value` is KpiCard's own value element — a far more robust target than DOM position.
    const totalValue = page.locator(".biz-kpi", { hasText: "Total analyses" }).locator("[data-stat-value]");
    await expect(totalValue).toBeVisible();
    await expect(totalValue).not.toContainText("undefined");
    await expect(totalValue).not.toContainText("NaN");
    // "…" is the loading placeholder and "—" the honest absent-value placeholder; a page that has
    // actually resolved real data must show a digit.
    await expect(totalValue).toHaveText(/\d/, { timeout: 20_000 });

    // The page must NOT be showing the admin-access-required state for a real admin.
    await expect(page.getByText(/Admin access required/i)).toHaveCount(0);
    expect(errors, `page errors: ${errors.join("; ")}`).toHaveLength(0);
  });

  test("Log Search is reachable from the sidebar and renders", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));

    const sidebar = page.locator("[data-admin-shell]");
    await sidebar.getByText("Monitoring", { exact: true }).first().click();
    await sidebar.getByRole("link", { name: /Log Search/i }).click();

    await expect(page).toHaveURL(/\/observability\/logs/, { timeout: 20_000 });
    expect(errors, `page errors: ${errors.join("; ")}`).toHaveLength(0);
  });

  test("direct URL still works for an authorized admin (navigation is not the gate)", async ({ page }) => {
    await page.goto("/vision");
    await expect(page.getByRole("heading", { name: /Vision Analytics/i })).toBeVisible({ timeout: 20_000 });
  });
});

test.describe("P2-1 backend RBAC remains authoritative", () => {
  test("an unauthenticated request to the vision endpoint is rejected regardless of any UI change", async ({ request }) => {
    const api = (process.env.E2E_API_URL ?? "http://localhost:3000").replace(/\/$/, "");
    const res = await request.get(`${api}/api/vision/status`, { failOnStatusCode: false });
    // Navigation wiring must never grant access — the server still requires a real admin token.
    expect(res.status()).toBe(401);
  });

  test("a forged token is rejected on the vision endpoint", async ({ request }) => {
    const api = (process.env.E2E_API_URL ?? "http://localhost:3000").replace(/\/$/, "");
    const res = await request.get(`${api}/api/vision/status`, {
      headers: { Authorization: "Bearer forged.token.value" },
      failOnStatusCode: false,
    });
    expect(res.status()).toBe(401);
  });
});

test.describe("P2-1 accessibility + responsive", () => {
  test("vision page nav link is a real link and the page has one h1", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/vision");
    await expect(page.getByRole("heading", { level: 1, name: /Vision Analytics/i })).toHaveCount(1);
    // The purge control must be a real button (keyboard-reachable), not a click-handled div.
    await expect(page.getByRole("button", { name: /Purge expired images/i })).toBeVisible();
  });

  test("vision page has no horizontal overflow at mobile width", async ({ page }) => {
    await loginAsAdmin(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/vision");
    await expect(page.getByRole("heading", { name: /Vision Analytics/i })).toBeVisible({ timeout: 20_000 });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, "page must not scroll horizontally on mobile").toBeLessThanOrEqual(1);
  });
});
