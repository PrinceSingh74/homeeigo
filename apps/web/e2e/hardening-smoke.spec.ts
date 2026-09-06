import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

/**
 * Minimal real-chromium smoke for the customer web app — proves the browser harness +
 * app render independently of the heavier monitored enterprise journeys.
 */
const ART = path.join(__dirname, "__artifacts__");
fs.mkdirSync(ART, { recursive: true });

test.describe("Web app — browser smoke", () => {
  test("home renders in chromium", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.getByText(/HOMEEIGO|HOMIGO/i).first()).toBeVisible({ timeout: 30_000 });
  });

  test("login page renders with credential fields", async ({ page }) => {
    await page.goto("/login", { waitUntil: "domcontentloaded" });
    await expect(page.locator('input[type="password"]')).toBeVisible({ timeout: 30_000 });
    await page.screenshot({ path: path.join(ART, "web-login.png") });
  });
});
