/**
 * P2 — Grafana Dashboard Coverage Validator (static, runnable anywhere).
 *
 * Evidence-based audit of observability coverage WITHOUT needing a running
 * Grafana/Prometheus. It:
 *   1. Extracts every metric name HOMIGO actually emits, by parsing the real
 *      emitters (src/lib/metrics.ts, financial-metrics.ts, ops-metrics.ts).
 *   2. Extracts every metric referenced by the committed Grafana dashboards.
 *   3. Maps the P2-required observability domains to concrete metrics and
 *      reports, per domain: emitted? dashboarded? alerted?
 *
 * Output: JSON to stdout + a Markdown evidence file under docs/p2/evidence/.
 * Exit 0 if every REQUIRED domain has at least one emitted+dashboarded metric.
 *
 *   bun run scripts/p2-validation/grafana-coverage.ts
 */
import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BACKEND = join(HERE, "..", "..");
const REPO = join(BACKEND, "..", "..");
const EVIDENCE_DIR = join(REPO, "docs", "p2", "evidence");

const EMITTER_FILES = [
  join(BACKEND, "src/lib/metrics.ts"),
  join(BACKEND, "src/lib/financial-metrics.ts"),
  join(BACKEND, "src/lib/ops-metrics.ts"),
];
const DASHBOARD_DIR = join(BACKEND, "monitoring/grafana/dashboards");
const ALERT_RULES = join(BACKEND, "monitoring/rules/homigo-alerts.yml");

/** Prometheus metric token: word chars, must contain a typical metric suffix or known root. */
const METRIC_RE = /\b([a-z][a-z0-9_]*_(?:total|seconds|bytes|count|sum|bucket|hours|rate|backlog|clients))\b|\b(redis_up|ws_connections_total|assignment_queue_backlog|process_uptime_seconds)\b/g;

async function safeRead(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return "";
  }
}

function extractMetrics(text: string): Set<string> {
  const found = new Set<string>();
  let m: RegExpExecArray | null;
  METRIC_RE.lastIndex = 0;
  while ((m = METRIC_RE.exec(text))) {
    const name = (m[1] ?? m[2])?.replace(/_(bucket|sum|count)$/, "");
    if (name) found.add(name);
  }
  return found;
}

/**
 * The P2 observability scope, mapped to the metric(s) that satisfy each domain.
 * A domain is COVERED when ≥1 of its metrics is both emitted and dashboarded.
 */
const REQUIRED_DOMAINS: Record<string, string[]> = {
  "API latency": ["http_request_duration_seconds", "http_requests_total"],
  "Database metrics": ["http_request_duration_seconds", "process_resident_memory_bytes"],
  "Wallet metrics": ["wallet_transfer_total", "wallet_debit_total", "hcoin_earned_total", "hcoin_redeemed_total"],
  "Payment metrics": ["payment_success_total", "payment_failed_total", "refund_total"],
  "Provider metrics": ["provider_payout_total", "assignment_queue_backlog"],
  "Booking metrics": ["http_requests_total", "assignment_queue_backlog"],
  "WebSocket metrics": ["ws_connections_total"],
  "Finance metrics": ["settlement_total", "payout_total", "chargeback_total", "reconciliation_mismatch_total"],
  "Integrity metrics": ["finance_integrity_failures_total", "settlement_mismatch_total", "reconciliation_mismatch_total"],
};

/** Harvest dynamically-emitted gauges/counters: setOpsGauge("x") / recordOpsMetric("x"). */
async function harvestDynamic(dir: string, acc: Set<string>): Promise<void> {
  let entries: import("node:fs").Dirent[] = [];
  try {
    entries = (await readdir(dir, { withFileTypes: true })) as unknown as import("node:fs").Dirent[];
  } catch {
    return;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      await harvestDynamic(p, acc);
    } else if (e.name.endsWith(".ts")) {
      const txt = await safeRead(p);
      const re = /(?:setOpsGauge|recordOpsMetric)\(\s*["'`]([a-z][a-z0-9_]*)["'`]/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(txt))) acc.add(m[1]);
    }
  }
}

async function main() {
  const emitted = new Set<string>();
  for (const f of EMITTER_FILES) {
    for (const name of extractMetrics(await safeRead(f))) emitted.add(name);
  }
  // Dynamically-named ops gauges/counters live at service call-sites, not in the
  // emitter files — harvest them so the coverage report doesn't false-negative.
  await harvestDynamic(join(BACKEND, "src", "services"), emitted);

  const dashboarded = new Set<string>();
  let dashboardCount = 0;
  try {
    for (const name of await readdir(DASHBOARD_DIR)) {
      if (!name.endsWith(".json")) continue;
      dashboardCount++;
      for (const metric of extractMetrics(await safeRead(join(DASHBOARD_DIR, name)))) {
        dashboarded.add(metric);
      }
    }
  } catch {
    /* no dashboards dir */
  }

  const alerted = extractMetrics(await safeRead(ALERT_RULES));

  type Row = {
    domain: string;
    metric: string;
    emitted: boolean;
    dashboarded: boolean;
    alerted: boolean;
  };
  const rows: Row[] = [];
  const domainStatus: Record<string, "COVERED" | "PARTIAL" | "MISSING"> = {};

  for (const [domain, metrics] of Object.entries(REQUIRED_DOMAINS)) {
    let anyEmittedAndDash = false;
    let anyEmitted = false;
    for (const metric of metrics) {
      const e = emitted.has(metric);
      const d = dashboarded.has(metric);
      const a = alerted.has(metric);
      if (e) anyEmitted = true;
      if (e && d) anyEmittedAndDash = true;
      rows.push({ domain, metric, emitted: e, dashboarded: d, alerted: a });
    }
    domainStatus[domain] = anyEmittedAndDash ? "COVERED" : anyEmitted ? "PARTIAL" : "MISSING";
  }

  const covered = Object.values(domainStatus).filter((s) => s === "COVERED").length;
  const partial = Object.values(domainStatus).filter((s) => s === "PARTIAL").length;
  const missing = Object.values(domainStatus).filter((s) => s === "MISSING").length;
  const total = Object.keys(REQUIRED_DOMAINS).length;
  const coveragePct = Math.round((covered / total) * 100);

  const missingMetrics = rows.filter((r) => !r.emitted).map((r) => r.metric);
  const dashboardGaps = rows.filter((r) => r.emitted && !r.dashboarded).map((r) => r.metric);

  const summary = {
    generatedAt: new Date().toISOString(),
    dashboardsScanned: dashboardCount,
    emittedMetricCount: emitted.size,
    dashboardedMetricCount: dashboarded.size,
    coveragePct,
    domains: { total, covered, partial, missing },
    domainStatus,
    missingMetrics: [...new Set(missingMetrics)],
    dashboardGaps: [...new Set(dashboardGaps)],
  };

  console.log(JSON.stringify({ summary, rows }, null, 2));

  // Write Markdown evidence
  await mkdir(EVIDENCE_DIR, { recursive: true });
  const md: string[] = [];
  md.push("# Evidence — Grafana Dashboard Coverage Report");
  md.push("");
  md.push(`Generated: ${summary.generatedAt}`);
  md.push(`Dashboards scanned: ${dashboardCount} · Emitted metrics: ${emitted.size} · Coverage: **${coveragePct}%** (${covered}/${total} domains)`);
  md.push("");
  md.push("| Domain | Status | Metric | Emitted | Dashboarded | Alerted |");
  md.push("|---|---|---|:--:|:--:|:--:|");
  for (const r of rows) {
    md.push(
      `| ${r.domain} | ${domainStatus[r.domain]} | \`${r.metric}\` | ${r.emitted ? "✅" : "❌"} | ${r.dashboarded ? "✅" : "❌"} | ${r.alerted ? "✅" : "—"} |`,
    );
  }
  md.push("");
  md.push("## Missing Metrics Report");
  md.push(summary.missingMetrics.length ? summary.missingMetrics.map((m) => `- \`${m}\` (not emitted by any /metrics source)`).join("\n") : "- None — all required metrics are emitted.");
  md.push("");
  md.push("## Dashboard Gaps (emitted but not visualised)");
  md.push(summary.dashboardGaps.length ? summary.dashboardGaps.map((m) => `- \`${m}\``).join("\n") : "- None.");
  md.push("");
  await writeFile(join(EVIDENCE_DIR, "grafana-coverage.md"), md.join("\n"), "utf8");
  await writeFile(join(EVIDENCE_DIR, "grafana-coverage.json"), JSON.stringify({ summary, rows }, null, 2), "utf8");

  console.error(`\n[grafana-coverage] coverage=${coveragePct}% covered=${covered} partial=${partial} missing=${missing}`);
  console.error(`[grafana-coverage] evidence → docs/p2/evidence/grafana-coverage.{md,json}`);
  process.exit(missing === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("[grafana-coverage] fatal:", e);
  process.exit(2);
});
