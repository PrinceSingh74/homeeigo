import { test, expect } from "@playwright/test";

const SEED_ADMIN = {
  email: process.env.E2E_ADMIN_EMAIL ?? "admin@homigo.demo",
  password: process.env.E2E_ADMIN_PASSWORD ?? "Homigo@123",
};

async function adminLogin(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.locator("#admin-email").fill(SEED_ADMIN.email);
  await page.locator("#admin-password").fill(SEED_ADMIN.password);
  await page.getByRole("button", { name: /enter business hq/i }).click();
  await expect(page.getByRole("heading", { name: /business overview/i })).toBeVisible({
    timeout: 30_000,
  });
}

test.describe.configure({ mode: "serial" });

test.describe("Admin sign-off journey", () => {
  test("login → operations map", async ({ page }) => {
    await adminLogin(page);
    const res = page.waitForResponse(
      (r) => r.url().includes("/api/admin/ops-map") && r.ok(),
      { timeout: 30_000 },
    );
    await page.goto("/operations");
    await res;
    await expect(page.getByRole("heading", { name: /operations/i }).first()).toBeVisible({
      timeout: 30_000,
    });
  });

  test("heatmap console", async ({ page }) => {
    await adminLogin(page);
    const res = page.waitForResponse(
      (r) => r.url().includes("/api/admin/heatmap") && r.ok(),
      { timeout: 30_000 },
    );
    await page.goto("/heatmap");
    await res;
    await expect(page.getByRole("heading", { name: /heatmap/i }).first()).toBeVisible({
      timeout: 30_000,
    });
  });

  test("geofence console", async ({ page }) => {
    await adminLogin(page);
    const res = page.waitForResponse(
      (r) => r.url().includes("/api/admin/geofences") && r.ok(),
      { timeout: 30_000 },
    );
    await page.goto("/geofences");
    await res;
    await expect(page.getByRole("heading", { name: /geofence/i }).first()).toBeVisible({
      timeout: 30_000,
    });
  });
});
