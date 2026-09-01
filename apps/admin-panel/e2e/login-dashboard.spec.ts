import { test, expect } from "@playwright/test";

const SEED_ADMIN = {
  email: "admin@homigo.demo",
  password: "Homigo@123",
};

test.describe("Admin console", () => {
  test("seed admin can sign in and view dashboard", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: /HOMEEIGO Business HQ/i })).toBeVisible();

    await page.locator("#admin-email").fill(SEED_ADMIN.email);
    await page.locator("#admin-password").fill(SEED_ADMIN.password);
    await page.getByRole("button", { name: /enter business hq/i }).click();

    await expect(page).toHaveURL(/\//, { timeout: 30_000 });
    await expect(page.getByRole("heading", { name: /Executive HQ|business overview/i })).toBeVisible({
      timeout: 30_000,
    });
  });
});
