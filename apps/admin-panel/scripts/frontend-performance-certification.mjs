/**
 * Frontend performance certification — collects runtime evidence for all audit phases.
 *
 *   node scripts/frontend-performance-certification.mjs
 *   NAV_PROBE_TAG=after node scripts/nav-transition-probe.mjs --samples=2
 */
import { chromium } from "@playwright/test";
import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..", "..");
const OUT = join(ROOT, "measurements");
const ADMIN = { email: "admin@homigo.demo", password: "Homigo@123" };
const BASE = process.env.E2E_ADMIN_URL ?? "http://localhost:3003";

const ROUTES = [
  { href: "/", label: "Dashboard", ready: "Business overview" },
  { href: "/command-center", label: "Command Center", ready: "Layers" },
  { href: "/operations", label: "Operations", ready: "Live Operations" },
  { href: "/bookings", label: "Bookings", ready: "Bookings" },
  { href: "/support", label: "Support", ready: "Support Operations" },
  { href: "/heatmap", label: "Heatmap", ready: "Demand Heatmap" },
  { href: "/observability", label: "Observability", ready: "Observability Dashboard" },
  { href: "/digital-twin", label: "Digital Twin", ready: "City Digital Twin" },
];

function pct(arr, p) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
}

async function login(page) {
  await page.goto(`${BASE}/login`);
  await page.locator("#admin-email").fill(ADMIN.email);
  await page.locator("#admin-password").fill(ADMIN.password);
  await page.getByRole("button", { name: /enter business hq/i }).click();
  await page.waitForSelector("text=Business overview", { timeout: 120_000 });
}

async function measureNav(page, fromHref, route) {
  await page.goto(`${BASE}${fromHref}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(120);
  const link = page.locator(`aside.biz-sidebar nav a[href="${route.href}"]`).first();
  if ((await link.count()) === 0) return null;

  const snapBefore = await page.evaluate(() => ({
    renders: { ...(window.__HOMIGO_RENDER_IDLE__ ?? {}) },
    dom: document.querySelectorAll("*").length,
  }));

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
  await page.waitForTimeout(400);

  const snapAfter = await page.evaluate(() => ({
    renders: { ...(window.__HOMIGO_RENDER_IDLE__ ?? {}) },
    dom: document.querySelectorAll("*").length,
    mapMetrics: window.__HOMIGO_MAP_METRICS__ ?? [],
    chartMetrics: window.__HOMIGO_CHART_METRICS__ ?? {},
    deferMetrics: window.__HOMIGO_DEFER_METRICS__ ?? [],
  }));

  const renderDelta = {};
  for (const [k, v] of Object.entries(snapAfter.renders)) {
    renderDelta[k] = v - (snapBefore.renders[k] ?? 0);
  }

  return {
    route: route.href,
    label: route.label,
    commitMs: Math.round(tCommit - t0),
    paintMs: Math.round(tPaint - t0),
    contentMs: Math.round(tContent - t0),
    domNodes: snapAfter.dom,
    domDelta: snapAfter.dom - snapBefore.dom,
    renderDelta,
    mapMetrics: snapAfter.mapMetrics,
    chartMetrics: snapAfter.chartMetrics,
    deferMetrics: snapAfter.deferMetrics,
  };
}

async function domHeatmap(page, route) {
  await page.goto(`${BASE}${route.href}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(600);
  return page.evaluate(() => {
    const counts = new Map();
    for (const el of document.querySelectorAll("*")) {
      const tag = el.tagName.toLowerCase();
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
    const byTag = Object.fromEntries([...counts.entries()].sort((a, b) => b[1] - a[1]));
    return {
      total: document.querySelectorAll("*").length,
      byTag,
      animatePing: document.querySelectorAll('[class*="animate-ping"]').length,
      animatePulse: document.querySelectorAll('[class*="animate-pulse"]').length,
      animateBounce: document.querySelectorAll('[class*="animate-bounce"]').length,
    };
  });
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultNavigationTimeout(120_000);

  await login(page);

  const navResults = [];
  for (const route of ROUTES) {
    const m = await measureNav(page, "/settings", route);
    if (m) navResults.push(m);
    await page.waitForTimeout(80);
  }

  const domDashboard = await domHeatmap(page, ROUTES[0]);
  const domCommand = await domHeatmap(page, ROUTES[1]);

  const renderStorm = navResults
    .flatMap((r) => Object.entries(r.renderDelta).map(([k, v]) => ({ component: k, renders: v, route: r.route })))
    .sort((a, b) => b.renders - a.renders)
    .slice(0, 50);

  let bundleAudit = null;
  try {
    execSync("npm run build", { cwd: join(ROOT, "apps", "admin-panel"), stdio: "pipe" });
    const manifestPath = join(ROOT, "apps", "admin-panel", ".next", "build-manifest.json");
    if (existsSync(manifestPath)) {
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      bundleAudit = {
        pages: Object.keys(manifest.pages ?? {}).length,
        sampleRoutes: Object.fromEntries(
          Object.entries(manifest.pages ?? {})
            .filter(([k]) => ["/", "/command-center", "/bookings"].some((r) => k.includes(r.replace("/", "")) || k === r))
            .slice(0, 8)
            .map(([k, v]) => [k, Array.isArray(v) ? v.length : 0]),
        ),
      };
    }
  } catch (e) {
    bundleAudit = { error: String(e.message ?? e).slice(0, 500) };
  }

  const report = {
    generatedAt: new Date().toISOString(),
    base: BASE,
    navigation: {
      routes: navResults,
      paint_p50: pct(navResults.map((r) => r.paintMs), 50),
      content_p50: pct(navResults.map((r) => r.contentMs), 50),
      content_p95: pct(navResults.map((r) => r.contentMs), 95),
      dashboard: navResults.find((r) => r.route === "/"),
      commandCenter: navResults.find((r) => r.route === "/command-center"),
    },
    dom: {
      dashboard: domDashboard,
      commandCenter: domCommand,
    },
    renderStorm: { top50: renderStorm },
    bundle: bundleAudit,
  };

  const outPath = join(OUT, "frontend-performance-certification.json");
  writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  console.log(`\nWrote ${outPath}`);
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
