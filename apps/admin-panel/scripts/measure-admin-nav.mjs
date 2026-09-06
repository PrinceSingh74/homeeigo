/**
 * Admin HQ navigation forensic probe.
 * Measures click → route commit → heading visible → first API completion.
 * Usage (from apps/admin-panel):
 *   $env:E2E_SKIP_SERVERS=1; node scripts/measure-admin-nav.mjs
 */
import { chromium } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = (process.env.E2E_ADMIN_URL ?? "http://127.0.0.1:3003").replace(/\/$/, "");
const EMAIL = "admin@homigo.demo";
const PASSWORD = "Homigo@123";
const OUT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  process.env.NAV_PERF_OUT ?? "nav-perf-after.json",
);

const ALL_ROUTES = [
  { href: "/", heading: /Executive HQ/i, label: "Executive HQ" },
  { href: "/settings", heading: /Settings/i, label: "Settings" },
  { href: "/bookings", heading: /Bookings/i, label: "Bookings (table)" },
  { href: "/vendors", heading: /Partner Network/i, label: "Partners (table)" },
  { href: "/customers", heading: /Customer Ledger/i, label: "Customers (table)" },
  { href: "/command-center", heading: /Command Center/i, label: "Command Center (live ops)" },
  { href: "/finance/dashboard", heading: /CFO Dashboard/i, label: "Finance dashboard" },
  { href: "/hq/operations", heading: /Operations HQ/i, label: "HQ landing (nested)" },
  { href: "/partner-acquisition/leads", heading: /Lead CRM/i, label: "Leads" },
  { href: "/analytics", heading: /Analytics/i, label: "Analytics" },
  { href: "/earnings", heading: /Earnings/i, label: "Earnings (finance hub)" },
  { href: "/incentives", heading: /Incentive/i, label: "Incentives" },
];
const ROUTES = process.env.NAV_PERF_QUICK
  ? ALL_ROUTES.filter((r) =>
      ["/", "/settings", "/bookings", "/vendors", "/command-center", "/finance/dashboard", "/hq/operations", "/partner-acquisition/leads"].includes(
        r.href,
      ),
    )
  : ALL_ROUTES;

function apiPath(url) {
  try {
    const u = new URL(url);
    return u.pathname + u.search;
  } catch {
    return url;
  }
}

async function login(page) {
  const api = (process.env.E2E_API_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");
  const res = await fetch(`${api}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD, setAuthCookies: false }),
  });
  const json = await res.json();
  const refreshToken = json?.data?.refreshToken;
  const user = json?.data?.user ?? { email: EMAIL, role: "ADMIN", firstName: "Admin", lastName: "" };
  if (!res.ok || !refreshToken) {
    throw new Error(`API login failed ${res.status}: ${JSON.stringify(json).slice(0, 240)}`);
  }

  await page.addInitScript(
    ({ user, refreshToken }) => {
      localStorage.setItem(
        "homigo-admin-store",
        JSON.stringify({ state: { user, refreshToken }, version: 0 }),
      );
    },
    { user, refreshToken },
  );

  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.getByRole("heading", { name: /Executive HQ|business overview/i }).waitFor({
    timeout: 90_000,
  });
}

async function measureNav(page, fromHref, route) {
  const apis = [];
  const onResponse = (res) => {
    const url = res.url();
    if (!url.includes("/api/")) return;
    const req = res.request();
    const timing = req.timing();
    apis.push({
      method: req.method(),
      path: apiPath(url),
      status: res.status(),
      start: timing.startTime,
      duration: Math.round(timing.responseEnd || 0),
    });
  };
  page.on("response", onResponse);

  const clickTs = Date.now();
  const clickPerf = await page.evaluate(() => performance.now());

  await page.evaluate(() => {
    document.querySelectorAll('aside button[aria-expanded="false"]').forEach((btn) => {
      btn.click();
    });
  });
  await page.waitForTimeout(150);

  const currentPath = new URL(page.url()).pathname;
  if (currentPath === route.href) {
    const bounce = route.href === "/" ? "/settings" : "/";
    const bounced = await page.evaluate((href) => {
      const a = document.querySelector(`aside a[href="${href}"]`);
      if (a) {
        a.click();
        return true;
      }
      return false;
    }, bounce);
    if (!bounced) {
      await page.goto(`${BASE}${bounce}`, { waitUntil: "domcontentloaded" });
    }
    await page.waitForTimeout(300);
  }

  const link = page.locator(`aside a[href="${route.href}"]`).first();
  const hasLink = (await link.count()) > 0;
  if (hasLink) {
    await link.click({ force: true });
  } else {
    await page.evaluate((href) => {
      const a = document.querySelector(`a[href="${href}"]`);
      if (a) a.click();
      else window.history.pushState({}, "", href);
    }, route.href);
    if (!(await link.count())) {
      await page.goto(`${BASE}${route.href}`, { waitUntil: "domcontentloaded" });
    }
  }

  const heading = page.getByRole("heading", { name: route.heading }).first();
  let headingMs = null;
  let headingErr = null;
  try {
    await heading.waitFor({ state: "visible", timeout: 20_000 });
    headingMs = Date.now() - clickTs;
  } catch (e) {
    headingErr = String(e.message ?? e).slice(0, 180);
  }

  const pathMs = await page.evaluate(
    ({ href, start }) => {
      const deadline = performance.now() + 8000;
      return new Promise((resolve) => {
        const check = () => {
          if (window.location.pathname === href || performance.now() > deadline) {
            resolve({
              path: window.location.pathname,
              commitMs: Math.round(performance.now() - start),
              nav: window.__HOMIGO_NAV_LAST__ ?? null,
            });
            return;
          }
          requestAnimationFrame(check);
        };
        check();
      });
    },
    { href: route.href, start: clickPerf },
  );

  await page.waitForTimeout(400);
  page.off("response", onResponse);

  const pathCounts = {};
  for (const a of apis) {
    pathCounts[a.path] = (pathCounts[a.path] ?? 0) + 1;
  }
  const dupes = Object.entries(pathCounts)
    .filter(([, n]) => n > 1)
    .map(([path, n]) => ({ path, n }));

  return {
    route: route.label,
    href: route.href,
    from: fromHref,
    headingMs,
    headingErr,
    path: pathMs.path,
    commitMs: pathMs.commitMs,
    navTracker: pathMs.nav,
    apiCount: apis.length,
    apiMs: apis.length ? Math.max(...apis.map((a) => a.duration || 0)) : 0,
    slowestApi: apis
      .slice()
      .sort((a, b) => (b.duration || 0) - (a.duration || 0))
      .slice(0, 5),
    dupes,
  };
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  page.setDefaultTimeout(45_000);

  console.log(`Logging in at ${BASE}…`);
  await login(page);
  // Let idle prefetch / first dashboard settle so "cold" is route-compile, not auth.
  await page.waitForTimeout(2500);

  const results = { at: new Date().toISOString(), base: BASE, cold: [], warm: [], repeat: [] };
  let from = "/";

  console.log("\n=== COLD (first visit this session) ===");
  for (const route of ROUTES) {
    const row = await measureNav(page, from, route);
    results.cold.push(row);
    from = route.href;
    console.log(
      `${route.label.padEnd(28)} heading=${String(row.headingMs).padStart(5)}ms  commit=${String(row.commitMs).padStart(5)}ms  apis=${String(row.apiCount).padStart(2)}  dupes=${row.dupes.length}`,
    );
  }

  console.log("\n=== WARM (second visit) ===");
  for (const route of ROUTES) {
    const row = await measureNav(page, from, route);
    results.warm.push(row);
    from = route.href;
    console.log(
      `${route.label.padEnd(28)} heading=${String(row.headingMs).padStart(5)}ms  commit=${String(row.commitMs).padStart(5)}ms  apis=${String(row.apiCount).padStart(2)}  dupes=${row.dupes.length}`,
    );
  }

  console.log("\n=== REPEAT (third visit) ===");
  const repeatSet = ROUTES.filter((r) =>
    ["/", "/bookings", "/vendors", "/command-center", "/settings", "/finance/dashboard"].includes(r.href),
  );
  for (const route of repeatSet) {
    const row = await measureNav(page, from, route);
    results.repeat.push(row);
    from = route.href;
    console.log(
      `${route.label.padEnd(28)} heading=${String(row.headingMs).padStart(5)}ms  commit=${String(row.commitMs).padStart(5)}ms  apis=${String(row.apiCount).padStart(2)}  dupes=${row.dupes.length}`,
    );
  }

  writeFileSync(OUT, JSON.stringify(results, null, 2));
  console.log(`\nWrote ${OUT}`);
  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
