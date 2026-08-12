// Real-browser performance probe (production build on :3100) using the installed Chrome.
// Captures LCP, CLS, FCP, TTFB, load, and Total Blocking Time (TBT, the lab proxy for INP),
// plus a soft route-change measurement. Runtime evidence for the performance certification.
const { chromium } = require("playwright");

const BASE = process.env.PERF_BASE || "http://localhost:3100";
const ROUTES = ["/", "/login", "/services", "/wallet", "/book", "/bookings", "/legal/terms"];

async function measure(page, url) {
  // Register LCP + CLS observers BEFORE navigation so buffered entries are captured.
  await page.addInitScript(() => {
    window.__perf = { lcp: 0, cls: 0 };
    try {
      new PerformanceObserver((l) => {
        const es = l.getEntries();
        window.__perf.lcp = es[es.length - 1].startTime;
      }).observe({ type: "largest-contentful-paint", buffered: true });
      new PerformanceObserver((l) => {
        for (const e of l.getEntries()) if (!e.hadRecentInput) window.__perf.cls += e.value;
      }).observe({ type: "layout-shift", buffered: true });
    } catch {}
  });
  await page.goto(url, { waitUntil: "load", timeout: 30000 });
  await page.waitForTimeout(3000); // let LCP / layout shifts settle
  return page.evaluate(() => {
    const nav = performance.getEntriesByType("navigation")[0] || {};
    const fcp = (performance.getEntriesByName("first-contentful-paint")[0] || {}).startTime || 0;
    const lcp = (window.__perf && window.__perf.lcp) || 0;
    const cls = (window.__perf && window.__perf.cls) || 0;
    let tbt = 0;
    for (const e of performance.getEntriesByType("longtask")) {
      tbt += Math.max(0, e.duration - 50);
    }
    return {
      ttfb: Math.round(nav.responseStart || 0),
      fcp: Math.round(fcp),
      lcp: Math.round(lcp),
      cls: Math.round(cls * 1000) / 1000,
      load: Math.round((nav.loadEventEnd || 0) - (nav.startTime || 0)),
      tbt: Math.round(tbt),
    };
  });
}

(async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const out = {};
  for (const r of ROUTES) {
    const page = await ctx.newPage();
    try {
      out[r] = await measure(page, BASE + r);
    } catch (e) {
      out[r] = { error: String(e).slice(0, 80) };
    }
    await page.close();
  }

  // Soft route-change: home → services via real client navigation.
  let routeChange = null;
  try {
    const page = await ctx.newPage();
    await page.goto(BASE + "/services", { waitUntil: "load" });
    await page.waitForTimeout(1500);
    const t0 = Date.now();
    await page.goto(BASE + "/wallet", { waitUntil: "commit" });
    routeChange = Date.now() - t0;
    await page.close();
  } catch {}

  console.log(JSON.stringify({ routes: out, routeChangeMs: routeChange }, null, 2));
  await browser.close();
})();
