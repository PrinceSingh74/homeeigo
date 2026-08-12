import { test, expect } from "@playwright/test";
import { adminLogin } from "./enterprise/fixtures";
import path from "path";

test("capture HOMIGO-20260611-00003 vendor column", async ({ page }) => {
  await adminLogin(page);
  await page.goto("/bookings");
  await expect(page.getByRole("heading", { name: "Bookings" })).toBeVisible({ timeout: 30_000 });

  const row = page.getByRole("row").filter({ hasText: "HOMIGO-20260611-00003" });
  await expect(row).toBeVisible({ timeout: 30_000 });
  await expect(row.getByText("Rahul Sharma")).toBeVisible();
  await expect(row.getByText(/accepted/i)).toBeVisible();

  const out = path.join(process.cwd(), "e2e-artifacts", "booking-vendor-audit.png");
  await page.screenshot({ path: out, fullPage: true });
});
