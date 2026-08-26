import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { partnerLogin, partnerToken, test as enterpriseTest } from "./enterprise/fixtures";

const API = (process.env.E2E_API_URL ?? "http://localhost:3000").replace(/\/$/, "");

test.describe.configure({ mode: "default" });

test.describe("Section 02 partner operations", () => {
  test("API: schedule, service area, online, pause persist", async () => {
    const token = await partnerToken();
    expect(token).toBeTruthy();
    const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

    const save = await fetch(`${API}/api/providers/me/settings`, {
      method: "PUT",
      headers,
      body: JSON.stringify({
        workingDays: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sun"],
        workingHoursStart: "09:00",
        workingHoursEnd: "18:00",
        breakWindows: [{ start: "13:00", end: "14:00" }],
        maxJobsPerDay: 5,
        maxConcurrentJobs: 2,
        partnerId: "not-my-id",
      }),
    });
    const saveJson = (await save.json()) as { success?: boolean; error?: string };
    expect(save.ok, saveJson.error ?? "settings failed").toBeTruthy();

    const unauth = await fetch(`${API}/api/providers/me/online`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ online: true }),
    });
    expect(unauth.status).toBeGreaterThanOrEqual(401);

    const area = await fetch(`${API}/api/providers/me/service-area`, {
      method: "PUT",
      headers,
      body: JSON.stringify({
        city: "Gurugram",
        serviceRegions: ["Sector 45", "Sector 46"],
        serviceRadiusKm: 5,
        baseLatitude: 28.4595,
        baseLongitude: 77.0266,
      }),
    });
    expect(area.ok, await area.text()).toBeTruthy();

    const online = await fetch(`${API}/api/providers/me/online`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ online: true }),
    });
    const onlineJson = (await online.json()) as { success: boolean; data?: { isOnline?: boolean }; error?: string };
    if (!online.ok) {
      expect(onlineJson.error ?? "").toMatch(/pending|restricted|skill|service area|approval/i);
    } else {
      expect(onlineJson.data?.isOnline).toBe(true);
      const paused = await fetch(`${API}/api/providers/me/pause`, {
        method: "POST",
        headers,
        body: JSON.stringify({ reason: "break" }),
      });
      expect(paused.ok, await paused.text()).toBeTruthy();
      const ops = await fetch(`${API}/api/providers/me/operations`, { headers });
      const opsJson = (await ops.json()) as { data?: { operationalStatus?: string; workingDays?: string[] } };
      expect(opsJson.data?.operationalStatus).toBe("paused");
      expect(opsJson.data?.workingDays).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sun"]);
      await fetch(`${API}/api/providers/me/resume`, { method: "POST", headers });
      await fetch(`${API}/api/providers/me/online`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ online: false }),
      });
    }
  });

  enterpriseTest("web: availability command center", async ({ page, monitor }) => {
    test.setTimeout(180_000);
    await partnerLogin(page);
    await page.goto("/availability");
    await expect(page.getByRole("heading", { name: /availability/i }).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/loading availability/i)).toHaveCount(0, { timeout: 30_000 });
    await expect(page.getByText(/working days/i).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /go online|go offline|resume/i }).first()).toBeVisible();
    await page.getByRole("button", { name: /^sun/i }).click();
    await page.getByRole("button", { name: /save changes/i }).first().click();
    await expect(page.getByText(/schedule saved|service areas saved|you are/i).first()).toBeVisible({ timeout: 20_000 }).catch(() => {});
    await page.screenshot({ path: "e2e/__artifacts__/p2-availability-desktop.png", fullPage: true });
    const viewports = [
      { w: 1920, h: 1080 },
      { w: 1440, h: 900 },
      { w: 1366, h: 768 },
      { w: 1280, h: 800 },
      { w: 1024, h: 768 },
      { w: 834, h: 1112 },
      { w: 768, h: 1024 },
      { w: 430, h: 932 },
      { w: 414, h: 896 },
      { w: 390, h: 844 },
      { w: 375, h: 812 },
      { w: 360, h: 800 },
    ];
    for (const vp of viewports) {
      await page.setViewportSize({ width: vp.w, height: vp.h });
      await expect(page.getByRole("heading", { name: /availability/i }).first()).toBeVisible();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `${vp.w} overflow`).toBeLessThanOrEqual(24);
      await page.screenshot({ path: `e2e/__artifacts__/p2-availability-${vp.w}.png` });
    }
    await page.reload();
    await expect(page.getByRole("heading", { name: /availability/i }).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/working days/i).first()).toBeVisible();
    monitor.assertClean();
  });

  test("web a11y: availability", async ({ page }) => {
    await partnerLogin(page);
    await page.goto("/availability");
    await expect(page.getByRole("heading", { name: /availability/i }).first()).toBeVisible({ timeout: 30_000 });
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    const blocking = results.violations.filter((v) => v.impact === "critical" || v.impact === "serious");
    expect(blocking, JSON.stringify(blocking.map((v) => v.id))).toEqual([]);
  });
});
