/**
 * Phase 16 — observability self-test (§31, §64).
 *
 * A metric that is declared, charted and alerted on but never actually reaches the exposition
 * format is worse than no metric: the dashboard renders, the alert never fires, and the gap is
 * invisible until an incident. This scrapes the REAL `renderMetrics()` output — the same text
 * Prometheus reads — before and after driving the producers.
 *
 * Two directions are checked, because only one of them catches a fake:
 *   1. producer OFF → the series is either absent or at its seeded zero (never a fabricated value)
 *   2. producer ON  → the series appears AND the value moved
 *
 * A test that only asserts (2) would pass against a hard-coded constant.
 */
import "../../src/load-env";
import prisma from "../../src/lib/prisma";
import { renderMetrics } from "../../src/lib/metrics";
import { initAgents } from "../../src/agents";
import * as m from "../../src/agents/observability/agent-metrics";

type Result = { id: string; name: string; status: "PASS" | "FAIL"; detail: string };
const results: Result[] = [];
function check(id: string, name: string, ok: boolean, detail: string): void {
  results.push({ id, name, status: ok ? "PASS" : "FAIL", detail });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${id} ${name}\n        ${detail}`);
}

/**
 * Parse one sample's value, matching the metric name AND the full label fragment.
 *
 * The fragment must be specific enough to identify ONE series. Widening the boot-time zero-seeding
 * broke two checks here that had been passing only because their metric happened to have a single
 * series: `reason="READ_ONLY_AGENT"` began matching `agent_id="support"` (seeded 0) instead of the
 * `finance` series the test had just incremented. A first-line-wins selector silently measures the
 * wrong row, so callers pass fully-qualified label fragments.
 */
function sampleValue(text: string, name: string, labelFragment?: string): number | null {
  const lines = text.split(/\r?\n/).filter((l) => l.startsWith(name));
  const line = labelFragment ? lines.find((l) => l.includes(labelFragment)) : lines[0];
  if (!line) return null;
  const parts = line.trim().split(/\s+/);
  const v = Number(parts[parts.length - 1]);
  return Number.isFinite(v) ? v : null;
}

async function main(): Promise<void> {
  const db = (process.env.DATABASE_URL ?? "").split("/").pop()?.split("?")[0] ?? "";
  if (process.env.APP_ENV !== "staging" || !db.includes("staging")) {
    throw new Error(`REFUSING: APP_ENV=${process.env.APP_ENV} db=${db}`);
  }
  console.log(`[guard] staging confirmed (${db})\n`);

  initAgents();

  console.log("=== W. OBSERVABILITY SELF-TEST ===");

  // ── Producer OFF ──────────────────────────────────────────────────────────
  const before = await renderMetrics();

  /**
   * Zero-seeded series must be PRESENT at zero, not absent.
   *
   * `NO DATA` on a dashboard is indistinguishable from "the exporter is broken", so the boot-time
   * seeding publishes the series that would be misread by their absence. This asserts the seeding
   * actually reached the exposition format rather than only the in-process map.
   */
  const seeded = [
    "homigo_agent_plan_rejected_total",
    "homigo_agent_loop_prevented_total",
    "homigo_agent_verification_total",
    "homigo_agent_escalation_total",
    "homigo_agent_runs_total",
  ];
  const missingSeeded = seeded.filter((s) => sampleValue(before, s) === null);
  check("W1", "Zero-seeded agent series are exposed before any run happens",
    missingSeeded.length === 0,
    missingSeeded.length ? `missing=${missingSeeded.join(",")}` : `${seeded.length}/${seeded.length} present at seeded value`);

  /**
   * A series that was never produced must be ABSENT — not zero.
   *
   * This is the anti-fake check. If the exporter invented a zero for an unknown metric, an alert
   * on that metric could never fire and a dashboard would show a confident, wrong flat line.
   */
  const neverProduced = sampleValue(before, "homigo_agent_this_metric_does_not_exist");
  check("W2", "A metric that is never produced is absent, not a fabricated zero",
    neverProduced === null, `value=${neverProduced === null ? "absent" : neverProduced}`);

  // ── Producer ON ───────────────────────────────────────────────────────────
  const runsBefore = sampleValue(before, "homigo_agent_runs_total", 'agent_id="support",mode="LIVE",trigger="EVENT"') ?? 0;
  const verifyBefore = sampleValue(before, "homigo_agent_verification_total", 'agent_id="support",verdict="VERIFIED"') ?? 0;
  const escalBefore = sampleValue(before, "homigo_agent_escalation_total", 'agent_id="finance",reason="READ_ONLY_AGENT"') ?? 0;
  const costBefore = sampleValue(before, "homigo_agent_cost_usd_total", 'agent_id="finance"') ?? 0;

  m.recordAgentRunStarted("support", "LIVE", "EVENT");
  m.recordAgentVerification("support", "VERIFIED");
  m.recordAgentEscalation("finance", "READ_ONLY_AGENT");
  m.recordAgentCost("finance", 0.0042);
  m.recordAgentLatency("support", "LIVE", 2500);
  m.recordAgentBoundHit("operations", "MAX_STEPS");
  m.setAgentEnabledGauge("fraud", true);

  const after = await renderMetrics();

  const runsAfter = sampleValue(after, "homigo_agent_runs_total", 'agent_id="support",mode="LIVE",trigger="EVENT"') ?? 0;
  check("W3", "Driving the run producer moves the exposed counter",
    runsAfter > runsBefore, `before=${runsBefore} after=${runsAfter}`);

  const verifyAfter = sampleValue(after, "homigo_agent_verification_total", 'agent_id="support",verdict="VERIFIED"') ?? 0;
  check("W4", "Verification verdicts reach the exposition format",
    verifyAfter > verifyBefore, `before=${verifyBefore} after=${verifyAfter}`);

  const escalAfter = sampleValue(after, "homigo_agent_escalation_total", 'agent_id="finance",reason="READ_ONLY_AGENT"') ?? 0;
  check("W5", "Read-only escalations are observable",
    escalAfter > escalBefore, `before=${escalBefore} after=${escalAfter}`);

  const costAfter = sampleValue(after, "homigo_agent_cost_usd_total", 'agent_id="finance"') ?? 0;
  check("W6", "Cost is accumulated as a real value, not rounded to zero",
    costAfter > costBefore && Math.abs(costAfter - costBefore - 0.0042) < 1e-9,
    `before=${costBefore} after=${costAfter} delta=${(costAfter - costBefore).toFixed(6)}`);

  /**
   * The latency histogram must expose `_bucket` with an `le` label, because that is what the
   * dashboard's `histogram_quantile` reads. A histogram exposed only as `_sum`/`_count` renders an
   * empty panel with no error.
   */
  const bucketPresent = after.includes("homigo_agent_run_latency_seconds_bucket") && after.includes('le="');
  check("W7", "Latency is exposed as a histogram with le buckets",
    bucketPresent, `bucketSeriesPresent=${bucketPresent}`);

  const gauge = sampleValue(after, "homigo_agent_live", 'agent_id="fraud"');
  check("W8", "The live gauge is exposed with its real value",
    gauge === 1, `homigo_agent_live{agent_id="fraud"}=${gauge}`);

  /**
   * Cardinality. Every agent label must be one of the five known ids — a run id or a ticket id
   * leaking into a label is both a PII leak and a way to take Prometheus down.
   */
  const agentLabels = new Set(
    [...after.matchAll(/homigo_agent_[a-z_]+\{[^}]*agent_id="([^"]+)"/g)].map((x) => x[1]!),
  );
  const known = new Set(["support", "operations", "partner-operations", "finance", "fraud"]);
  const unexpected = [...agentLabels].filter((a) => !known.has(a));
  check("W9", "Every agent_id label is one of the five known agents",
    unexpected.length === 0,
    `distinct=${agentLabels.size} unexpected=${JSON.stringify(unexpected)}`);

  // Every dashboard query must resolve to a series the exporter actually produces.
  const dashboard = JSON.parse(
    await Bun.file("monitoring/grafana/dashboards/homigo-agents.json").text(),
  ) as { panels: Array<{ targets?: Array<{ expr: string }> }> };
  const referenced = new Set<string>();
  for (const p of dashboard.panels) {
    for (const t of p.targets ?? []) {
      for (const match of t.expr.matchAll(/homigo_agent_[a-z_]+/g)) referenced.add(match[0]);
    }
  }
  const unexposed = [...referenced].filter((r) => !after.includes(r.replace("_bucket", "")));
  check("W10", "Every metric the Grafana dashboard queries is actually exposed",
    unexposed.length === 0,
    `referenced=${referenced.size} unexposed=${JSON.stringify(unexposed)}`);

  const pass = results.filter((r) => r.status === "PASS").length;
  const fail = results.length - pass;
  console.log(`\n${"=".repeat(70)}`);
  console.log(`OBSERVABILITY SELF-TEST: ${pass} PASS, ${fail} FAIL`);
  for (const r of results.filter((x) => x.status === "FAIL")) console.log(`  FAIL ${r.id}: ${r.detail}`);
  console.log("=".repeat(70));

  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (err) => {
  console.error("OBSERVABILITY HARNESS FAILED:", err);
  await prisma.$disconnect();
  process.exit(2);
});
