// Forensic navigation profiler. From HOME, clicks each nav link 12x and captures the full
// timeline per click: router-commit (pathname change), first-paint (2×rAF), and content-visible
// (route <main> has real height). Reports p50/p95/p99. Stable only off OneDrive.
const { chromium } = require("playwright");
const BASE = process.env.PROBE_BASE || "http://localhost:3100";
const N = Number(process.env.SAMPLES || 12);
const ROUTES = ["/services", "/bookings", "/wallet", "/profile", "/"];

const pct = (arr, p) => { if (!arr.length) return null; const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]; };

async function sample(page, href) {
  // start from home each time
  await page.goto(BASE + "/", { waitUntil: "load" }).catch(() => {});
  await page.waitForTimeout(120);
  const r = await page.evaluate(async (h) => {
    const t0 = performance.now();
    const a = document.querySelector(`a[href="${h}"]`);
    if (!a) return { err: "no-link" };
    a.click();
    // router commit
    await new Promise((res) => { const id = setInterval(() => { if (location.pathname === h) { clearInterval(id); res(); } }, 4); setTimeout(res, 20000); });
    const tCommit = performance.now();
    // first paint
    await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
    const tPaint = performance.now();
    // content visible: <main> has real height
    await new Promise((res) => { const id = setInterval(() => { const m = document.querySelector("main"); if (m && m.offsetHeight > 200) { clearInterval(id); res(); } }, 8); setTimeout(res, 20000); });
    const tContent = performance.now();
    return { commit: Math.round(tCommit - t0), paint: Math.round(tPaint - t0), content: Math.round(tContent - t0) };
  }, href);
  return r;
}

(async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1366, height: 900 } })).newPage();
  // login
  await page.goto(BASE + "/login", { waitUntil: "load", timeout: 120000 });
  await page.fill('input[type="email"], input[name="email"]', "customer@homigo.demo").catch(() => {});
  await page.fill('input[type="password"], input[name="password"]', "Homigo@123").catch(() => {});
  await page.click('button[type="submit"]').catch(() => {});
  await page.waitForFunction(() => location.pathname !== "/login", { timeout: 120000 }).catch(() => {});
  // warm
  for (const r of ROUTES) await page.goto(BASE + r, { waitUntil: "load" }).catch(() => {});

  const out = {};
  for (const href of ROUTES) {
    const commit = [], paint = [], content = [];
    for (let i = 0; i < N; i++) {
      const s = await sample(page, href);
      if (s && !s.err) { commit.push(s.commit); paint.push(s.paint); content.push(s.content); }
    }
    out[href] = {
      n: content.length,
      commit_p50: pct(commit, 50),
      paint_p50: pct(paint, 50),
      content_p50: pct(content, 50), content_p95: pct(content, 95), content_p99: pct(content, 99),
    };
  }
  console.log(JSON.stringify(out, null, 2));
  await browser.close();
})();
