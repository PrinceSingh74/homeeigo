/**
 * Admin sidebar navigation transition profiler — runtime evidence.
 * Measures click → router commit → paint → content visible per route.
 * Detects layout remounts, duplicate API calls, render churn, long tasks.
 *
 *   node scripts/nav-transition-probe.mjs
 *   node scripts/nav-transition-probe.mjs --samples=3 --routes=core
 */
import { chromium } from "@playwright/test";
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, "..", "..", "..", "homigo-mobile", ".certification-evidence");
const ADMIN = { email: "admin@homigo.demo", password: "Homigo@123" };
const BASE = process.env.E2E_ADMIN_URL ?? "http://localhost:3003";
const SAMPLES = Number(process.argv.find((a) => a.startsWith("--samples="))?.split("=")[1] ?? 3);
const ROUTE_SET = process.argv.find((a) => a.startsWith("--routes="))?.split("=")[1] ?? "core";
const TARGET_MS = 300;

const CORE_ROUTES = [
  { href: "/", label: "Overview", ready: "Business overview" },
  { href: "/command-center", label: "Command Center", ready: "Layers" },
  { href: "/digital-twin", label: "City Digital Twin", ready: "City Digital Twin" },
  { href: "/operations", label: "Live Ops", ready: "Live Operations" },
  { href: "/heatmap", label: "Demand Heatmap", ready: "Demand Heatmap" },
  { href: "/bookings", label: "Bookings", ready: "Bookings" },
  { href: "/customers", label: "Customers", ready: "Customers" },
  { href: "/support", label: "Support", ready: "Support Operations" },
  { href: "/observability", label: "Observability", ready: "Observability Dashboard" },
  { href: "/settings", label: "Settings", ready: "Settings" },
];

const EXTENDED_ROUTES = [
  ...CORE_ROUTES,
  { href: "/geospatial", label: "Geo Command", ready: "Geo Command" },
  { href: "/vendors", label: "Vendors", ready: "Partner Network" },
  { href: "/analytics", label: "Analytics", ready: "Analytics" },
  { href: "/ai", label: "AI Systems", ready: "AI systems" },
  { href: "/fraud", label: "Fraud", ready: "Fraud" },
];

const ROUTES = ROUTE_SET === "extended" ? EXTENDED_ROUTES : CORE_ROUTES;

function pct(arr, p) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
}

function isHomigoApi(url) {
  try {
    const u = new URL(url);
    return (
      u.pathname.startsWith("/api/admin") ||
      u.pathname.startsWith("/api/geo-intel") ||
      u.pathname.startsWith("/api/digital-twin") ||
      u.pathname === "/api/user/me"
    );
  } catch {
    return false;
  }
}

async function login(page) {
  await page.goto(`${BASE}/login`);
  await page.locator("#admin-email").fill(ADMIN.email);
  await page.locator("#admin-password").fill(ADMIN.password);
  await page.getByRole("button", { name: /enter business hq/i }).click();
  await page.waitForSelector("text=Business overview", { timeout: 120_000 });
}

async function warmRoutes(page) {
  for (const { href } of ROUTES) {
    await page.goto(`${BASE}${href}`, { waitUntil: "domcontentloaded", timeout: 120_000 }).catch(() => {});
    await page.waitForTimeout(200);
  }
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(300);
}

async function measureTransition(page, cdp, pivotHref, route) {
  const apiCalls = [];
  const rscRequests = [];
  const onRequest = (req) => {
    const url = req.url();
    if (isHomigoApi(url)) apiCalls.push({ path: new URL(url).pathname, at: Date.now() });
    if (url.includes("_rsc=") || req.resourceType() === "fetch" && url.includes("?")) {
      try {
        const u = new URL(url);
        if (u.searchParams.has("_rsc") || u.pathname.match(/^\/(command-center|digital-twin|operations|heatmap)/)) {
          rscRequests.push({ path: u.pathname, rsc: u.searchParams.has("_rsc") });
        }
      } catch {
        /* ignore */
      }
    }
  };
  page.on("request", onRequest);

  await page.goto(`${BASE}${pivotHref}`, { waitUntil: "domcontentloaded" });
  await page.locator("aside.biz-sidebar nav").waitFor({ timeout: 30_000 });
  await page.waitForTimeout(300);

  const currentPath = await page.evaluate(() => location.pathname);
  if (currentPath === route.href || (route.href !== "/" && currentPath.startsWith(route.href))) {
    return { err: "already-on-route", href: route.href };
  }

  const snapBefore = await page.evaluate(() => ({
    pathname: location.pathname,
    mounts: { ...(window.__HOMIGO_MOUNT_COUNTS__ ?? {}) },
    renders: { ...(window.__HOMIGO_RENDER_IDLE__ ?? {}) },
    effects: { ...(window.__HOMIGO_EFFECT_COUNTS__ ?? {}) },
    navMetrics: window.__HOMIGO_NAV_METRICS__ ? [...window.__HOMIGO_NAV_METRICS__] : [],
  }));

  apiCalls.length = 0;
  rscRequests.length = 0;

  const link = page.locator(`aside.biz-sidebar nav a[href="${route.href}"]`).first();
  const hasLink = await link.count();
  if (!hasLink) return { err: "no-link", href: route.href };

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

  await page.waitForFunction(
    (readyText) => {
      const main = document.querySelector("main");
      const textHit = readyText
        ? document.body.innerText.toLowerCase().includes(readyText.toLowerCase())
        : true;
      return !!(main && main.offsetHeight > 80 && textHit);
    },
    route.ready,
    { timeout: 8_000 },
  ).catch(() => undefined);
  const tContent = await page.evaluate(() => performance.now());

  const longTasks = await page.evaluate(() => {
    return new Promise((resolve) => {
      let count = 0;
      try {
        const obs = new PerformanceObserver((list) => {
          count += list.getEntries().length;
        });
        obs.observe({ type: "longtask", buffered: true });
        setTimeout(() => {
          obs.disconnect();
          resolve(count);
        }, 50);
      } catch {
        resolve(0);
      }
    });
  });

  const timing = {
    commit: Math.round(tCommit - t0),
    paint: Math.round(tPaint - t0),
    content: Math.round(tContent - t0),
    longTasks,
  };

  await page.waitForTimeout(100);

  const snapAfter = await page.evaluate(() => ({
    mounts: { ...(window.__HOMIGO_MOUNT_COUNTS__ ?? {}) },
    renders: { ...(window.__HOMIGO_RENDER_IDLE__ ?? {}) },
    effects: { ...(window.__HOMIGO_EFFECT_COUNTS__ ?? {}) },
    navMetrics: window.__HOMIGO_NAV_METRICS__ ? [...window.__HOMIGO_NAV_METRICS__] : [],
  }));

  page.off("request", onRequest);

  const mountDelta = {};
  for (const [k, v] of Object.entries(snapAfter.mounts)) {
    mountDelta[k] = v - (snapBefore.mounts[k] ?? 0);
  }
  const renderDelta = {};
  for (const [k, v] of Object.entries(snapAfter.renders)) {
    renderDelta[k] = v - (snapBefore.renders[k] ?? 0);
  }
  const effectDelta = {};
  for (const [k, v] of Object.entries(snapAfter.effects)) {
    effectDelta[k] = v - (snapBefore.effects[k] ?? 0);
  }

  const byPath = new Map();
  for (const { path } of apiCalls) byPath.set(path, (byPath.get(path) ?? 0) + 1);
  const duplicates = Object.fromEntries([...byPath.entries()].filter(([, n]) => n > 1));

  const layoutRemounts = {
    AdminShell: mountDelta.AdminShell ?? 0,
    AdminSidebar: mountDelta.AdminSidebar ?? 0,
    AdminTopBar: mountDelta.AdminTopBar ?? 0,
  };
  const layoutRemounted = Object.values(layoutRemounts).some((n) => n > 0);

  const newNavEvents = snapAfter.navMetrics.slice(snapBefore.navMetrics.length);

  return {
    route: route.href,
    label: route.label,
    ...timing,
    api_calls: apiCalls.length,
    duplicate_api: duplicates,
    rsc_prefetch_hits: rscRequests.filter((r) => r.rsc).length,
    layout_remounts: layoutRemounts,
    layout_remounted: layoutRemounted,
    render_delta: renderDelta,
    effect_delta: effectDelta,
    nav_events: newNavEvents,
    over_300ms: timing.content > TARGET_MS,
  };
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  page.setDefaultNavigationTimeout(120_000);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Performance.enable");

  await login(page);
  await warmRoutes(page);

  const results = [];
  const pivotHref = "/settings";

  for (const route of ROUTES) {
    const samples = [];
    for (let i = 0; i < SAMPLES; i++) {
      const m = await measureTransition(page, cdp, pivotHref, route);
      if (m.err) console.warn(`[nav-probe] ${route.href} sample ${i + 1}: ${m.err}`);
      if (!m.err) samples.push(m);
      await page.waitForTimeout(80);
    }

    const content = samples.map((s) => s.content).filter(Number.isFinite);
    const commit = samples.map((s) => s.commit).filter(Number.isFinite);
    const paint = samples.map((s) => s.paint).filter(Number.isFinite);

    const last = samples[samples.length - 1] ?? {};
    results.push({
      route: route.href,
      label: route.label,
      samples: samples.length,
      commit_p50: pct(commit, 50),
      paint_p50: pct(paint, 50),
      content_p50: pct(content, 50),
      content_p95: pct(content, 95),
      content_max: content.length ? Math.max(...content) : null,
      over_300ms: (pct(content, 50) ?? 0) > TARGET_MS,
      layout_remounted: samples.some((s) => s.layout_remounted),
      layout_remounts: last.layout_remounts,
      api_calls_avg: samples.length
        ? Math.round(samples.reduce((s, x) => s + (x.api_calls ?? 0), 0) / samples.length)
        : 0,
      duplicate_api: last.duplicate_api ?? {},
      render_delta: last.render_delta ?? {},
      effect_delta: last.effect_delta ?? {},
      long_tasks: samples.map((s) => s.longTasks ?? 0),
      nav_events: last.nav_events ?? [],
    });
  }

  results.sort((a, b) => (b.content_p50 ?? 0) - (a.content_p50 ?? 0));

  const summary = {
    generatedAt: new Date().toISOString(),
    base: BASE,
    samples: SAMPLES,
    target_ms: TARGET_MS,
    routes_tested: results.length,
    routes_over_300ms: results.filter((r) => r.over_300ms).map((r) => r.route),
    slowest_routes: results.slice(0, 5).map((r) => ({
      route: r.route,
      content_p50: r.content_p50,
      content_p95: r.content_p95,
    })),
    layout_remount_routes: results.filter((r) => r.layout_remounted).map((r) => r.route),
    routes: results,
  };

  const tag = process.env.NAV_PROBE_TAG ?? "before";
  const outPath = join(OUT_DIR, `nav-transition-${tag}.json`);
  writeFileSync(outPath, JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  console.log(`\nWrote ${outPath}`);
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
