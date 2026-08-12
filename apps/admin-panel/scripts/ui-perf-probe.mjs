/**
 * UI performance probe — API + WS + DOM metrics (runtime evidence).
 *
 *   node scripts/ui-perf-probe.mjs dashboard
 *   node scripts/ui-perf-probe.mjs command-center
 */
import { chromium } from "@playwright/test";

const ADMIN = { email: "admin@homigo.demo", password: "Homigo@123" };
const BASE = process.env.E2E_ADMIN_URL ?? "http://localhost:3003";
const WINDOW_MS = Number(process.env.PROBE_WINDOW_MS ?? 65_000);
const WARMUP_MS = Number(process.env.PROBE_WARMUP_MS ?? 0);
const ROUTES = {
  dashboard: { path: null, ready: "Business overview" },
  "command-center": { path: "/command-center", ready: "Layers" },
  "digital-twin": { path: "/digital-twin", ready: "City Digital Twin" },
  heatmap: { path: "/heatmap", ready: "Demand Heatmap" },
  observability: { path: "/observability", ready: "Observability Dashboard" },
  "ai-systems": { path: "/ai", ready: "AI systems" },
  bookings: { path: "/bookings", ready: "Bookings" },
  support: { path: "/support", ready: "Support Operations" },
  operations: { path: "/operations", ready: "Live Operations" },
};
const target = process.argv[2] ?? "dashboard";
const route = ROUTES[target] ?? ROUTES.dashboard;

async function login(page) {
  await page.goto(`${BASE}/login`);
  await page.locator("#admin-email").fill(ADMIN.email);
  await page.locator("#admin-password").fill(ADMIN.password);
  await page.getByRole("button", { name: /enter business hq/i }).click();
  await page.waitForSelector("text=Business overview", { timeout: 60_000 });
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

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.setDefaultNavigationTimeout(120_000);
  page.setDefaultTimeout(120_000);
  const apiCalls = [];
  const wsUrls = [];
  let wsFrames = 0;

  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.enable");
  cdp.on("Network.webSocketCreated", (e) => wsUrls.push(String(e.url)));
  cdp.on("Network.webSocketFrameReceived", () => {
    wsFrames += 1;
  });

  page.on("request", (req) => {
    if (isHomigoApi(req.url())) apiCalls.push(req.url());
  });

  await login(page);
  if (route.path) {
    await page.goto(`${BASE}${route.path}`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(`text=${route.ready}`, { timeout: 120_000 }).catch(() => undefined);
  }
  if (WARMUP_MS > 0) await page.waitForTimeout(WARMUP_MS);
  apiCalls.length = 0;
  wsFrames = 0;
  const wsStart = wsUrls.length;

  const renderCountsBefore = await page.evaluate(() => window.__HOMIGO_RENDER_IDLE__ ?? {});
  const mountCountsBefore = await page.evaluate(() => window.__HOMIGO_MOUNT_COUNTS__ ?? {});
  const domBefore = await page.evaluate(() => document.querySelectorAll("*").length);
  const t0 = Date.now();
  await page.waitForTimeout(WINDOW_MS);
  const windowMs = Date.now() - t0;

  const renderCountsAfter = await page.evaluate(() => window.__HOMIGO_RENDER_IDLE__ ?? {});
  const mountCountsAfter = await page.evaluate(() => window.__HOMIGO_MOUNT_COUNTS__ ?? {});

  const byPath = new Map();
  for (const url of apiCalls) {
    const path = new URL(url).pathname;
    byPath.set(path, (byPath.get(path) ?? 0) + 1);
  }

  const longTasks = await page.evaluate(() => {
    return new Promise((resolve) => {
      let count = 0;
      try {
        const obs = new PerformanceObserver((list) => {
          count += list.getEntries().length;
        });
        obs.observe({ type: "longtask", buffered: true });
        setTimeout(() => resolve(count), 100);
      } catch {
        resolve(-1);
      }
    });
  });

  const domAfter = await page.evaluate(() => document.querySelectorAll("*").length);
  const perMin = (apiCalls.length / windowMs) * 60_000;
  const wsDuringWindow = wsUrls.slice(wsStart).filter((u) => !u.includes("webpack-hmr"));
  const notificationSockets = [...new Set(wsDuringWindow.filter((u) => u.includes("/ws/notifications")))];

  const renderDelta = {};
  for (const [k, v] of Object.entries(renderCountsAfter)) {
    renderDelta[k] = v - (renderCountsBefore[k] ?? 0);
  }
  const mountDelta = {};
  for (const [k, v] of Object.entries(mountCountsAfter)) {
    mountDelta[k] = v - (mountCountsBefore[k] ?? 0);
  }
  const wsFramesPerMin = Math.round((wsFrames / windowMs) * 60_000 * 10) / 10;

  const duplicateApiPaths = Object.fromEntries(
    [...byPath.entries()].filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1]),
  );

  const report = {
    target,
    windowMs,
    warmupMs: WARMUP_MS,
    homigo_api_calls_total: apiCalls.length,
    homigo_api_calls_per_min: Math.round(perMin * 10) / 10,
    api_calls_by_path: Object.fromEntries([...byPath.entries()].sort((a, b) => b[1] - a[1])),
    duplicate_api_paths: duplicateApiPaths,
    websocket_urls_during_window: wsDuringWindow,
    websocket_notification_socket_count: notificationSockets.length,
    websocket_frames_received: wsFrames,
    websocket_frames_per_min: wsFramesPerMin,
    mount_counts_cumulative: mountCountsAfter,
    mount_counts_idle_window: mountDelta,
    react_render_counts_idle_window: renderDelta,
    dom_nodes_before: domBefore,
    dom_nodes_after: domAfter,
    longtask_buffered: longTasks,
  };

  console.log(JSON.stringify(report, null, 2));
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
