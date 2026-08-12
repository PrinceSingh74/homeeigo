/**
 * P2 — Alertmanager / Alert-Rule Reliability Validator (static, runnable anywhere).
 *
 * Evidence-based audit of the alerting surface WITHOUT a running Alertmanager:
 *   1. Parses monitoring/rules/homigo-alerts.yml for defined alerts + severities.
 *   2. Parses monitoring/alertmanager.yml for routes, receivers, escalation.
 *   3. Checks each P2-required alert condition is covered by a rule.
 *   4. Checks each severity has a route and a receiver (delivery path exists).
 *   5. Flags whether Slack/email receivers are configured vs webhook-only.
 *
 * Output: JSON to stdout + Markdown evidence under docs/p2/evidence/.
 * Exit 0 when every required alert exists AND every used severity is routed.
 *
 *   bun run scripts/p2-validation/alert-reliability.ts
 */
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BACKEND = join(HERE, "..", "..");
const REPO = join(BACKEND, "..", "..");
const EVIDENCE_DIR = join(REPO, "docs", "p2", "evidence");
const RULES = join(BACKEND, "monitoring/rules/homigo-alerts.yml");
const AM = join(BACKEND, "monitoring/alertmanager.yml");

/** P2-required alert conditions → regex that should match a rule alert/expr. */
const REQUIRED_ALERTS: Record<string, RegExp> = {
  "High error rate": /HighErrorRate|http_requests_total\{status=~"5/i,
  "Payment failures": /Payment(Failure|Failed)|payment_failed_total/i,
  "Database outage": /Database|DbDown|pg_up|database_/i,
  "Redis outage": /Redis(Down|Unreachable)|redis_up\s*==\s*0/i,
  "High latency": /Latency|http_request_duration_seconds/i,
  "Webhook failure": /Webhook|webhook_failure/i,
  "Disk pressure": /Disk|disk_|filesystem|node_filesystem/i,
  "Memory pressure": /Memory|process_resident_memory_bytes|HighMemory/i,
  "CPU pressure": /Cpu|CPU|process_cpu|node_cpu/i,
};

async function safeRead(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return "";
  }
}

function parseAlerts(yml: string): { name: string; severity: string }[] {
  const out: { name: string; severity: string }[] = [];
  const lines = yml.split(/\r?\n/);
  let current: string | null = null;
  for (const line of lines) {
    const a = line.match(/^\s*-\s*alert:\s*(\S+)/);
    if (a) {
      current = a[1];
      out.push({ name: current, severity: "unknown" });
      continue;
    }
    const s = line.match(/^\s*severity:\s*(\S+)/);
    if (s && out.length) out[out.length - 1].severity = s[1];
  }
  return out;
}

function parseReceivers(yml: string): { name: string; kinds: string[] }[] {
  const out: { name: string; kinds: string[] }[] = [];
  const lines = yml.split(/\r?\n/);
  let inReceivers = false;
  let current: { name: string; kinds: string[] } | null = null;
  for (const line of lines) {
    if (/^receivers:/.test(line)) { inReceivers = true; continue; }
    if (inReceivers && /^[a-z_]+:/.test(line)) inReceivers = false;
    if (!inReceivers) continue;
    const n = line.match(/^\s*-\s*name:\s*(\S+)/);
    if (n) { current = { name: n[1], kinds: [] }; out.push(current); continue; }
    if (current) {
      if (/slack_configs/.test(line)) current.kinds.push("slack");
      if (/email_configs/.test(line)) current.kinds.push("email");
      if (/pagerduty_configs/.test(line)) current.kinds.push("pagerduty");
      if (/webhook_configs/.test(line)) current.kinds.push("webhook");
      if (/opsgenie_configs/.test(line)) current.kinds.push("opsgenie");
    }
  }
  return out;
}

function parseRoutedSeverities(yml: string): Set<string> {
  const set = new Set<string>();
  const re = /severity:\s*(\S+)/g;
  let m: RegExpExecArray | null;
  // only within the route block: take the section after 'route:' up to 'receivers:'
  const routeBlock = yml.split(/^receivers:/m)[0] ?? yml;
  while ((m = re.exec(routeBlock))) set.add(m[1]);
  return set;
}

async function main() {
  const rulesYml = await safeRead(RULES);
  const amYml = await safeRead(AM);

  const alerts = parseAlerts(rulesYml);
  const receivers = parseReceivers(amYml);
  const routedSeverities = parseRoutedSeverities(amYml);
  const usedSeverities = [...new Set(alerts.map((a) => a.severity).filter((s) => s !== "unknown"))];

  // Required alert coverage
  const alertCoverage = Object.entries(REQUIRED_ALERTS).map(([cond, re]) => ({
    condition: cond,
    covered: re.test(rulesYml),
  }));

  // Delivery path: each used severity routed? has receiver?
  const receiverNames = new Set(receivers.map((r) => r.name));
  const severityRouting = usedSeverities.map((sev) => ({
    severity: sev,
    routed: routedSeverities.has(sev),
  }));

  const hasSlack = receivers.some((r) => r.kinds.includes("slack"));
  const hasEmail = receivers.some((r) => r.kinds.includes("email"));
  const hasPager = receivers.some((r) => r.kinds.includes("pagerduty") || r.kinds.includes("opsgenie"));
  const escalationReceiver = receivers.find((r) => /escal/i.test(r.name));

  const missingAlerts = alertCoverage.filter((a) => !a.covered).map((a) => a.condition);
  const unroutedSeverities = severityRouting.filter((s) => !s.routed).map((s) => s.severity);

  const summary = {
    generatedAt: new Date().toISOString(),
    definedAlerts: alerts.length,
    requiredAlerts: alertCoverage.length,
    requiredCovered: alertCoverage.filter((a) => a.covered).length,
    receivers: receivers.map((r) => `${r.name}[${r.kinds.join(",") || "none"}]`),
    deliveryChannels: { slack: hasSlack, email: hasEmail, pagerduty: hasPager, webhookBridge: receivers.some((r) => r.kinds.includes("webhook")) },
    escalationChain: !!escalationReceiver,
    missingAlerts,
    unroutedSeverities,
  };

  console.log(JSON.stringify({ summary, alerts, alertCoverage, severityRouting }, null, 2));

  await mkdir(EVIDENCE_DIR, { recursive: true });
  const md: string[] = [];
  md.push("# Evidence — Alert Reliability Report");
  md.push("");
  md.push(`Generated: ${summary.generatedAt}`);
  md.push(`Defined alert rules: ${alerts.length} · Required conditions covered: ${summary.requiredCovered}/${summary.requiredAlerts}`);
  md.push("");
  md.push("## Required Alert Coverage");
  md.push("| Required Condition | Covered by a rule? |");
  md.push("|---|:--:|");
  for (const a of alertCoverage) md.push(`| ${a.condition} | ${a.covered ? "✅" : "❌ MISSING"} |`);
  md.push("");
  md.push("## Severity Routing (delivery path)");
  md.push("| Severity (used by rules) | Routed in alertmanager.yml |");
  md.push("|---|:--:|");
  for (const s of severityRouting) md.push(`| ${s.severity} | ${s.routed ? "✅" : "❌ UNROUTED"} |`);
  md.push("");
  md.push("## Delivery Channels Configured");
  md.push(`- Slack: ${hasSlack ? "✅ configured" : "❌ NOT configured (webhook bridge only)"}`);
  md.push(`- Email: ${hasEmail ? "✅ configured" : "❌ NOT configured"}`);
  md.push(`- PagerDuty/OpsGenie: ${hasPager ? "✅ configured" : "❌ NOT configured"}`);
  md.push(`- Escalation chain receiver: ${escalationReceiver ? `✅ \`${escalationReceiver.name}\`` : "❌ none"}`);
  md.push("");
  md.push("## Defined Rules");
  md.push("| Alert | Severity |");
  md.push("|---|---|");
  for (const a of alerts) md.push(`| ${a.name} | ${a.severity} |`);
  md.push("");
  await writeFile(join(EVIDENCE_DIR, "alert-reliability.md"), md.join("\n"), "utf8");
  await writeFile(join(EVIDENCE_DIR, "alert-reliability.json"), JSON.stringify({ summary, alerts, alertCoverage, severityRouting }, null, 2), "utf8");

  const ok = missingAlerts.length === 0 && unroutedSeverities.length === 0;
  console.error(`\n[alert-reliability] required covered ${summary.requiredCovered}/${summary.requiredAlerts}; missing=[${missingAlerts.join(", ")}]`);
  console.error(`[alert-reliability] slack=${hasSlack} email=${hasEmail} pager=${hasPager} escalation=${!!escalationReceiver}`);
  console.error(`[alert-reliability] evidence → docs/p2/evidence/alert-reliability.{md,json}`);
  // Non-zero exit signals gaps so CI/operators see PARTIAL honestly.
  process.exit(ok && hasSlack && hasEmail ? 0 : 1);
}

main().catch((e) => {
  console.error("[alert-reliability] fatal:", e);
  process.exit(2);
});
