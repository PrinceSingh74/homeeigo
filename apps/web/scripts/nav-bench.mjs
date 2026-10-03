/**
 * Measures what a nav-bar click actually costs, in a real browser.
 *
 *   node scripts/nav-bench.mjs                              # against dev  (:3001)
 *   WEB_URL=http://localhost:3011 node scripts/nav-bench.mjs # against a prod build
 *
 * Kept in the repo because "navigation feels slow" is unfalsifiable without it. Every performance
 * claim about this app should be a number produced by this script, run against both a dev server and
 * a production build — the two differ by an order of magnitude and conclusions drawn from the wrong
 * one are worthless.
 *
 * Reference numbers on a 13th-gen i5 laptop, 2026-09-17, before the dev route warmer existed:
 *
 *              dev 1st    dev 2nd    prod 1st   prod 2nd
 *   /services   1988ms      453ms       193ms      158ms
 *   /bookings   1600ms      367ms       175ms      227ms
 *   /wallet     1616ms      321ms       103ms       85ms
 *   /profile    1543ms      204ms       115ms       87ms
 *
 * Read-only: it signs in as the existing demo customer and navigates. It writes nothing.
 */
import { chromium } from "playwright";

const WEB = process.env.WEB_URL ?? "http://localhost:3001";
const API = process.env.API_URL ?? "http://localhost:3000";
const SETTLE_MS = Number(process.env.SETTLE_MS ?? 2500);
const ROUTES = ["/", "/services", "/bookings", "/wallet", "/profile", "/ai"];

const login = await fetch(`${API}/api/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    email: "customer@homigo.demo",
    password: "Homigo@123",
    setAuthCookies: true,
  }),
});
const session = (await login.json()).data;
if (!session?.accessToken) throw new Error("login failed");

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
/**
 * 2026-09-27: seeded cookies/localStorage kept rotting (store version bumps, device-bound refresh
 * tokens) and every rot made the bench "measure" a login redirect. The only seeding that cannot
 * rot is the app's own login form, once, before timing starts.
 */
await ctx.addInitScript(() => {
  // Long tasks are what make a transition feel janky rather than merely slow.
  window.__longTasks = [];
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) window.__longTasks.push(Math.round(e.duration));
  }).observe({ entryTypes: ["longtask"] });
});

const page = await ctx.newPage();
{
  await page.goto(`${WEB}/login`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.waitForLoadState("networkidle", { timeout: 60_000 }).catch(() => {});
  const email = page.getByLabel(/^email/i).first();
  await email.waitFor({ timeout: 60_000 });
  await email.fill("customer@homigo.demo");
  await page.getByLabel(/^password/i).first().fill("Homigo@123");
  const resP = page.waitForResponse((r) => r.request().method() === "POST" && r.url().includes("/api/auth/login"), { timeout: 30_000 });
  await page.getByRole("button", { name: /^sign in$/i }).first().click();
  const st = (await resP).status();
  if (st !== 200) throw new Error(`UI login failed: ${st}`);
  await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 60_000 });
}

let net = [];
page.on("response", async (res) => {
  const req = res.request();
  const t = req.timing();
  net.push({
    url: req.url().replace(WEB, "").replace(API, "«api»"),
    type: req.resourceType(),
    status: res.status(),
    ms: Math.max(0, Math.round(t.responseEnd - t.startTime)),
    started: Math.round(t.startTime),
  });
});

await page.goto(`${WEB}/`, { waitUntil: "load", timeout: 120_000 });
await page.waitForTimeout(3000);

async function navigate(href, label) {
  net = [];
  await page.evaluate(() => {
    window.__longTasks = [];
  });
  const link = page.locator(`header a[href="${href}"], nav a[href="${href}"]`).first();

  const t0 = Date.now();
  await link.click();
  await page.waitForURL(`**${href}`, { timeout: 60_000 });
  const commit = Date.now() - t0;
  await page.waitForTimeout(SETTLE_MS);

  const longTasks = await page.evaluate(() => window.__longTasks ?? []);
  const blocked = longTasks.reduce((s, d) => s + d, 0);
  const api = net.filter((r) => r.url.startsWith("«api»") || r.url.startsWith("/api/"));
  const script = net.filter((r) => r.type === "script");

  console.log(
    `${label} ${href.padEnd(10)} commit ${String(commit).padStart(5)}ms │ ` +
      `main-thread blocked ${String(blocked).padStart(5)}ms (${String(longTasks.length).padStart(2)} long tasks) │ ` +
      `${String(script.length).padStart(2)} js · ${String(api.length).padStart(2)} api`,
  );
  const slowApi = api.filter((r) => r.ms >= 100).sort((a, b) => b.ms - a.ms).slice(0, 6);
  for (const r of slowApi) {
    console.log(`      ${String(r.ms).padStart(5)}ms  ${String(r.status)}  ${r.url.slice(0, 84)}`);
  }
  if (api.length > 0) {
    const total = api.reduce((s, r) => s + r.ms, 0);
    console.log(`      api total ${total}ms across ${api.length} calls`);
  }
}

console.log(`── ${WEB} · first visit ──`);
for (const r of ROUTES) await navigate(r, "cold");
console.log(`\n── ${WEB} · revisit ──`);
for (const r of ROUTES) await navigate(r, "warm");

await browser.close();
