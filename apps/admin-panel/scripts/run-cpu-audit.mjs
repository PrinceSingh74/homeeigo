/**
 * Batch runner — probes every audit page and writes aggregated evidence JSON.
 *
 *   node scripts/run-cpu-audit.mjs
 */
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const API = process.env.BACKEND_ORIGIN ?? "http://localhost:3000";
const TARGETS = [
  "command-center",
  "operations",
  "digital-twin",
  "heatmap",
];

async function backendLatency() {
  const endpoints = [
    "/health",
    "/ready",
    "/api/admin/dashboard",
    "/api/admin/bookings",
    "/api/geo-intel/exec-kpis",
    "/api/admin/heatmap?gridSize=0.05&days=30",
    "/api/digital-twin/cities",
    "/api/admin/observability/health",
  ];
  const out = {};
  for (const ep of endpoints) {
    const t0 = performance.now();
    try {
      const res = await fetch(`${API}${ep}`);
      out[ep] = { status: res.status, ms: Math.round(performance.now() - t0) };
    } catch (e) {
      out[ep] = { error: String(e) };
    }
  }
  return out;
}

function runProbe(target) {
  const r = spawnSync("node", ["scripts/ui-perf-probe.mjs", target], {
    cwd: join(dirname(fileURLToPath(import.meta.url)), ".."),
    env: { ...process.env },
    encoding: "utf8",
    timeout: 180_000,
  });
  if (r.error) return { target, error: String(r.error) };
  if (r.status !== 0) return { target, error: r.stderr || r.stdout || `exit ${r.status}` };
  try {
    return JSON.parse(r.stdout);
  } catch {
    return { target, error: "invalid JSON", raw: r.stdout?.slice(0, 500) };
  }
}

const backend = await backendLatency();
const pages = [];
for (const t of TARGETS) {
  console.error(`Probing ${t}...`);
  pages.push(runProbe(t));
}

const report = {
  audited_at: new Date().toISOString(),
  environment: {
    admin_url: process.env.E2E_ADMIN_URL ?? "http://localhost:3003",
    backend_url: API,
    probe_window_ms: Number(process.env.PROBE_WINDOW_MS ?? 65_000),
    probe_warmup_ms: Number(process.env.PROBE_WARMUP_MS ?? 30_000),
    react_strict_mode: true,
    next_dev: true,
  },
  backend_latency_ms: backend,
  pages,
};

const outPath = join(dirname(fileURLToPath(import.meta.url)), "frontend-cpu-evidence-after.json");
writeFileSync(outPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
console.error(`Wrote ${outPath}`);
