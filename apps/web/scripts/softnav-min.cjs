// Tight soft-nav sampler: login once, warm all routes, then sample each transition N times
// rapidly and report MIN + MEDIAN per route. MIN ≈ true render cost (least machine contention)
// on this noisy OneDrive box. Runtime evidence for the navigation certification.
const { chromium } = require("playwright");
const BASE = process.env.PROBE_BASE || "http://localhost:3100";
const N = Number(process.env.SAMPLES || 8);
const ROUTES = ["/services", "/bookings", "/wallet", "/profile", "/membership", "/"];

const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

async function nav(page, href) {
  const t0 = await page.evaluate(() => performance.now());
  await page.evaluate((h) => document.querySelector(`a[href="${h}"]`)?.click(), href);
  await page.waitForFunction((h) => location.pathname === h, href, { timeout: 30000 });
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  return Math.round((await page.evaluate(() => performance.now())) - t0);
}

(async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1366, height: 900 } })).newPage();
  await page.goto(BASE + "/login", { waitUntil: "load", timeout: 120000 });
  await page.fill('input[type="email"], input[name="email"]', "customer@homigo.demo").catch(() => {});
  await page.fill('input[type="password"], input[name="password"]', "Homigo@123").catch(() => {});
  await page.click('button[type="submit"]').catch(() => {});
  await page.waitForFunction(() => location.pathname !== "/login", { timeout: 120000 }).catch(() => {});

  // warm every route (compile/cache) before sampling
  for (const r of ROUTES) { await page.goto(BASE + r, { waitUntil: "load" }).catch(() => {}); }

  const out = {};
  for (const href of ROUTES) {
    const samples = [];
    for (let i = 0; i < N; i++) {
      await page.goto(BASE + "/ai", { waitUntil: "load" }).catch(() => {}); // neutral start each time
      try { samples.push(await nav(page, href)); } catch {}
    }
    out[href] = samples.length ? { min: Math.min(...samples), median: med(samples), n: samples.length } : { err: true };
  }
  console.log(JSON.stringify(out, null, 2));
  await browser.close();
})();
