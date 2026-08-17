import { expect } from "@playwright/test";
import { adminApiToken, adminLogin, SEED_ADMIN, test } from "./fixtures";

const API = (process.env.E2E_API_URL ?? "http://localhost:3000").replace(/\/$/, "");

test.describe.configure({ mode: "serial" });

test.describe("Enterprise admin E2E", () => {
  test("login → dashboard analytics", async ({ page, monitor }) => {
    await adminLogin(page);
    await expect(page.getByRole("heading", { name: /business overview/i })).toBeVisible({
      timeout: 30_000,
    });
    const dashRes = page.waitForResponse(
      (r) => r.url().includes("/api/admin/dashboard") && r.ok(),
      { timeout: 30_000 },
    );
    await page.goto("/analytics");
    await dashRes;
    await expect(page.getByRole("heading", { name: /analytics/i }).first()).toBeVisible({
      timeout: 30_000,
    });
    monitor.assertClean();
  });

  test("provider approval queue", async ({ page, monitor }) => {
    await adminLogin(page);
    await page.goto("/vendors");
    const providersRes = page.waitForResponse(
      (r) => r.url().includes("/api/admin/providers") && r.ok(),
      { timeout: 30_000 },
    );
    await providersRes;
    await expect(page.getByRole("heading", { name: /partners|vendors|providers/i }).first()).toBeVisible({
      timeout: 30_000,
    });
    const token = await adminApiToken();
    const providers = await fetch(`${API}/api/admin/providers?limit=5`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(providers.ok).toBe(true);
    monitor.assertClean();
  });

  test("refund approval queue", async ({ page, monitor }) => {
    await adminLogin(page);
    await page.goto("/finance/refunds");
    const res = page.waitForResponse(
      (r) => r.url().includes("/api/admin/finance/refunds") && r.ok(),
      { timeout: 30_000 },
    );
    await res;
    await expect(page.getByRole("heading", { name: /refund/i }).first()).toBeVisible({
      timeout: 30_000,
    });
    monitor.assertClean();
  });

  test("compliance — account deletions", async ({ page, monitor }) => {
    await adminLogin(page);
    await page.goto("/account-deletions");
    const res = page.waitForResponse(
      (r) => r.url().includes("/api/admin/account-deletions") && r.ok(),
      { timeout: 30_000 },
    );
    await res;
    await expect(page.getByRole("heading", { name: /deletion|account/i }).first()).toBeVisible({
      timeout: 30_000,
    });
    monitor.assertClean();
  });

  test("support ticket management", async ({ page, monitor }) => {
    await adminLogin(page);
    await page.goto("/support");
    const res = page.waitForResponse(
      (r) => r.url().includes("/api/admin/support") && r.ok(),
      { timeout: 30_000 },
    );
    await res;
    await expect(page.getByRole("heading", { name: /support/i }).first()).toBeVisible({
      timeout: 30_000,
    });
    monitor.assertClean();
  });
});
