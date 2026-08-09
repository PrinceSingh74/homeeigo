import { expect } from "@playwright/test";
import { partnerLogin, test } from "./enterprise/fixtures";

test.describe.configure({ mode: "serial" });

test.describe("Partner sign-off journey", () => {
  test("login → orders (requests)", async ({ page, monitor }) => {
    await partnerLogin(page);
    await expect(page.getByRole("heading", { name: /new booking requests/i })).toBeVisible({
      timeout: 60_000,
    });
    await page.goto("/requests");
    await expect(page.getByRole("heading", { name: /bookings/i })).toBeVisible({
      timeout: 30_000,
    });
    monitor.assertClean();
  });

  test("route center", async ({ page, monitor }) => {
    await partnerLogin(page);
    const res = page.waitForResponse(
      (r) =>
        (r.url().includes("/api/providers/me/route") ||
          r.url().includes("/api/providers/me/active-bookings")) &&
        r.ok(),
      { timeout: 30_000 },
    );
    await page.goto("/route-center");
    await res;
    await expect(page.getByRole("heading", { name: /route center/i })).toBeVisible({
      timeout: 30_000,
    });
    monitor.assertClean();
  });

  test("completion tab", async ({ page, monitor }) => {
    await partnerLogin(page);
    await page.goto("/requests");
    await page.getByRole("button", { name: /completed/i }).click();
    await expect(page.getByRole("button", { name: /completed/i })).toBeVisible();
    monitor.assertClean();
  });
});
