#!/usr/bin/env node
/**
 * Phase 8: Ecosystem integration — mobile API paths → backend → metrics observable.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = process.env.CERT_BASE_URL || "http://localhost:3000";
const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", ".certification-evidence");

async function check(name, fn) {
  try {
    const r = await fn();
    return { name, ok: true, ...r };
  } catch (e) {
    return { name, ok: false, detail: String(e) };
  }
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const steps = [];

  steps.push(
    await check("backend_ready", async () => {
      const r = await fetch(`${BASE}/ready`);
      const j = await r.json();
      return { status: r.status, db: j.database ?? j.status };
    }),
  );

  steps.push(
    await check("ux_signals_ingest", async () => {
      const r = await fetch(`${BASE}/api/ux-signals`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signal: "startup_duration", value: 1200, platform: "android", version: "1.0.0", device_type: "android", route: "mobile" }),
      });
      return { status: r.status };
    }),
  );

  steps.push(
    await check("vitals_ingest", async () => {
      const r = await fetch(`${BASE}/api/vitals`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "PAGELOAD", value: 1200, rating: "unknown", device: "android", network: "4g", route: "cold-start" }),
      });
      return { status: r.status };
    }),
  );

  steps.push(
    await check("prometheus_metrics", async () => {
      const r = await fetch(`${BASE}/metrics`);
      const body = await r.text();
      return { bytes: body.length, hasHttp: body.includes("http_request"), hasStartup: body.includes("homigo_mobile") || body.includes("mobile_startup") };
    }),
  );

  steps.push(
    await check("health_services", async () => {
      const r = await fetch(`${BASE}/health`);
      return { status: r.status };
    }),
  );

  const result = { generatedAt: new Date().toISOString(), base: BASE, steps };
  writeFileSync(join(OUT, "ecosystem.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  process.exit(steps.every((s) => s.ok) ? 0 : 1);
}

main();
