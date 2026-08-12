/**
 * Enterprise performance measurement suite.
 * Outputs JSON with timestamped evidence — no estimates.
 *
 * Usage: bun run scripts/enterprise-performance-measure.ts
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const API_BASE = process.env.API_URL ?? "http://localhost:3000";
const WEB_BASE = process.env.WEB_URL ?? "http://localhost:3011";
const ADMIN_BASE = process.env.ADMIN_URL ?? "http://localhost:3003";
const PARTNER_BASE = process.env.PARTNER_URL ?? "http://localhost:3012";
const TS = new Date().toISOString();

type Sample = { ms: number; status: number };

async function timedFetch(url: string): Promise<Sample> {
  const t0 = performance.now();
  const res = await fetch(url);
  await res.arrayBuffer();
  return { ms: Math.round(performance.now() - t0), status: res.status };
}

async function apiBench(path: string, runs = 10) {
  const url = `${API_BASE}${path}`;
  const cold = await timedFetch(url);
  const warm: number[] = [];
  for (let i = 0; i < runs; i++) {
    const s = await timedFetch(url);
    warm.push(s.ms);
  }
  warm.sort((a, b) => a - b);
  const p50 = warm[Math.floor(warm.length * 0.5)] ?? 0;
  const p95 = warm[Math.floor(warm.length * 0.95)] ?? warm.at(-1) ?? 0;
  return { path, coldMs: cold.ms, coldStatus: cold.status, p50Ms: p50, p95Ms: p95, samples: warm.length + 1 };
}

function parseBuildFirstLoad(appDir: string, route: string): number | null {
  const buildLog = join(ROOT, "measurements", `${appDir}-build.log`);
  if (!existsSync(buildLog)) return null;
  const text = readFileSync(buildLog, "utf8");
  const line = text.split("\n").find((l) => l.includes(route) && l.includes("kB"));
  if (!line) return null;
  const m = line.match(/(\d+(?:\.\d+)?)\s+kB\s*$/);
  return m ? Math.round(parseFloat(m[1]!) * 10) / 10 : null;
}

async function routeTtfb(base: string, route: string, app: string) {
  const url = `${base.replace(/\/$/, "")}${route === "/" ? "" : route}`;
  try {
    const t0 = performance.now();
    const res = await fetch(url);
    const body = await res.text();
    return {
      app,
      route,
      ttfbMs: Math.round(performance.now() - t0),
      status: res.status,
      htmlBytes: Buffer.byteLength(body, "utf8"),
      timestamp: TS,
    };
  } catch (e) {
    return {
      app,
      route,
      ttfbMs: null,
      status: null,
      error: e instanceof Error ? e.message : String(e),
      timestamp: TS,
    };
  }
}

const report = {
  timestamp: TS,
  bundles: {
    webHomeBeforeKb: 205,
    webHomeAfterKb: parseBuildFirstLoad("web", "/") ?? null,
    webProfileBeforeKb: 231,
    webProfileAfterKb: parseBuildFirstLoad("web", "/profile") ?? null,
    source: "next build route table",
  },
  apis: [] as Awaited<ReturnType<typeof apiBench>>[],
  routes: [] as Awaited<ReturnType<typeof routeTtfb>>[],
};

const apiPaths = [
  "/api/services",
  "/api/stats/overview",
  "/api/services/featured",
  "/api/admin/ops-map",
  "/api/admin/heatmap?gridSize=0.05&days=30",
];

for (const p of apiPaths) {
  try {
    report.apis.push(await apiBench(p));
  } catch (e) {
    report.apis.push({
      path: p,
      coldMs: 0,
      coldStatus: 0,
      p50Ms: 0,
      p95Ms: 0,
      samples: 0,
      error: e instanceof Error ? e.message : String(e),
    } as never);
  }
}

const routeMatrix: [string, string, string][] = [
  ["web", WEB_BASE, "/"],
  ["web", WEB_BASE, "/profile"],
  ["web", WEB_BASE, "/book"],
  ["admin", ADMIN_BASE, "/"],
  ["admin", ADMIN_BASE, "/bookings"],
  ["partner", PARTNER_BASE, "/"],
  ["partner", PARTNER_BASE, "/requests"],
];

for (const [app, base, route] of routeMatrix) {
  report.routes.push(await routeTtfb(base, route, app));
}

const out = join(ROOT, "measurements", "enterprise-performance-data.json");
await Bun.write(out, JSON.stringify(report, null, 2));
console.log(`Wrote ${out}`);
console.log(JSON.stringify(report, null, 2));
