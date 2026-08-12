/**
 * Multi-page frontend performance audit — runtime evidence collector.
 *
 *   node scripts/frontend-audit-probe.mjs
 */
import { chromium } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ADMIN = { email: "admin@homigo.demo", password: "Homigo@123" };
const BASE = process.env.E2E_ADMIN_URL ?? "http://localhost:3003";
const WINDOW_MS = Number(process.env.PROBE_WINDOW_MS ?? 65_000);
const WARMUP_MS = Number(process.env.PROBE_WARMUP_MS ?? 30_000);

const PAGES = [
  { id: "dashboard", path: "/", ready: "Business overview" },
  { id: "command-center", path: "/command-center", ready: "Layers" },
  { id: "bookings", path: "/bookings", ready: "Bookings" },
  { id: "support", path: "/support", ready: "Support Operations" },
];

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

function delta(before, after) {
  const out = {};
  for (const [k, v] of Object.entries(after ?? {})) {
    out[k] = v - (before?.[k] ?? 0);
  }
  return out;
}

function duplicatePaths(apiCalls) {
  const byPath = new Map();
  for (const url of apiCalls) {
    const path = new URL(url).pathname;
    byPath.set(path, (byPath.get(path) ?? 0) + 1);
  }
  return Object.fromEntries(
    [...byPath.entries()].filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1]),
  );
}

async function login(page) {
  await page.goto(`${BASE}/login`);
  await page.locator("#admin-email").fill(ADMIN.email);
  await page.locator("#admin-password").fill(ADMIN.password);
  await page.getByRole("button", { name: /enter business hq/i }).click();
  await page.waitForSelector("text=Business overview", { timeout: 120_000 });
}

async function measurePage(page, cdp, wsUrls, { id, path, ready }) {
  const apiCalls = [];
  const onRequest = (req) => {
    if (isHomigoApi(req.url())) apiCalls.push({ url: req.url(), at: Date.now() });
  };
  page.on("request", onRequest);

  await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(`text=${ready}`, { timeout: 120_000 }).catch(() => undefined);
  await page.waitForTimeout(WARMUP_MS);

  const wsStart = wsUrls.length;
  let wsFrames = 0;
  const onWsFrame = () => {
    wsFrames += 1;
  };
  cdp.on("Network.webSocketFrameReceived", onWsFrame);

  const snapBefore = await page.evaluate(() => ({
    renders: { ...(window.__HOMIGO_RENDER_IDLE__ ?? {}) },
    mounts: { ...(window.__HOMIGO_MOUNT_COUNTS__ ?? {}) },
    dom: document.querySelectorAll("*").length,
  }));

  apiCalls.length = 0;
  const t0 = Date.now();
  await page.waitForTimeout(WINDOW_MS);
  const windowMs = Date.now() - t0;

  const snapAfter = await page.evaluate(() => ({
    renders: { ...(window.__HOMIGO_RENDER_IDLE__ ?? {}) },
    mounts: { ...(window.__HOMIGO_MOUNT_COUNTS__ ?? {}) },
    dom: document.querySelectorAll("*").length,
  }));

  page.off("request", onRequest);
  try {
    cdp.removeListener("Network.webSocketFrameReceived", onWsFrame);
  } catch {
    /* ignore */
  }

  const byPath = new Map();
  for (const { url } of apiCalls) {
    const p = new URL(url).pathname;
    byPath.set(p, (byPath.get(p) ?? 0) + 1);
  }

  const wsDuring = wsUrls.slice(wsStart).filter((u) => !u.includes("webpack-hmr"));
  const notifSockets = [...new Set(wsDuring.filter((u) => u.includes("/ws/notifications")))];

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

  const renderDelta = delta(snapBefore.renders, snapAfter.renders);
  const mountTotal = snapAfter.mounts;
  const totalRenders = Object.values(renderDelta).reduce((s, n) => s + n, 0);

  return {
    page: id,
    path,
    windowMs,
    warmupMs: WARMUP_MS,
    api_calls_total: apiCalls.length,
    api_calls_per_min: Math.round((apiCalls.length / windowMs) * 60_000 * 10) / 10,
    api_calls_by_path: Object.fromEntries([...byPath.entries()].sort((a, b) => b[1] - a[1])),
    duplicate_api_paths: duplicatePaths(apiCalls.map((c) => c.url)),
    websocket_frames_per_min: Math.round((wsFrames / windowMs) * 60_000 * 10) / 10,
    websocket_frames_total: wsFrames,
    websocket_notification_sockets_during_window: notifSockets.length,
    websocket_urls_during_window: wsDuring,
    render_counts_idle_window: renderDelta,
    render_total_idle_window: totalRenders,
    mount_counts_idle_delta: delta(snapBefore.mounts, snapAfter.mounts),
    mount_counts_cumulative: snapAfter.mounts,
    dom_nodes: snapAfter.dom,
    dom_delta: snapAfter.dom - snapBefore.dom,
    longtask_buffered: longTasks,
  };
}

async function measureBackendLatency() {
  const API = process.env.BACKEND_ORIGIN ?? "http://localhost:3000";
  const endpoints = [
    "/health",
    "/ready",
    "/api/admin/dashboard",
    "/api/admin/bookings",
    "/api/geo-intel/exec-kpis",
  ];
  const out = {};
  for (const ep of endpoints) {
    const t0 = performance.now();
    try {
      const res = await fetch(`${API}${ep}`, {
        headers: ep.startsWith("/api/admin") || ep.startsWith("/api/geo")
          ? undefined
          : undefined,
      });
      out[ep] = { status: res.status, ms: Math.round(performance.now() - t0) };
    } catch (e) {
      out[ep] = { error: String(e) };
    }
  }
  return out;
}

async function main() {
  const backend = await measureBackendLatency();

  const browser = await chromium.launch();
  const page = await browser.newPage();
  const wsUrls = [];
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.enable");
  cdp.on("Network.webSocketCreated", (e) => wsUrls.push(String(e.url)));

  page.setDefaultNavigationTimeout(120_000);
  page.setDefaultTimeout(120_000);

  await login(page);

  const wsAtLogin = [...new Set(wsUrls.filter((u) => u.includes("/ws/notifications")))];

  const pages = [];
  for (const p of PAGES) {
    pages.push(await measurePage(page, cdp, wsUrls, p));
  }

  await browser.close();

  const report = {
    audited_at: new Date().toISOString(),
    environment: {
      admin_url: BASE,
      probe_window_ms: WINDOW_MS,
      probe_warmup_ms: WARMUP_MS,
      react_strict_mode: true,
      next_dev: true,
    },
    backend_latency_ms: backend,
    websocket_at_login: {
      notification_socket_count: wsAtLogin.length,
      urls: wsAtLogin,
    },
    pages,
  };

  const json = JSON.stringify(report, null, 2);
  console.log(json);

  const outPath = join(dirname(fileURLToPath(import.meta.url)), "frontend-audit-evidence.json");
  writeFileSync(outPath, json);
  console.error(`Evidence written to ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
