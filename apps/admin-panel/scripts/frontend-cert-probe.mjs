/**
 * Final frontend certification probe — perf + navigation latency.
 *
 *   node scripts/frontend-cert-probe.mjs
 */
import { chromium } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ADMIN = { email: "admin@homigo.demo", password: "Homigo@123" };
const BASE = process.env.E2E_ADMIN_URL ?? "http://localhost:3003";
const WINDOW_MS = Number(process.env.PROBE_WINDOW_MS ?? 65_000);
const WARMUP_MS = Number(process.env.PROBE_WARMUP_MS ?? 25_000);

const PAGES = ["dashboard", "bookings", "support"];

function isHomigoApi(url) {
  try {
    const u = new URL(url);
    return (
      u.pathname.startsWith("/api/admin") ||
      u.pathname.startsWith("/api/geo-intel") ||
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

async function measurePage(page, cdp, wsFrameCounts, target) {
  const routes = {
    dashboard: { path: "/", ready: "Business overview" },
    bookings: { path: "/bookings", ready: "Bookings" },
    support: { path: "/support", ready: "Support Operations" },
  };
  const route = routes[target];

  const apiCalls = [];
  const onReq = (req) => {
    if (isHomigoApi(req.url())) apiCalls.push(req.url());
  };
  page.on("request", onReq);

  if (route.path !== "/") {
    await page.goto(`${BASE}${route.path}`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(`text=${route.ready}`, { timeout: 120_000 }).catch(() => undefined);
  }
  await page.waitForTimeout(WARMUP_MS);

  apiCalls.length = 0;
  const wsStart = { ...wsFrameCounts };
  const renderBefore = await page.evaluate(() => window.__HOMIGO_RENDER_IDLE__ ?? {});
  const t0 = Date.now();
  await page.waitForTimeout(WINDOW_MS);
  const windowMs = Date.now() - t0;
  const renderAfter = await page.evaluate(() => window.__HOMIGO_RENDER_IDLE__ ?? {});

  page.off("request", onReq);

  const byPath = new Map();
  for (const url of apiCalls) {
    const p = new URL(url).pathname;
    byPath.set(p, (byPath.get(p) ?? 0) + 1);
  }

  const renderDelta = {};
  for (const [k, v] of Object.entries(renderAfter)) {
    renderDelta[k] = v - (renderBefore[k] ?? 0);
  }
  const totalRenders = Object.values(renderDelta).reduce((s, n) => s + n, 0);

  const appWsFrames = (wsFrameCounts.notifications ?? 0) - (wsStart.notifications ?? 0);
  const hmrWsFrames = (wsFrameCounts.hmr ?? 0) - (wsStart.hmr ?? 0);

  return {
    page: target,
    windowMs,
    api_calls_total: apiCalls.length,
    api_calls_per_min: Math.round((apiCalls.length / windowMs) * 60_000 * 10) / 10,
    api_calls_by_path: Object.fromEntries([...byPath.entries()]),
    duplicate_api_paths: Object.fromEntries([...byPath.entries()].filter(([, n]) => n > 1)),
    websocket_app_frames_total: appWsFrames,
    websocket_app_frames_per_min: Math.round((appWsFrames / windowMs) * 60_000 * 10) / 10,
    websocket_hmr_frames_total: hmrWsFrames,
    react_render_total_idle: totalRenders,
    react_render_counts_idle_window: renderDelta,
  };
}

async function measureNavigation(page) {
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("text=Business overview", { timeout: 120_000 });

  const navTargets = [
    { label: "Bookings", href: "/bookings", ready: "Bookings" },
    { label: "Support", href: "/support", ready: "Support Operations" },
    { label: "Overview", href: "/", ready: "Business overview" },
  ];

  const results = [];
  for (const nav of navTargets) {
    const clickStart = Date.now();
    await page.locator(`a[href="${nav.href}"]`).first().click();
    await page.waitForSelector(`text=${nav.ready}`, { timeout: 120_000 });
    const ms = Date.now() - clickStart;
    results.push({ nav: nav.label, href: nav.href, route_transition_ms: ms });
    await page.waitForTimeout(1500);
  }

  return results;
}

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.setDefaultNavigationTimeout(120_000);
  page.setDefaultTimeout(120_000);

  const wsFrameCounts = { notifications: 0, hmr: 0, other: 0 };
  const wsFrameTypes = { PING: 0, PONG: 0, other: 0 };

  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.enable");
  cdp.on("Network.webSocketFrameReceived", (e) => {
    const url = String(e.response?.url ?? e.url ?? "");
    if (url.includes("webpack-hmr")) wsFrameCounts.hmr += 1;
    else if (url.includes("/ws/notifications")) {
      wsFrameCounts.notifications += 1;
      try {
        const payload = Buffer.from(e.response?.payloadData ?? "", "base64").toString("utf8");
        const type = String(JSON.parse(payload).type ?? "").toUpperCase();
        if (type === "PING") wsFrameTypes.PING += 1;
        else if (type === "PONG") wsFrameTypes.PONG += 1;
        else wsFrameTypes.other += 1;
      } catch {
        wsFrameTypes.other += 1;
      }
    } else wsFrameCounts.other += 1;
  });

  await login(page);

  const pages = [];
  for (const p of PAGES) {
    pages.push(await measurePage(page, cdp, wsFrameCounts, p));
  }

  const navigation = await measureNavigation(page);

  await browser.close();

  const report = {
    audited_at: new Date().toISOString(),
    probe_window_ms: WINDOW_MS,
    probe_warmup_ms: WARMUP_MS,
    websocket_frame_types_during_session: wsFrameTypes,
    pages,
    navigation,
  };

  const json = JSON.stringify(report, null, 2);
  console.log(json);
  const out = join(dirname(fileURLToPath(import.meta.url)), "frontend-cert-evidence.json");
  writeFileSync(out, json);
  console.error(`Wrote ${out}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
