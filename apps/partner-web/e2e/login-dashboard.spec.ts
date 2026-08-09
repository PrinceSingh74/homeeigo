import { test, expect } from "@playwright/test";

const SEED_PARTNER = {
  email: "partner@homigo.demo",
  password: "Homigo@123",
};

test.describe("Partner app", () => {
  test("seed partner can sign in and view dashboard", async ({ page }) => {
    await page.goto("/login");
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await expect(page.getByText(/HOMIGO/i).first()).toBeVisible();

    await page.locator("#partner-email").fill(SEED_PARTNER.email);
    await page.locator("#partner-password").fill(SEED_PARTNER.password);

    const loginResponse = page.waitForResponse(
      (res) => res.url().includes("/api/auth/login") && res.status() === 200,
      { timeout: 60_000 },
    );
    await page.getByRole("button", { name: /^sign in$/i }).click();
    await loginResponse;

    await expect(page).not.toHaveURL(/\/login/, { timeout: 60_000 });
    await expect(page.getByRole("heading", { name: /new booking requests/i })).toBeVisible({
      timeout: 60_000,
    });
  });
});
