/**
 * Customer web bottom-nav navigation transition profiler.
 *
 *   node scripts/nav-transition-probe.cjs
 */
const { chromium } = require("playwright");
const { writeFileSync, mkdirSync } = require("node:fs");
const { join } = require("node:path");

const BASE = process.env.PROBE_BASE || "http://localhost:3001";
const OUT_DIR = join(__dirname, "..", "..", "..", "homigo-mobile", ".certification-evidence");
const SAMPLES = Number(process.env.SAMPLES || 5);
const TARGET_MS = 300;
const ROUTES = [
  { href: "/services", ready: "Services" },
  { href: "/bookings", ready: "Bookings" },
  { href: "/wallet", ready: "Wallet" },
  { href: "/profile", ready: "Profile" },
  { href: "/", ready: "HOMIGO" },
];

const pct = (arr, p) => {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};

async function login(page) {
  await page.goto(`${BASE}/login`, { waitUntil: "load", timeout: 120000 });
  await page.fill('input[type="email"], input[name="email"]', "customer@homigo.demo").catch(() => {});
  await page.fill('input[type="password"], input[name="password"]', "Homigo@123").catch(() => {});
  await page.click('button[type="submit"]').catch(() => {});
  await page.waitForFunction(() => location.pathname !== "/login", { timeout: 120000 }).catch(() => {});
}

async function warm(page) {
  for (const { href } of ROUTES) {
    await page.goto(`${BASE}${href}`, { waitUntil: "load", timeout: 120000 }).catch(() => {});
  }
  await page.goto(`${BASE}/`, { waitUntil: "load" });
}

async function measureNav(page, route) {
  const apiCalls = [];
  const onReq = (req) => {
    const u = req.url();
    if (u.includes("/api/")) apiCalls.push(new URL(u).pathname);
  };
  page.on("request", onReq);

  await page.goto(`${BASE}/`, { waitUntil: "load" });
  await page.waitForTimeout(120);

  apiCalls.length = 0;
  const snapBefore = await page.evaluate(() => ({
    mounts: { ...(window.__HOMIGO_MOUNT_COUNTS__ ?? {}) },
    renders: { ...(window.__HOMIGO_RENDER_IDLE__ ?? {}) },
  }));

  const timing = await page.evaluate(async ({ href, ready }) => {
    const t0 = performance.now();
    const a = document.querySelector(`a[href="${href}"]`);
    if (!a) return { err: "no-link" };
    a.click();
    await new Promise((res) => {
      const id = setInterval(() => {
        if (location.pathname === href) {
          clearInterval(id);
          res();
        }
      }, 4);
      setTimeout(res, 20000);
    });
    const tCommit = performance.now();
    await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
    const tPaint = performance.now();
    await new Promise((res) => {
      const id = setInterval(() => {
        const m = document.querySelector("main");
        if (m && m.offsetHeight > 200 && document.body.innerText.includes(ready)) {
          clearInterval(id);
          res();
        }
      }, 8);
      setTimeout(res, 20000);
    });
    const tContent = performance.now();
    return {
      commit: Math.round(tCommit - t0),
      paint: Math.round(tPaint - t0),
      content: Math.round(tContent - t0),
    };
  }, route);

  const snapAfter = await page.evaluate(() => ({
    mounts: { ...(window.__HOMIGO_MOUNT_COUNTS__ ?? {}) },
    renders: { ...(window.__HOMIGO_RENDER_IDLE__ ?? {}) },
  }));
  page.off("request", onReq);

  const byPath = new Map();
  for (const p of apiCalls) byPath.set(p, (byPath.get(p) ?? 0) + 1);
  const duplicates = Object.fromEntries([...byPath.entries()].filter(([, n]) => n > 1));

  const mountDelta = {};
  for (const [k, v] of Object.entries(snapAfter.mounts)) {
    mountDelta[k] = v - (snapBefore.mounts[k] ?? 0);
  }
  const renderDelta = {};
  for (const [k, v] of Object.entries(snapAfter.renders)) {
    renderDelta[k] = v - (snapBefore.renders[k] ?? 0);
  }

  return { ...timing, api_calls: apiCalls.length, duplicate_api: duplicates, mount_delta: mountDelta, render_delta: renderDelta };
}

(async () => {
  mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1366, height: 900 } })).newPage();

  await login(page);
  await warm(page);

  const results = [];
  for (const route of ROUTES) {
    const samples = [];
    for (let i = 0; i < SAMPLES; i++) {
      const s = await measureNav(page, route);
      if (!s.err) samples.push(s);
    }
    const content = samples.map((s) => s.content);
    const last = samples[samples.length - 1] ?? {};
    results.push({
      route: route.href,
      samples: samples.length,
      commit_p50: pct(samples.map((s) => s.commit), 50),
      paint_p50: pct(samples.map((s) => s.paint), 50),
      content_p50: pct(content, 50),
      content_p95: pct(content, 95),
      over_300ms: (pct(content, 50) ?? 0) > TARGET_MS,
      api_calls_avg: samples.length ? Math.round(samples.reduce((n, s) => n + s.api_calls, 0) / samples.length) : 0,
      duplicate_api: last.duplicate_api ?? {},
      layout_remounts: last.mount_delta ?? {},
      render_delta: last.render_delta ?? {},
    });
  }

  results.sort((a, b) => (b.content_p50 ?? 0) - (a.content_p50 ?? 0));
  const tag = process.env.NAV_PROBE_TAG || "web-after";
  const out = {
    generatedAt: new Date().toISOString(),
    app: "customer-web",
    base: BASE,
    target_ms: TARGET_MS,
    slowest_routes: results.slice(0, 3),
    routes_over_300ms: results.filter((r) => r.over_300ms).map((r) => r.route),
    routes: results,
  };
  const outPath = join(OUT_DIR, `nav-transition-${tag}.json`);
  writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
  await browser.close();
})();
