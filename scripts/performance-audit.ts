/**
 * Homigo frontend performance audit runner.
 * Measures TTFB, route HTML size, API latency, and parses Next.js build manifests.
 *
 * Usage:
 *   bun run scripts/performance-audit.ts
 *   bun run scripts/performance-audit.ts --base-url http://localhost:3001
 */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

type RouteMetric = {
  app: string;
  route: string;
  ttfbMs: number | null;
  htmlBytes: number | null;
  status: number | null;
  error?: string;
};

type ApiMetric = {
  endpoint: string;
  p50Ms: number;
  p95Ms: number;
  samples: number;
  status: "PASS" | "FAIL" | "SKIP";
};

type BundleRoute = {
  route: string;
  firstLoadJsKb: number;
  sharedKb: number;
};

const ROOT = join(import.meta.dir, "..");

const WEB_ROUTES = [
  "/",
  "/services",
  "/bookings",
  "/providers",
  "/book",
  "/profile",
  "/wallet",
  "/ai",
  "/login",
  "/legal/privacy",
];

const ADMIN_ROUTES = [
  "/",
  "/bookings",
  "/customers",
  "/vendors",
  "/operations",
  "/finance/dashboard",
  "/fraud",
  "/support",
];

const PARTNER_ROUTES = [
  "/",
  "/requests",
  "/earnings",
  "/wallet",
  "/analytics",
  "/map",
  "/support",
];

const API_ENDPOINTS = [
  { path: "/api/stats/overview", label: "stats/overview" },
  { path: "/api/services", label: "services/list" },
  { path: "/api/services/featured", label: "services/featured" },
];

function parseArgs() {
  const args = process.argv.slice(2);
  const baseIdx = args.indexOf("--base-url");
  const apiIdx = args.indexOf("--api-url");
  return {
    webBase: baseIdx >= 0 ? args[baseIdx + 1]! : "http://localhost:3001",
    adminBase: "http://localhost:3003",
    partnerBase: "http://localhost:3002",
    apiBase: apiIdx >= 0 ? args[apiIdx + 1]! : "http://localhost:4000",
  };
}

async function measureTtfb(url: string): Promise<{ ttfbMs: number; htmlBytes: number; status: number }> {
  const start = performance.now();
  const res = await fetch(url, { redirect: "follow" });
  const ttfbMs = Math.round(performance.now() - start);
  const body = await res.text();
  return { ttfbMs, htmlBytes: Buffer.byteLength(body, "utf8"), status: res.status };
}

async function measureApi(url: string, runs = 5): Promise<ApiMetric> {
  const times: number[] = [];
  let lastStatus = 0;
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    try {
      const res = await fetch(url);
      lastStatus = res.status;
      await res.arrayBuffer();
      times.push(performance.now() - t0);
    } catch {
      return { endpoint: url, p50Ms: 0, p95Ms: 0, samples: 0, status: "SKIP" };
    }
  }
  times.sort((a, b) => a - b);
  const p50 = times[Math.floor(times.length * 0.5)] ?? 0;
  const p95 = times[Math.floor(times.length * 0.95)] ?? times.at(-1) ?? 0;
  const status = lastStatus >= 400 ? "SKIP" : p95 <= 200 ? "PASS" : "FAIL";
  return {
    endpoint: url,
    p50Ms: Math.round(p50),
    p95Ms: Math.round(p95),
    samples: times.length,
    status,
  };
}

function parseBuildManifest(appDir: string): BundleRoute[] {
  const manifestPath = join(appDir, ".next", "app-build-manifest.json");
  if (!existsSync(manifestPath)) return [];
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      pages: Record<string, string[]>;
    };
    const chunksDir = join(appDir, ".next", "static", "chunks");
    const chunkSizes = new Map<string, number>();
    if (existsSync(chunksDir)) {
      for (const f of walkFiles(chunksDir)) {
        if (f.endsWith(".js")) {
          chunkSizes.set(relative(chunksDir, f).replace(/\\/g, "/"), statSync(f).size);
        }
      }
    }
    const routes: BundleRoute[] = [];
    for (const [route, files] of Object.entries(manifest.pages)) {
      let total = 0;
      for (const file of files) {
        const key = file.replace(/^static\/chunks\//, "");
        total += chunkSizes.get(key) ?? 0;
      }
      routes.push({
        route,
        firstLoadJsKb: Math.round(total / 1024),
        sharedKb: 0,
      });
    }
    return routes.sort((a, b) => b.firstLoadJsKb - a.firstLoadJsKb);
  } catch {
    return [];
  }
}

function walkFiles(dir: string): string[] {
  const out: string[] = [];
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walkFiles(p));
    else out.push(p);
  }
  return out;
}

async function probeRoutes(
  app: string,
  base: string,
  routes: string[],
): Promise<RouteMetric[]> {
  const results: RouteMetric[] = [];
  for (const route of routes) {
    const url = `${base.replace(/\/$/, "")}${route === "/" ? "" : route}`;
    try {
      const m = await measureTtfb(url);
      results.push({
        app,
        route,
        ttfbMs: m.ttfbMs,
        htmlBytes: m.htmlBytes,
        status: m.status,
      });
    } catch (e) {
      results.push({
        app,
        route,
        ttfbMs: null,
        htmlBytes: null,
        status: null,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return results;
}

async function main() {
  const { webBase, adminBase, partnerBase, apiBase } = parseArgs();
  console.log("Homigo Performance Audit");
  console.log("========================");
  console.log(`Web: ${webBase} | Admin: ${adminBase} | Partner: ${partnerBase} | API: ${apiBase}`);
  console.log("");

  const [webRoutes, adminRouteMetrics, partnerRouteMetrics, ...apiMetrics] = await Promise.all([
    probeRoutes("web", webBase, WEB_ROUTES),
    probeRoutes("admin", adminBase, ADMIN_ROUTES),
    probeRoutes("partner", partnerBase, PARTNER_ROUTES),
    ...API_ENDPOINTS.map((e) => measureApi(`${apiBase}${e.path}`)),
  ]);

  const bundles = {
    web: parseBuildManifest(join(ROOT, "apps", "web")),
    admin: parseBuildManifest(join(ROOT, "apps", "admin-panel")),
    partner: parseBuildManifest(join(ROOT, "apps", "partner-web")),
  };

  const report = {
    generatedAt: new Date().toISOString(),
    targets: {
      homepageMs: 1000,
      routeTransitionMs: 300,
      apiP95Ms: 200,
      lcpMs: 2500,
    },
    routes: [...webRoutes, ...adminRouteMetrics, ...partnerRouteMetrics],
    apis: apiMetrics,
    bundles,
  };

  const outPath = join(ROOT, "performance-audit-data.json");
  await Bun.write(outPath, JSON.stringify(report, null, 2));
  console.log(`Wrote ${outPath}`);

  const measured = webRoutes.filter((r) => r.ttfbMs != null);
  if (measured.length > 0) {
    console.log("\nWeb TTFB sample:");
    for (const r of measured.slice(0, 5)) {
      console.log(`  ${r.route}: ${r.ttfbMs}ms (${r.htmlBytes} bytes)`);
    }
  } else {
    console.log("\nNo live servers detected — bundle data only. Start apps and re-run for TTFB.");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
