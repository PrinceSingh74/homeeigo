import { chromium } from "@playwright/test";

const ADMIN = { email: "admin@homigo.demo", password: "Homigo@123" };
const BASE = process.env.E2E_ADMIN_URL ?? "http://localhost:3003";
const ROUTES = [
  { href: "/", ready: "Business overview" },
  { href: "/command-center", ready: "Layers" },
  { href: "/bookings", ready: "Bookings" },
  { href: "/support", ready: "Support Operations" },
  { href: "/heatmap", ready: "Demand Heatmap" },
  { href: "/operations", ready: "Live Operations" },
  { href: "/observability", ready: "Observability Dashboard" },
  { href: "/digital-twin", ready: "City Digital Twin" },
];

async function login(page) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.locator("#admin-email").fill(ADMIN.email);
  await page.locator("#admin-password").fill(ADMIN.password);
  await page.getByRole("button", { name: /enter business hq/i }).click();
  await page.waitForSelector("text=Business overview", { timeout: 60_000 });
}

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await login(page);

  const results = [];
  for (const route of ROUTES) {
    await page.goto(`${BASE}/settings`, { waitUntil: "domcontentloaded" });
    await page.locator("aside.biz-sidebar nav").waitFor({ timeout: 30_000 });
    await page.waitForTimeout(300);
    const link =
      route.href === "/"
        ? page.locator("aside.biz-sidebar nav a").filter({ hasText: "Overview" }).first()
        : page.locator(`aside.biz-sidebar nav a[href="${route.href}"]`).first();
    if ((await link.count()) === 0) {
      results.push({ route: route.href, err: "no-link" });
      continue;
    }
    const t0 = await page.evaluate(() => performance.now());
    await link.click();
    await page.waitForFunction(
      (href) => location.pathname === href || (href !== "/" && location.pathname.startsWith(href)),
      route.href,
      { timeout: 15_000 },
    );
    const tCommit = await page.evaluate(() => performance.now());
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const tPaint = await page.evaluate(() => performance.now());
    await page
      .waitForFunction(
        (readyText) => document.body.innerText.toLowerCase().includes(readyText.toLowerCase()),
        route.ready,
        { timeout: 8_000 },
      )
      .catch(() => undefined);
    const tContent = await page.evaluate(() => performance.now());
    const dom = await page.evaluate(() => document.querySelectorAll("*").length);
    const renders = await page.evaluate(() => ({ ...(window.__HOMIGO_RENDER_IDLE__ ?? {}) }));
    results.push({
      route: route.href,
      commitMs: Math.round(tCommit - t0),
      paintMs: Math.round(tPaint - t0),
      contentMs: Math.round(tContent - t0),
      domNodes: dom,
      renderCounts: renders,
    });
    await page.waitForTimeout(200);
  }

  console.log(JSON.stringify({ generatedAt: new Date().toISOString(), routes: results }, null, 2));
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
