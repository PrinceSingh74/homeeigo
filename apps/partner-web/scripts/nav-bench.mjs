/**
 * Measures what a nav click actually costs in the partner app, in a real browser.
 *
 *   node scripts/nav-bench.mjs                                # against dev  (:3002)
 *   WEB_URL=http://localhost:3012 node scripts/nav-bench.mjs  # against a prod build
 *
 * Kept in the repo because "navigation feels slow" is unfalsifiable without it. Dev and production
 * differ by an order of magnitude here, so any performance claim about this app should say which one
 * it was measured against.
 *
 * Read-only: it signs in as the existing demo partner and navigates. It writes nothing.
 */
import { chromium } from "playwright";

const WEB = process.env.WEB_URL ?? "http://localhost:3002";
const API = process.env.API_URL ?? "http://localhost:3000";
const SETTLE_MS = Number(process.env.SETTLE_MS ?? 2500);
/**
 * The links actually reachable from the shell at desktop width, probed from the rendered DOM rather
 * than taken from `partner-navigation.ts` — that file lists 48 entries, but most live inside
 * collapsed HQ sections and are not what someone clicks between. Measuring links a person cannot
 * see would measure the wrong thing.
 */
const ROUTES = (
  process.env.ROUTES ?? "/,/requests,/wallet,/profile,/ai,/performance-hq/scorecard"
).split(",");

const login = await fetch(`${API}/api/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    email: "partner@homigo.demo",
    password: "Homigo@123",
    setAuthCookies: false,
  }),
});
const session = (await login.json()).data;
if (!session?.accessToken) throw new Error("login failed");

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(
  ([user, accessToken, refreshToken]) => {
    localStorage.setItem(
      "homigo-partner-store",
      JSON.stringify({
        state: { user, accessToken, refreshToken, status: "authenticated" },
        version: 0,
      }),
    );
    // Long tasks are what make a transition feel janky rather than merely slow.
    window.__longTasks = [];
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) window.__longTasks.push(Math.round(e.duration));
    }).observe({ entryTypes: ["longtask"] });
  },
  [session.user, session.accessToken, session.refreshToken],
);

const page = await ctx.newPage();

let net = [];
page.on("response", (res) => {
  const req = res.request();
  net.push({ url: req.url().replace(WEB, "").replace(API, "«api»"), type: req.resourceType() });
});

await page.goto(`${WEB}/`, { waitUntil: "load", timeout: 120_000 });
await page.waitForTimeout(3000);

async function navigate(href, label) {
  net = [];
  await page.evaluate(() => {
    window.__longTasks = [];
  });
  /**
   * A VISIBLE link, not merely a present one.
   *
   * The shell renders both a desktop sidebar and a mobile bottom bar, and the hidden one is still in
   * the DOM — clicking it hangs for thirty seconds and then throws. `:visible` picks whichever nav
   * the current viewport is actually showing, which is also the one a person would click.
   */
  const link = page.locator(`a[href="${href}"]:visible`).first();
  if ((await link.count()) === 0) {
    console.log(`${label} ${href.padEnd(12)} — no visible link at this viewport, skipped`);
    return;
  }

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
    `${label} ${href.padEnd(12)} commit ${String(commit).padStart(5)}ms │ ` +
      `main-thread blocked ${String(blocked).padStart(5)}ms (${String(longTasks.length).padStart(2)} long tasks) │ ` +
      `${String(script.length).padStart(2)} js · ${String(api.length).padStart(2)} api`,
  );
}

console.log(`── ${WEB} · first visit ──`);
for (const r of ROUTES) await navigate(r, "cold");
console.log(`\n── ${WEB} · revisit ──`);
for (const r of ROUTES) await navigate(r, "warm");

await browser.close();
