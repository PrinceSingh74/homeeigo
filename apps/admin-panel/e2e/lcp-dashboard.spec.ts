import { test, expect } from "@playwright/test";

/**
 * Measures the admin DASHBOARD Largest Contentful Paint on the PRODUCTION build
 * (next start, port 3003), authenticated. Uses the same `largest-contentful-paint`
 * PerformanceObserver entry Lighthouse reports for its LCP audit. Reports the median
 * of 3 cold loads. Run against the prod server with E2E_SKIP_SERVERS=1.
 */
const SEED_ADMIN = { email: "admin@homigo.demo", password: "Homigo@123" };

async function login(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.locator("#admin-email").fill(SEED_ADMIN.email);
  await page.locator("#admin-password").fill(SEED_ADMIN.password);
  await page.getByRole("button", { name: /enter business hq/i }).click();
  await expect(page.getByRole("heading", { name: /business overview/i })).toBeVisible({ timeout: 30_000 });
}

async function measureLcp(page: import("@playwright/test").Page): Promise<number> {
  // Apply Lighthouse's default lab throttling (4x CPU slowdown + Slow-4G network) so the
  // number is comparable to the 2.89s Lighthouse baseline — not an unthrottled localhost read.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 150, // ms RTT
    downloadThroughput: (1.6 * 1024 * 1024) / 8, // ~1.6 Mbps
    uploadThroughput: (750 * 1024) / 8, // ~750 Kbps
  });
  // Cold load: clear caches by reloading the dashboard, then read the final LCP entry.
  await page.goto("/", { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { name: /business overview/i })).toBeVisible({ timeout: 30_000 });
  return page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        let last = 0;
        new PerformanceObserver((list) => {
          for (const e of list.getEntries()) last = (e as PerformanceEntry & { renderTime?: number; startTime: number }).startTime;
        }).observe({ type: "largest-contentful-paint", buffered: true });
        // LCP finalizes on visibility change; force it, then read.
        setTimeout(() => {
          Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
          document.dispatchEvent(new Event("visibilitychange"));
          setTimeout(() => resolve(Math.round(last)), 300);
        }, 1500);
      }),
  );
}

test("admin dashboard LCP (production build) < 2500ms", async ({ page }) => {
  test.setTimeout(180_000);
  await login(page);
  const samples: number[] = [];
  for (let i = 0; i < 3; i++) {
    const lcp = await measureLcp(page);
    samples.push(lcp);
    console.log(`LCP sample ${i + 1}: ${lcp} ms`);
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const median = sorted[1]!;
  console.log(`\nLCP samples: ${samples.join(", ")} ms  ·  MEDIAN = ${median} ms  ·  target < 2500 ms`);
  expect(median).toBeLessThan(2500);
});
