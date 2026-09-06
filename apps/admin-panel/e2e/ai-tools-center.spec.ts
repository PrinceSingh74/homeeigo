import { test, expect } from "@playwright/test";
import { adminLogin } from "./enterprise/fixtures";

test.describe("Enterprise Tool Center", () => {
  test.beforeEach(async ({ page }) => {
    await adminLogin(page);
  });

  test("loads all Phase 5 admin sections without JS errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });

    await page.goto("/ai-brain/tools");
    await expect(page.getByRole("heading", { name: /Enterprise Tool Center/i })).toBeVisible({ timeout: 30_000 });

    await expect(page.getByRole("heading", { name: /Tool Registry/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Approval Queue/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /High Risk Queue/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Execution History/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Denied Requests/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Policy Explorer/i })).toBeVisible();

    await expect(page.getByText(/Total Tools/i)).toBeVisible();
    await expect(page.getByText(/Executions \(7d\)/i)).toBeVisible();

    await page.getByRole("button", { name: /Refresh/i }).click();
    await page.waitForTimeout(1500);

    const tableRows = page.locator("table tbody tr");
    await expect(tableRows.first()).toBeVisible({ timeout: 20_000 });

    const benign = errors.filter(
      (e) =>
        !e.includes("favicon")
        && !e.includes("404")
        && !e.includes("Failed to load resource")
        && !e.includes("WebSocket connection"),
    );
    expect(benign, `JS errors: ${benign.join("; ")}`).toHaveLength(0);
  });
});
