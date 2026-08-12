/**
 * DOM heatmap probe — ranks top DOM contributors per admin route.
 *
 *   node scripts/dom-heatmap-probe.mjs dashboard
 *   node scripts/dom-heatmap-probe.mjs command-center
 */
import { chromium } from "@playwright/test";

const ADMIN = { email: "admin@homigo.demo", password: "Homigo@123" };
const BASE = process.env.E2E_ADMIN_URL ?? "http://localhost:3003";
const ROUTES = {
  dashboard: { path: null, ready: "Business overview" },
  "command-center": { path: "/command-center", ready: "Layers" },
  analytics: { path: "/analytics", ready: "Analytics" },
  geospatial: { path: "/geospatial", ready: "Geospatial" },
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

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.setDefaultNavigationTimeout(120_000);

  await login(page);
  if (route.path) {
    await page.goto(`${BASE}${route.path}`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(`text=${route.ready}`, { timeout: 120_000 }).catch(() => undefined);
  }
  await page.waitForTimeout(2000);

  const heatmap = await page.evaluate(() => {
    const selectors = [
      { key: "shell", sel: "[data-admin-shell]" },
      { key: "sidebar", sel: "nav, aside" },
      { key: "kpi", sel: "[data-dashboard-kpi], .biz-card" },
      { key: "charts", sel: "[data-chart], canvas, svg" },
      { key: "tables", sel: "table, [data-virtual-table]" },
      { key: "maps", sel: "[data-homigo-map-isolation], .gm-style, [data-map-boundary]" },
      { key: "below-fold", sel: "[data-dashboard-boundary]" },
      { key: "launchpad", sel: "[data-launchpad]" },
    ];

    const total = document.querySelectorAll("*").length;
    const bySelector = {};
    for (const { key, sel } of selectors) {
      let count = 0;
      document.querySelectorAll(sel).forEach((el) => {
        count += el.querySelectorAll("*").length + 1;
      });
      bySelector[key] = count;
    }

    const ranked = [];
    const walk = (el, depth, path) => {
      if (depth > 6) return;
      const kids = [...el.children];
      const subtree = el.querySelectorAll("*").length + 1;
      const tag = el.tagName.toLowerCase();
      const id = el.id ? `#${el.id}` : "";
      const cls =
        typeof el.className === "string" && el.className
          ? `.${el.className.split(/\s+/).slice(0, 2).join(".")}`
          : "";
      const key = `${path}/${tag}${id}${cls}`;
      if (subtree >= 12) ranked.push({ path: key, subtree, depth });
      kids.slice(0, 12).forEach((c, i) => walk(c, depth + 1, `${key}[${i}]`));
    };
    walk(document.body, 0, "body");

    ranked.sort((a, b) => b.subtree - a.subtree);

    const mapDom = window.__HOMIGO_MAP_DOM__ ?? [];
    const dashboardDom = window.__HOMIGO_DASHBOARD_DOM__ ?? [];

    return {
      totalDom: total,
      bySelector,
      topContributors: ranked.slice(0, 15),
      mapDomMetrics: mapDom,
      dashboardBoundaryMounts: dashboardDom,
    };
  });

  console.log(
    JSON.stringify(
      {
        target,
        measuredAt: new Date().toISOString(),
        ...heatmap,
      },
      null,
      2,
    ),
  );
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
