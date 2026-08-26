import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { adminApiToken, adminLogin } from "./enterprise/fixtures";

const API = (process.env.E2E_API_URL ?? "http://localhost:3000").replace(/\/$/, "");

test.describe("Section 02 admin live availability", () => {
  test("API: roster is authorized and returns capacity fields", async () => {
    const anon = await fetch(`${API}/api/admin/partner-availability?limit=5`);
    expect(anon.status).toBeGreaterThanOrEqual(401);

    const token = await adminApiToken();
    expect(token).toBeTruthy();
    const res = await fetch(`${API}/api/admin/partner-availability?limit=5`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const json = (await res.json()) as {
      success?: boolean;
      error?: string;
      data?: { items?: Array<{ status?: string; availableSlots?: number; utilization?: number }> };
    };
    expect(res.ok, json.error ?? "roster failed").toBeTruthy();
    expect(Array.isArray(json.data?.items)).toBe(true);
    if (json.data?.items?.[0]) {
      expect(json.data.items[0].status).toBeTruthy();
      expect(typeof json.data.items[0].availableSlots).toBe("number");
    }

    const filtered = await fetch(
      `${API}/api/admin/partner-availability?limit=20&status=online&search=homigo`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    expect(filtered.ok).toBeTruthy();
  });

  test("workforce roster loads and filters", async ({ page }) => {
    test.setTimeout(180_000);
    await adminLogin(page);
    const res = page.waitForResponse(
      (r) => r.url().includes("/api/admin/partner-availability") && r.ok(),
      { timeout: 45_000 },
    );
    await page.goto("/workforce");
    await res;
    await expect(page.getByRole("heading", { name: /live partner availability/i })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText(/^Partner$/)).toBeVisible();
    await expect(page.getByText(/^Status$/)).toBeVisible();
    await expect(page.getByText(/^Next$/)).toBeVisible();
    await page.getByLabel("Filter status").selectOption("online");
    await page.getByLabel("Search partners").fill("partner");
    await expect(page.getByLabel("Search partners")).toHaveValue("partner");
    await page.screenshot({ path: "e2e/__artifacts__/p2-admin-roster-desktop.png", fullPage: true });
    const viewports = [1920, 1440, 1366, 1280, 1024, 834, 768, 430, 414, 390, 375, 360];
    for (const w of viewports) {
      await page.setViewportSize({ width: w, height: w >= 1024 ? 900 : 800 });
      await expect(page.getByRole("heading", { name: /live partner availability/i })).toBeVisible();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `${w} overflow`).toBeLessThanOrEqual(32);
      await page.screenshot({ path: `e2e/__artifacts__/p2-admin-roster-${w}.png` });
    }
    const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    const blocking = axe.violations.filter((v) => v.impact === "critical" || v.impact === "serious");
    expect(blocking, JSON.stringify(blocking.map((v) => v.id))).toEqual([]);
  });
});

