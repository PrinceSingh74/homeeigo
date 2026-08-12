/**
 * Prometheus metrics runtime certification — verifies all enterprise metrics on /metrics.
 *
 *   bun --env-file=.env run scripts/enterprise/metrics-certification.ts
 */
import "../../src/load-env";
import { writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ensureDir } from "../lib/safe-fs";

const HERE = dirname(fileURLToPath(import.meta.url));
const BACKEND = join(HERE, "..", "..");
const OUT = join(BACKEND, "..", "..", "docs", "enterprise");
const EVIDENCE = join(OUT, "metrics-certification-evidence.json");
const BASE = process.env.API_URL ?? process.env.LOAD_TEST_BASE_URL ?? "http://localhost:3000";
const PROM = process.env.PROMETHEUS_URL ?? "http://localhost:9090";

const REQUIRED_METRICS = [
  "admin_alerts_sent_total",
  "admin_alerts_skipped_total",
  "admin_alerts_deduplicated_total",
  "admin_alerts_rate_limited_total",
  "websocket_connection_count",
  "websocket_room_count",
  "websocket_duplicate_join_total",
  "backup_total",
  "backup_size_bytes",
  "backup_last_success_timestamp",
  "backup_retention_deleted_total",
  "auth_refresh_total",
  "auth_refresh_failures",
] as const;

async function fetchText(url: string): Promise<{ ok: boolean; status: number; body: string }> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    return { ok: res.ok, status: res.status, body: await res.text() };
  } catch (err) {
    return { ok: false, status: 0, body: String(err) };
  }
}

function extractMetricLines(body: string, name: string): string[] {
  return body.split("\n").filter((l) => l.startsWith(name) || l.startsWith(`${name}{`));
}

async function main() {
  await ensureDir(OUT);
  const metricsRes = await fetchText(`${BASE}/metrics`);
  const promTargets = await fetchText(`${PROM}/api/v1/targets`);

  const inventory = REQUIRED_METRICS.map((name) => {
    const lines = extractMetricLines(metricsRes.body, name);
    const live = lines.length > 0;
    const sample = lines.slice(0, 3);
    const hasLabels = lines.some((l) => l.includes("{"));
    return { name, live, lineCount: lines.length, hasLabels, sample };
  });

  const missing = inventory.filter((m) => !m.live).map((m) => m.name);
  const promScrapingBackend =
    promTargets.ok && /localhost:3000|"health":"up"/.test(promTargets.body);

  const evidence = {
    generatedAt: new Date().toISOString(),
    base: BASE,
    prometheusUrl: PROM,
    metricsEndpoint: {
      ok: metricsRes.ok,
      status: metricsRes.status,
      bytes: metricsRes.body.length,
    },
    inventory,
    missing,
    prometheusScrape: {
      targetsReachable: promTargets.ok,
      backendTargetUp: promScrapingBackend,
      promStatus: promTargets.status,
    },
    verdict: missing.length === 0 && metricsRes.ok ? "PASS" : missing.length === 0 ? "PARTIAL" : "FAIL",
    scrapeSnippet: inventory
      .filter((m) => m.live)
      .map((m) => m.sample.join("\n"))
      .join("\n")
      .slice(0, 4000),
  };

  await writeFile(EVIDENCE, JSON.stringify(evidence, null, 2));
  console.log(`[metrics-cert] /metrics status=${metricsRes.status} bytes=${metricsRes.body.length}`);
  console.log(`[metrics-cert] live=${inventory.filter((m) => m.live).length}/${REQUIRED_METRICS.length}`);
  if (missing.length) console.log(`[metrics-cert] missing: ${missing.join(", ")}`);
  console.log(`[metrics-cert] prometheus targets ok=${promTargets.ok} backend up=${promScrapingBackend}`);
  console.log(`[metrics-cert] evidence → ${EVIDENCE}`);
  console.log(`[metrics-cert] verdict=${evidence.verdict}`);
  if (evidence.verdict === "FAIL") process.exit(1);
}

main().catch((e) => {
  console.error("[metrics-cert] fatal:", e);
  process.exit(1);
});
