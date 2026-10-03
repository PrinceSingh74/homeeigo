/**
 * Alert-rule truth model across three layers, reconciled arithmetically.
 *
 * Pass 4 showed that each layer can look healthy while disagreeing with the others: the canonical
 * files validated, the staging mirror matched, the runtime reported 114 rules with zero health
 * errors, and none of them could fire because the scrape target pointed at a dead port. Counting
 * one layer proves nothing about the others, and "the number changed" with no explanation is how a
 * silently-dropped alert survives a review.
 *
 * Layers:
 *   1. canonical  — apps/backend/monitoring/rules/*.yml
 *   2. mirror     — deploy/observability/staging/rules/*.yml
 *   3. runtime    — whatever Prometheus has actually loaded, via /api/v1/rules
 *
 * Reports per-layer counts, duplicate alert names, duplicate expressions, alerts that appear in one
 * layer and not another, and commented-out definitions. Exits 1 on any unexplained divergence.
 *
 *   bun run scripts/reconcile-alert-rules.ts [--prometheus http://127.0.0.1:9090]
 *
 * Read-only. Reads files and one HTTP endpoint.
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const CANONICAL = join(ROOT, "monitoring", "rules");
const MIRROR = join(ROOT, "..", "..", "deploy", "observability", "staging", "rules");

const promIdx = process.argv.indexOf("--prometheus");
const PROM = promIdx >= 0 ? process.argv[promIdx + 1]! : "http://127.0.0.1:9090";

type Alert = { name: string; expr: string; file: string };

/**
 * Alert names and expressions from a rule directory.
 *
 * Comments are stripped first. The files quote old, broken expressions verbatim to explain why they
 * were wrong, and counting those as definitions is a mistake this codebase has already made once —
 * a Pass-4 check matched `homigo-ready` inside the comment explaining its removal.
 */
function fromDir(dir: string): { alerts: Alert[]; commented: string[] } {
  const alerts: Alert[] = [];
  const commented: string[] = [];
  if (!existsSync(dir)) return { alerts, commented };
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".yml"))) {
    const raw = readFileSync(join(dir, file), "utf8");
    for (const line of raw.split("\n")) {
      // `# - alert: X` is a definition someone disabled without deleting. Worth surfacing: it reads
      // as coverage in a diff and is not coverage at runtime.
      const off = line.match(/^\s*#\s*-\s*alert:\s*(\S+)/);
      if (off) commented.push(`${file}:${off[1]}`);
    }
    // `\r` first: these files are CRLF and JavaScript's `.` does not match a carriage return, so
    // `/#.*$/` against a CRLF line matches nothing and the strip silently no-ops.
    const code = raw
      .split("\n")
      .map((l) => l.replace(/\r$/, "").replace(/#.*$/, ""))
      .join("\n");
    const blocks = code.split(/^\s*- alert:\s*/m).slice(1);
    for (const block of blocks) {
      const name = block.split(/\s/)[0]!;
      const exprMatch = block.match(/expr:\s*(\|[\s\S]*?(?=^\s{6,8}\w+:)|[^\n]*)/m);
      alerts.push({ name, expr: (exprMatch?.[1] ?? "").replace(/\s+/g, " ").trim(), file });
    }
  }
  return { alerts, commented };
}

async function fromRuntime(): Promise<{ alerts: Alert[]; health: Record<string, number> } | null> {
  try {
    const res = await fetch(`${PROM}/api/v1/rules`, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      data: { groups: Array<{ name: string; file: string; rules: Array<Record<string, string>> }> };
    };
    const alerts: Alert[] = [];
    const health: Record<string, number> = {};
    for (const g of body.data.groups) {
      for (const r of g.rules) {
        if (r.type !== "alerting") continue;
        alerts.push({ name: r.name!, expr: String(r.query ?? "").replace(/\s+/g, " ").trim(), file: g.file ?? "?" });
        health[r.health ?? "unknown"] = (health[r.health ?? "unknown"] ?? 0) + 1;
      }
    }
    return { alerts, health };
  } catch {
    return null;
  }
}

function dupes(alerts: Alert[]): Map<string, Alert[]> {
  const byName = new Map<string, Alert[]>();
  for (const a of alerts) byName.set(a.name, [...(byName.get(a.name) ?? []), a]);
  return new Map([...byName.entries()].filter(([, v]) => v.length > 1));
}

const failures: string[] = [];
const notes: string[] = [];

const canonical = fromDir(CANONICAL);
const mirror = fromDir(MIRROR);
const runtime = await fromRuntime();

console.log("[alert-rules] layer counts\n");
console.log(`  canonical  ${String(canonical.alerts.length).padStart(4)}  (${CANONICAL.replace(ROOT, "apps/backend")})`);
console.log(`  mirror     ${String(mirror.alerts.length).padStart(4)}  (deploy/observability/staging/rules)`);
console.log(`  runtime    ${runtime ? String(runtime.alerts.length).padStart(4) : "   ?"}  (${PROM})`);

const uniqueCanonical = new Set(canonical.alerts.map((a) => a.name));
console.log(`\n  unique alert names (canonical): ${uniqueCanonical.size}`);

// ── Duplicates ─────────────────────────────────────────────────────────────────────────────────
for (const [layer, alerts] of [
  ["canonical", canonical.alerts],
  ["mirror", mirror.alerts],
  ...(runtime ? ([["runtime", runtime.alerts]] as const) : []),
] as Array<[string, Alert[]]>) {
  const d = dupes(alerts);
  if (d.size) {
    for (const [name, occurrences] of d) {
      failures.push(`duplicate alert name in ${layer}: ${name} (${occurrences.map((o) => o.file).join(", ")})`);
    }
  }
}

/**
 * Two alert names computing the identical condition.
 *
 * This is a FAILURE, not a report. The duplicate-name check cannot see this shape, and the shape is
 * where the damage is: `RedisDown` and `RedisDownP1` were both `redis_up == 0` for 2m at
 * severity: critical, differing only in that one carried `priority: P1`. One outage produced two
 * alerts that Alertmanager could never deduplicate (it deduplicates on the label set, and the whole
 * reason to have two was different labels), and the copy without a priority took the wrong route.
 *
 * A genuine escalation pair does not look like this — `FinancialIntegrityBelow100` (< 100) and
 * `WalletDriftSuspected` (< 92) watch the same series at different thresholds, so their expressions
 * differ and they do not match here. Enforcing at zero is possible precisely because no legitimate
 * case currently exists; if one arises, whoever adds it has to decide deliberately rather than by
 * accident.
 */
const byExpr = new Map<string, Alert[]>();
for (const a of canonical.alerts) {
  if (!a.expr) continue;
  byExpr.set(a.expr, [...(byExpr.get(a.expr) ?? []), a]);
}
const sharedExpr = [...byExpr.entries()].filter(([, v]) => new Set(v.map((x) => x.name)).size > 1);
console.log(`  distinct expressions shared by >1 alert name: ${sharedExpr.length}`);
for (const [expr, group] of sharedExpr) {
  const names = [...new Set(group.map((g) => g.name))];
  console.log(`     ${names.join(" = ")}`);
  failures.push(`one condition, ${names.length} alert names: ${names.join(", ")} — expr: ${expr.slice(0, 80)}`);
}

// ── Layer agreement ────────────────────────────────────────────────────────────────────────────
const canonNames = new Set(canonical.alerts.map((a) => a.name));
const mirrorNames = new Set(mirror.alerts.map((a) => a.name));
for (const n of canonNames) if (!mirrorNames.has(n)) failures.push(`in canonical but not mirror: ${n}`);
for (const n of mirrorNames) if (!canonNames.has(n)) failures.push(`in mirror but not canonical: ${n}`);

if (runtime) {
  const runtimeNames = new Set(runtime.alerts.map((a) => a.name));
  for (const n of canonNames) if (!runtimeNames.has(n)) failures.push(`in canonical but NOT LOADED at runtime: ${n}`);
  for (const n of runtimeNames) if (!canonNames.has(n)) failures.push(`loaded at runtime but not canonical: ${n}`);
  console.log(`\n  runtime health: ${Object.entries(runtime.health).map(([k, v]) => `${k}=${v}`).join(" ")}`);
  for (const [state, n] of Object.entries(runtime.health)) {
    if (state === "ok") continue;
    if (state === "unknown") {
      // Prometheus reports `unknown` until a rule has evaluated once, so for the first evaluation
      // interval after a restart this is the normal state and not a defect. Failing on it would
      // make this gate flaky right after every deploy, and a flaky gate gets muted — which is how
      // the stale-rules problem survived in the first place.
      notes.push(`${n} rule(s) have health="unknown" — not yet evaluated since the last reload`);
      continue;
    }
    failures.push(`runtime rules with health="${state}": ${n}`);
  }
} else {
  console.log(`\n  runtime: UNREACHABLE at ${PROM} — layer 3 not verified`);
}

if (canonical.commented.length) {
  console.log(`\n  commented-out alert definitions (${canonical.commented.length}):`);
  for (const c of canonical.commented) console.log(`     ${c}`);
}

if (notes.length) {
  console.log(`
  notes:`);
  for (const n of notes) console.log(`     ${n}`);
}

console.log("");
if (failures.length) {
  console.log(`DIVERGENCE (${failures.length}):`);
  for (const f of failures) console.log(`   ${f}`);
  console.log(`\n[alert-rules] FAIL`);
  process.exit(1);
}
console.log(
  `[alert-rules] PASS — canonical ${canonical.alerts.length} = mirror ${mirror.alerts.length}` +
    (runtime ? ` = runtime ${runtime.alerts.length}` : "") +
    `, no duplicates, no unexplained divergence`,
);
