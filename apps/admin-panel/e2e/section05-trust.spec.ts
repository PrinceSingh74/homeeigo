import { expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import path from "node:path";
import fs from "node:fs";
import { adminLogin, adminApiToken, test } from "./enterprise/fixtures";

const API = (process.env.E2E_API_URL ?? "http://localhost:3000").replace(/\/$/, "");
const ART = path.join(__dirname, "__artifacts__", "section05");
fs.mkdirSync(ART, { recursive: true });

async function assertAxeSerious(page: import("@playwright/test").Page, context: string) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  const blocking = results.violations.filter((v) => v.impact === "critical" || v.impact === "serious");
  expect(blocking, `${context}\n${JSON.stringify(blocking.map((v) => ({ id: v.id, help: v.help })))}`).toEqual([]);
}

const VIEWPORTS = [
  { width: 1920, height: 1080 },
  { width: 1440, height: 900 },
  { width: 1366, height: 768 },
  { width: 1280, height: 800 },
  { width: 1024, height: 768 },
  { width: 834, height: 1112 },
  { width: 768, height: 1024 },
  { width: 430, height: 932 },
  { width: 414, height: 896 },
  { width: 390, height: 844 },
  { width: 375, height: 812 },
  { width: 360, height: 800 },
] as const;

const ROUTES = [
  { path: "/trust-safety", name: "overview", wait: "/api/admin/trust-safety/overview", heading: /trust & safety/i },
  { path: "/trust-safety/compliance", name: "compliance", wait: "/api/admin/trust-safety/compliance", heading: /partner compliance/i },
  { path: "/trust-safety/risk", name: "risk", wait: "/api/admin/trust-safety/risk", heading: /partner risk queue/i },
  { path: "/trust-safety/incidents", name: "incidents", wait: "/api/admin/trust-safety/incidents", heading: /safety incidents/i },
] as const;

async function openTrustRoute(
  page: import("@playwright/test").Page,
  route: (typeof ROUTES)[number],
) {
  const wait = page.waitForResponse((r) => r.url().includes(route.wait) && r.ok(), { timeout: 45_000 });
  await page.goto(route.path, { waitUntil: "domcontentloaded" });
  const res = await wait;
  expect(res.ok(), route.path).toBe(true);
  await expect(page.getByRole("heading", { name: route.heading })).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("h1")).toBeVisible();
}

test.describe("Section 05 admin Trust & Safety live E2E", () => {
  test("login → overview → compliance → risk → incidents with real APIs", async ({ page, monitor }) => {
    test.setTimeout(300_000);
    await adminLogin(page);
    for (const route of ROUTES) {
      await openTrustRoute(page, route);
      await page.screenshot({ path: path.join(ART, `admin-${route.name}-1440.png`), fullPage: true });
    }

    const token = await adminApiToken();
    const overview = await fetch(`${API}/api/admin/trust-safety/overview`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(overview.ok).toBe(true);
    const body = (await overview.json()) as { data?: { expiring?: number } };
    expect(typeof body.data?.expiring).toBe("number");
    monitor.assertClean();
  });

  test("axe serious/critical clean on Trust & Safety", async ({ page, monitor }) => {
    await adminLogin(page);
    for (const route of ROUTES) {
      await openTrustRoute(page, route);
      await assertAxeSerious(page, `admin ${route.path}`);
    }
    monitor.assertClean();
  });

  test("responsive matrix has no overflow", async ({ page }) => {
    test.setTimeout(600_000);
    await adminLogin(page);
    for (const vp of VIEWPORTS) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      for (const route of ROUTES) {
        await openTrustRoute(page, route);
        await page.screenshot({
          path: path.join(ART, `admin-${route.name}-${vp.width}.png`),
          fullPage: true,
        });
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 24,
        );
        expect(overflow, `${route.name}@${vp.width}`).toBe(false);
      }
    }
  });

  test("risk detail is explainable and incident detail uses real data", async ({ page, monitor }) => {
    await adminLogin(page);
    const token = await adminApiToken();
    const headers = { Authorization: `Bearer ${token}` };

    await page.goto("/trust-safety/risk", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: /partner risk queue/i })).toBeVisible({ timeout: 30_000 });
    await page.getByLabel("Review status").selectOption("MONITOR");
    await page.waitForTimeout(500);

    const riskRes = await fetch(`${API}/api/admin/trust-safety/risk?reviewStatus=MONITOR&page=1`, { headers });
    expect(riskRes.ok).toBe(true);
    const riskBody = (await riskRes.json()) as {
      data?: { items?: Array<{ providerId: string; riskLevel: string; explanation?: { why?: string } }> };
    };
    const riskItem = riskBody.data?.items?.[0];
    expect(riskItem?.providerId, "need a MONITOR risk profile from live cert").toBeTruthy();
    expect(JSON.stringify(riskBody)).toMatch(/why|GPS_SPOOF|signal/i);

    await page.goto(`/trust-safety/risk/${riskItem!.providerId}`, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: /partner risk/i })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/LOW|MEDIUM|HIGH|CRITICAL/).first()).toBeVisible();
    await expect(page.getByText(/because of|contribution|no explanation/i).first()).toBeVisible();
    await page.screenshot({ path: path.join(ART, "admin-risk-detail-1440.png"), fullPage: true });

    const incidentsRes = await fetch(`${API}/api/admin/trust-safety/incidents?page=1`, { headers });
    expect(incidentsRes.ok).toBe(true);
    const incidentsBody = (await incidentsRes.json()) as { data?: { items?: Array<{ id: string }> } };
    const incidentId = incidentsBody.data?.items?.[0]?.id;
    expect(incidentId, "need a safety incident from live cert").toBeTruthy();

    await page.goto(`/trust-safety/incidents/${incidentId}`, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: /incident/i })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/emergency contact/i).first()).toBeVisible();
    await expect(page.getByText(/live location/i).first()).toBeVisible();
    const bodyText = await page.locator("body").innerText();
    expect(bodyText).not.toMatch(/\+91\d{10}/);
    await page.screenshot({ path: path.join(ART, "admin-incident-detail-1440.png"), fullPage: true });
    monitor.assertClean();
  });
});
