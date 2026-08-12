#!/usr/bin/env node
/**
 * Phase 5: Live Prometheus — scrape backend, inject synthetic startup failures, verify metrics.
 */
import { execSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, ".certification-evidence");
const BASE = process.env.CERT_BASE_URL || "http://localhost:3000";

async function post(signal, value, extra = {}) {
  const res = await fetch(`${BASE}/api/ux-signals`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ signal, value, platform: "ios", version: "1.0.0", device_type: "iphone", route: "mobile", ...extra }),
  });
  return res.ok;
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const results = { generatedAt: new Date().toISOString(), base: BASE, checks: {} };

  try {
    const ready = await fetch(`${BASE}/ready`);
    results.checks.backend_ready = { ok: ready.ok, status: ready.status };
  } catch (e) {
    results.checks.backend_ready = { ok: false, detail: String(e) };
  }

  try {
    const metrics = await fetch(`${BASE}/metrics`);
    const body = await metrics.text();
    const hasStartup = body.includes("homigo_mobile_startup");
    const hasFailure = body.includes("homigo_mobile_startup_failure_total") || body.includes("mobile_startup");
    results.checks.prometheus_scrape = { ok: metrics.ok && body.length > 100, bytes: body.length, hasStartup };
    results.metricsSample = body.split("\n").filter((l) => l.includes("homigo_mobile")).slice(0, 10);
  } catch (e) {
    results.checks.prometheus_scrape = { ok: false, detail: String(e) };
  }

  const injected = [];
  for (let i = 0; i < 5; i++) {
    injected.push(await post("startup_failure", 1));
    injected.push(await post("hydration_duration", 4500 + i * 100));
    injected.push(await post("startup_duration", 3500 + i * 100));
  }
  results.checks.synthetic_startup_failures = { ok: injected.every(Boolean), count: injected.filter(Boolean).length };

  try {
    const metrics2 = await fetch(`${BASE}/metrics`);
    const body2 = await metrics2.text();
    const failureLine = body2.split("\n").find((l) => l.startsWith("homigo_mobile_startup_failure_total"));
    const observedLine = body2.split("\n").find((l) => l.startsWith("homigo_mobile_startup_observed_total"));
    results.checks.metrics_after_injection = {
      ok: !!(failureLine || observedLine),
      failureLine: failureLine ?? null,
      observedLine: observedLine ?? null,
    };
  } catch (e) {
    results.checks.metrics_after_injection = { ok: false, detail: String(e) };
  }

  try {
    execSync("node scripts/validate-prometheus-production.mjs", { cwd: ROOT, stdio: "pipe" });
    results.checks.promtool_validation = { ok: true, detail: "promtool + amtool + firing test passed" };
  } catch (e) {
    results.checks.promtool_validation = { ok: false, detail: String(e.stderr ?? e.message).slice(0, 200) };
  }

  writeFileSync(join(OUT, "live-prometheus.json"), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
  const failed = Object.values(results.checks).filter((c) => !c.ok);
  process.exit(failed.length ? 1 : 0);
}

main();
