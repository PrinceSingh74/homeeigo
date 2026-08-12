// Real click-through soft-navigation probe — measures TRUE click-to-visible time for the
// customer bottom-nav, the way a user experiences it (clicks a <Link>, waits for the route
// to commit + first paint). Logs in via the real UI so authed routes work. Runs each
// transition COLD (first visit, may include dev compile) then WARM (cached) to isolate the
// on-demand-compile cost from steady-state runtime. Runtime evidence, no assumptions.
const { chromium } = require("playwright");

const BASE = process.env.PROBE_BASE || "http://localhost:3001";
const EMAIL = "customer@homigo.demo";
const PASS = "Homigo@123";
const SEQ = ["/services", "/bookings", "/wallet", "/profile", "/"];

async function softNav(page, href) {
  const start = await page.evaluate(() => performance.now());
  await page.click(`a[href="${href}"]`, { timeout: 20000 }).catch(async () => {
    // fallback: some links wrap an icon; click first matching anchor via DOM
    await page.evaluate((h) => document.querySelector(`a[href="${h}"]`)?.click(), href);
  });
  await page.waitForFunction((h) => location.pathname === h, href, { timeout: 90000 });
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const end = await page.evaluate(() => performance.now());
  return Math.round(end - start);
}

(async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const page = await ctx.newPage();

  // --- login via real UI ---
  await page.goto(BASE + "/login", { waitUntil: "load", timeout: 120000 });
  await page.fill('input[type="email"], input[name="email"]', EMAIL).catch(() => {});
  await page.fill('input[type="password"], input[name="password"]', PASS).catch(() => {});
  await page.click('button[type="submit"]').catch(() => {});
  await page.waitForFunction(() => location.pathname !== "/login", { timeout: 120000 }).catch(() => {});
  const loggedIn = await page.evaluate(() => location.pathname);
  console.log("after-login path:", loggedIn);

  // ensure we start from home
  await page.goto(BASE + "/", { waitUntil: "load", timeout: 120000 });

  const cold = {}, warm = {};
  // COLD pass (first visit each — dev may compile)
  for (const href of SEQ) {
    try { cold[href] = await softNav(page, href); } catch (e) { cold[href] = "err:" + String(e).slice(0, 40); }
  }
  // back home, then WARM pass (everything already compiled/cached)
  await page.goto(BASE + "/", { waitUntil: "load" });
  for (const href of SEQ) {
    try { warm[href] = await softNav(page, href); } catch (e) { warm[href] = "err"; }
  }

  console.log(JSON.stringify({ cold, warm }, null, 2));
  await browser.close();
})();
