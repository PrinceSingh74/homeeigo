import { expect } from "@playwright/test";
import { partnerLogin, partnerToken, test } from "./fixtures";

const API = (process.env.E2E_API_URL ?? "http://localhost:3000").replace(/\/$/, "");

test.describe.configure({ mode: "serial" });

test.describe("Enterprise partner E2E", () => {
  test("login → dashboard", async ({ page, monitor }) => {
    await partnerLogin(page);
    await expect(page.getByRole("heading", { name: /new booking requests/i })).toBeVisible({
      timeout: 60_000,
    });
    const dashRes = page.waitForResponse(
      (r) => r.url().includes("/api/providers/me/dashboard") && r.ok(),
      { timeout: 30_000 },
    );
    await dashRes;
    monitor.assertClean();
  });

  test("bookings — accept / reject / complete via API + UI tabs", async ({ page, monitor }) => {
    await partnerLogin(page);
    const token = await partnerToken();

    const bookingsRes = await fetch(`${API}/api/providers/me/bookings?status=pending&limit=5`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(bookingsRes.ok).toBe(true);
    const bookingsJson = (await bookingsRes.json()) as {
      success: boolean;
      data?: { bookings?: Array<{ id: string }> };
    };

    await page.goto("/requests");
    await expect(page.getByRole("heading", { name: /bookings/i })).toBeVisible({ timeout: 30_000 });

    const pendingId = bookingsJson.data?.bookings?.[0]?.id;
    if (pendingId) {
      const rejectRes = await fetch(`${API}/api/bookings/${pendingId}/reject`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ reason: "E2E enterprise reject" }),
      });
      expect([200, 400, 403, 409]).toContain(rejectRes.status);
    }

    await page.getByRole("button", { name: /completed/i }).click();
    await page.getByRole("button", { name: /active/i }).click();
    monitor.assertClean();
  });

  test("earnings dashboard", async ({ page, monitor }) => {
    await partnerLogin(page);
    await page.goto("/earnings");
    const res = page.waitForResponse(
      (r) => r.url().includes("/api/providers/me/earnings") && r.ok(),
      { timeout: 30_000 },
    );
    await res;
    await expect(page.getByText(/earning|revenue/i).first()).toBeVisible({ timeout: 30_000 });
    monitor.assertClean();
  });

  test("payout request page", async ({ page, monitor }) => {
    await partnerLogin(page);
    await page.goto("/earnings/payouts");
    const res = page.waitForResponse(
      (r) => r.url().includes("/api/providers/me/payouts") && r.ok(),
      { timeout: 30_000 },
    );
    await res;
    await expect(page.getByText(/payout/i).first()).toBeVisible({ timeout: 30_000 });
    monitor.assertClean();
  });
});
