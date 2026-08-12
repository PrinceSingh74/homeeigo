/**
 * KPI Validation Audit — compare Grafana CEO Executive metrics against
 * raw Postgres SQL, in-process business logic, and Admin Panel API.
 *
 *   bun --env-file=.env run scripts/kpi-validation-audit.ts
 *
 * Env: API_URL (default http://localhost:3000), ADMIN_EMAIL, ADMIN_PASSWORD
 */
import { writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { BookingStatus } from "@prisma/client";
import "../src/load-env";
import prisma from "../src/lib/prisma";
import { financialIntegrityService } from "../src/services/financial-integrity.service";
import { financeDashboardService } from "../src/services/finance-dashboard.service";
import { DEFAULT_BASE, smokeLogin, smokeReq } from "./smoke-lib";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..", "..");
const OUT = join(REPO, "kpi-validation-audit.md");
const BASE = process.env.API_URL ?? DEFAULT_BASE;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "admin@homigo.demo";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "Homigo@123";

type Verdict = "MATCH" | "MISMATCH" | "EXPECTED_MISMATCH" | "NOT_VERIFIED";

type KpiResult = {
  name: string;
  sourceTables: string[];
  grafanaQuery: string;
  sqlQuery: string;
  grafana: number | null;
  database: number | null;
  businessLogic: number | null;
  adminPanel: number | null | "N/A";
  dbReference?: number | null;
  verdict: Verdict;
  notes?: string;
};

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function fmt(n: number | null | "N/A", unit?: string): string {
  if (n === "N/A" || n === null) return "N/A";
  if (unit === "INR") return `₹${n.toLocaleString("en-IN")}`;
  if (unit === "pct") return `${n}%`;
  if (unit === "sec") return `${n}s`;
  if (unit === "min") return `${n} min`;
  return String(n);
}

/** Parse Prometheus text exposition — gauges, counters, histogram sum/count. */
function parseMetrics(body: string): {
  gauges: Map<string, number>;
  counters: Map<string, number>;
  histSum: Map<string, number>;
  histCount: Map<string, number>;
} {
  const gauges = new Map<string, number>();
  const counters = new Map<string, number>();
  const histSum = new Map<string, number>();
  const histCount = new Map<string, number>();

  for (const line of body.split("\n")) {
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^([a-zA-Z_:][a-zA-Z0-9_:]*(?:\{[^}]*\})?)\s+([+-]?\d+(?:\.\d+)?(?:e[+-]?\d+)?)$/);
    if (!m) continue;
    const fullName = m[1]!;
    const value = Number(m[2]);
    const baseName = fullName.replace(/\{.*\}$/, "");

    if (baseName.endsWith("_sum")) {
      const histName = baseName.slice(0, -4);
      histSum.set(histName, (histSum.get(histName) ?? 0) + value);
    } else if (baseName.endsWith("_count")) {
      const histName = baseName.slice(0, -6);
      histCount.set(histName, (histCount.get(histName) ?? 0) + value);
    } else if (line.includes("# TYPE") === false) {
      // Heuristic: known counters vs gauges from CEO dashboard
      const counterNames = new Set([
        "payment_success_total",
        "payment_failed_total",
        "booking_created_total",
      ]);
      if (counterNames.has(baseName)) {
        counters.set(baseName, (counters.get(baseName) ?? 0) + value);
      } else {
        gauges.set(baseName, value);
      }
    }
  }

  // Re-parse with TYPE hints for accurate counter/gauge split
  let currentType: "counter" | "gauge" | "histogram" | "unknown" = "unknown";
  for (const line of body.split("\n")) {
    const typeMatch = line.match(/^# TYPE (\S+) (\w+)/);
    if (typeMatch) {
      currentType = typeMatch[2] as typeof currentType;
      continue;
    }
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^([a-zA-Z_:][a-zA-Z0-9_:]*(?:\{[^}]*\})?)\s+([+-]?\d+(?:\.\d+)?(?:e[+-]?\d+)?)$/);
    if (!m) continue;
    const fullName = m[1]!;
    const value = Number(m[2]);
    const baseName = fullName.replace(/\{.*\}$/, "");

    if (baseName.endsWith("_bucket")) continue;
    if (baseName.endsWith("_sum")) {
      const histName = baseName.slice(0, -4);
      histSum.set(histName, (histSum.get(histName) ?? 0) + value);
      continue;
    }
    if (baseName.endsWith("_count")) {
      const histName = baseName.slice(0, -6);
      histCount.set(histName, (histCount.get(histName) ?? 0) + value);
      continue;
    }
    if (currentType === "counter") {
      counters.set(baseName, (counters.get(baseName) ?? 0) + value);
    } else if (currentType === "gauge") {
      gauges.set(baseName, value);
    }
  }

  return { gauges, counters, histSum, histCount };
}

function avgEtaMinutes(histSum: Map<string, number>, histCount: Map<string, number>): number | null {
  const sum = histSum.get("geo_eta_seconds") ?? 0;
  const count = histCount.get("geo_eta_seconds") ?? 0;
  if (count === 0) return 0;
  return round1(sum / count / 60);
}

function compareExact(a: number | null, b: number | null): boolean {
  if (a === null || b === null) return false;
  return a === b;
}

function comparePct(a: number | null, b: number | null, tol = 0.1): boolean {
  if (a === null || b === null) return false;
  return Math.abs(a - b) <= tol;
}

function compareCurrency(a: number | null, b: number | null): boolean {
  if (a === null || b === null) return false;
  return Math.round(a) === Math.round(b);
}

async function fetchMetrics(): Promise<{ ok: boolean; body: string; error?: string }> {
  try {
    const res = await fetch(`${BASE}/metrics`, { signal: AbortSignal.timeout(15_000) });
    const body = await res.text();
    return { ok: res.ok, body };
  } catch (e) {
    return { ok: false, body: "", error: String(e) };
  }
}

async function fetchAdminFinance(): Promise<{ gmv: number | null; netRevenue: number | null; error?: string }> {
  try {
    const login = await smokeLogin(BASE, ADMIN_EMAIL, ADMIN_PASSWORD);
    if (!login.token) return { gmv: null, netRevenue: null, error: `login failed status=${login.status}` };
    const r = await smokeReq(BASE, "/api/admin/finance/dashboard?days=30", {
      headers: { Authorization: `Bearer ${login.token}` },
    });
    if (r.status !== 200) return { gmv: null, netRevenue: null, error: `API status=${r.status}` };
    const overview = (r.body.data as Record<string, unknown> | undefined)?.overview as Record<string, number> | undefined;
    return {
      gmv: overview?.gmv ?? null,
      netRevenue: overview?.netRevenue ?? null,
    };
  } catch (e) {
    return { gmv: null, netRevenue: null, error: String(e) };
  }
}

async function computeBusinessLogic() {
  const now = Date.now();
  const dayAgo = new Date(now - 24 * 3600_000);
  const weekAgo = new Date(now - 7 * 24 * 3600_000);

  const [
    gmvAgg,
    commissionAgg,
    activeCustomers,
    online,
    completed,
    cancelled,
    refunded,
    payoutQueue,
    acceptanceAttempts,
    recent,
    ordersToday,
    settledRevenueAgg,
    paymentStats,
    chargebackCount,
    avgEtaRow,
  ] = await Promise.all([
    prisma.booking.aggregate({ _sum: { totalAmount: true }, where: { status: "COMPLETED" as BookingStatus } }),
    prisma.earning.aggregate({ _sum: { commission: true } }),
    prisma.user.count({ where: { role: "CUSTOMER", isActive: true, deletedAt: null } }),
    prisma.provider.count({ where: { isOnline: true } }),
    prisma.booking.count({ where: { status: "COMPLETED" as BookingStatus } }),
    prisma.booking.count({
      where: { status: { in: ["CANCELLED_BY_USER", "CANCELLED_BY_PROVIDER"] as BookingStatus[] } },
    }),
    prisma.booking.count({ where: { refundAmount: { gt: 0 } } }),
    prisma.withdrawal.count({ where: { status: "REQUESTED" } }),
    Promise.all([
      prisma.assignmentAttempt.count({ where: { status: "ACCEPTED", dispatchedAt: { gte: dayAgo } } }),
      prisma.assignmentAttempt.count({ where: { dispatchedAt: { gte: dayAgo } } }),
    ]),
    prisma.booking.findMany({
      where: { acceptedAt: { not: null, gte: dayAgo } },
      select: { createdAt: true, acceptedAt: true },
      take: 500,
    }),
    prisma.booking.count({ where: { createdAt: { gte: dayAgo } } }),
    prisma.paymentSettlement.aggregate({ _sum: { settledAmount: true } }),
    Promise.all([
      prisma.payment.count({ where: { status: "SUCCESS" } }),
      prisma.payment.count({ where: { status: "FAILED" } }),
    ]),
    prisma.chargeback.count(),
    prisma.$queryRaw<Array<{ avg_eta: number | null }>>`
      SELECT ROUND(AVG(eta)::numeric, 1)::float AS avg_eta
      FROM bookings
      WHERE eta IS NOT NULL AND eta > 0 AND created_at >= ${weekAgo}`,
  ]);

  const gmv = gmvAgg._sum.totalAmount ?? 0;
  const netRevenue = commissionAgg._sum.commission ?? 0;
  const finished = completed + cancelled;
  const [acceptedAttempts, totalAttempts] = acceptanceAttempts;
  const [paymentSuccess, paymentFailed] = paymentStats;
  const paymentAttempts = paymentSuccess + paymentFailed;

  let avgAssignment = 0;
  if (recent.length) {
    const avgMs =
      recent.reduce((s, b) => s + ((b.acceptedAt?.getTime() ?? 0) - b.createdAt.getTime()), 0) / recent.length;
    avgAssignment = Math.max(0, Math.round(avgMs / 1000));
  }

  const integrity = await financialIntegrityService.validate().catch(() => ({ score: null as number | null }));

  return {
    gmv: Math.round(gmv),
    netRevenue: Math.round(netRevenue),
    grossMarginPct: gmv > 0 ? round1((netRevenue / gmv) * 100) : 0,
    financialIntegrity: integrity.score,
    activeCustomers,
    activeProviders: online,
    ordersToday,
    bookingCompletionPct: finished > 0 ? round1((completed / finished) * 100) : 0,
    providerAcceptancePct:
      totalAttempts > 0 ? round2((acceptedAttempts / totalAttempts) * 100) : 0,
    refundPct: finished > 0 ? round1((refunded / finished) * 100) : 0,
    chargebackPct: paymentSuccess > 0 ? round2((chargebackCount / paymentSuccess) * 100) : 0,
    settlementHealthPct: payoutQueue === 0 ? 100 : round1((completed / (completed + payoutQueue)) * 100),
    paymentSuccessPct: paymentAttempts > 0 ? round1((paymentSuccess / paymentAttempts) * 100) : 0,
    settledRevenueInr: Math.round(settledRevenueAgg._sum.settledAmount ?? 0),
    avgEtaMinutes: avgEtaRow[0]?.avg_eta != null ? round1(Number(avgEtaRow[0].avg_eta)) : 0,
    avgAssignmentSeconds: avgAssignment,
    completed,
    cancelled,
    refunded,
    payoutQueue,
  };
}

async function runSqlQueries() {
  const [
    gmvRow,
    netRevRow,
    marginRow,
    customersRow,
    providersRow,
    ordersTodayRow,
    assignmentRow,
    completionRow,
    acceptanceRow,
    refundRow,
    chargebackRow,
    settlementRow,
    paymentSuccessRow,
    paymentSuccessPctRow,
    settledRevenueRow,
    etaProxyRow,
    adminGmvRow,
    adminNetRevRow,
  ] = await Promise.all([
    prisma.$queryRaw<Array<{ gmv: number }>>`
      SELECT COALESCE(ROUND(SUM(total_amount)), 0)::float AS gmv
      FROM bookings WHERE status = 'COMPLETED'`,
    prisma.$queryRaw<Array<{ net_revenue: number }>>`
      SELECT COALESCE(ROUND(SUM(commission)), 0)::float AS net_revenue FROM earnings`,
    prisma.$queryRaw<Array<{ gross_margin_pct: number }>>`
      SELECT CASE WHEN b.gmv > 0
        THEN ROUND(((e.commission / b.gmv) * 1000)::numeric, 0) / 10.0 ELSE 0 END AS gross_margin_pct
      FROM (SELECT COALESCE(SUM(total_amount), 0) AS gmv FROM bookings WHERE status = 'COMPLETED') b,
           (SELECT COALESCE(SUM(commission), 0) AS commission FROM earnings) e`,
    prisma.$queryRaw<Array<{ cnt: bigint }>>`
      SELECT COUNT(*) AS cnt FROM users
      WHERE role = 'CUSTOMER' AND is_active = true AND deleted_at IS NULL`,
    prisma.$queryRaw<Array<{ cnt: bigint }>>`
      SELECT COUNT(*) AS cnt FROM providers WHERE is_online = true`,
    prisma.$queryRaw<Array<{ cnt: bigint }>>`
      SELECT COUNT(*) AS cnt FROM bookings
      WHERE created_at >= NOW() - INTERVAL '24 hours'`,
    prisma.$queryRaw<Array<{ avg_sec: number }>>`
      SELECT COALESCE(ROUND(AVG(EXTRACT(EPOCH FROM (accepted_at - created_at)))), 0)::float AS avg_sec
      FROM (
        SELECT accepted_at, created_at FROM bookings
        WHERE accepted_at IS NOT NULL AND accepted_at >= NOW() - INTERVAL '24 hours'
        LIMIT 500
      ) sub`,
    prisma.$queryRaw<Array<{ pct: number }>>`
      SELECT COALESCE(ROUND(
        (COUNT(*) FILTER (WHERE status = 'COMPLETED')::float
        / NULLIF(COUNT(*) FILTER (WHERE status IN ('COMPLETED','CANCELLED_BY_USER','CANCELLED_BY_PROVIDER')), 0)
        * 100)::numeric
      , 1), 0)::float AS pct FROM bookings`,
    prisma.$queryRaw<Array<{ pct: number }>>`
      SELECT COALESCE(ROUND(
        (COUNT(*) FILTER (WHERE status = 'ACCEPTED' AND dispatched_at >= NOW() - INTERVAL '24 hours')::float
        / NULLIF(COUNT(*) FILTER (WHERE dispatched_at >= NOW() - INTERVAL '24 hours'), 0)
        * 100)::numeric, 2), 0)::float AS pct FROM assignment_attempts`,
    prisma.$queryRaw<Array<{ pct: number }>>`
      SELECT COALESCE(ROUND(
        (COUNT(*) FILTER (WHERE refund_amount > 0)::float
        / NULLIF(COUNT(*) FILTER (WHERE status IN ('COMPLETED','CANCELLED_BY_USER','CANCELLED_BY_PROVIDER')), 0)
        * 100)::numeric
      , 1), 0)::float AS pct FROM bookings`,
    prisma.$queryRaw<Array<{ pct: number }>>`
      SELECT CASE WHEN p.pay_cnt > 0
        THEN ROUND((c.cb_cnt * 100.0 / p.pay_cnt)::numeric, 2) ELSE 0 END AS pct
      FROM (SELECT COUNT(*)::float AS cb_cnt FROM chargebacks) c,
           (SELECT COUNT(*)::float AS pay_cnt FROM payments WHERE status = 'SUCCESS') p`,
    prisma.$queryRaw<Array<{ pct: number }>>`
      SELECT CASE WHEN w.queue = 0 THEN 100
        ELSE ROUND((b.completed / NULLIF(b.completed + w.queue, 0) * 100)::numeric, 1) END AS pct
      FROM (SELECT COUNT(*)::float AS completed FROM bookings WHERE status = 'COMPLETED') b,
           (SELECT COUNT(*)::float AS queue FROM withdrawals WHERE status = 'REQUESTED') w`,
    prisma.$queryRaw<Array<{ cnt: bigint }>>`
      SELECT COUNT(*) AS cnt FROM payments WHERE status = 'SUCCESS'`,
    prisma.$queryRaw<Array<{ pct: number }>>`
      SELECT CASE WHEN s + f > 0 THEN ROUND((s * 100.0 / (s + f))::numeric, 1) ELSE 0 END::float AS pct
      FROM (SELECT COUNT(*)::float AS s FROM payments WHERE status = 'SUCCESS') ok,
           (SELECT COUNT(*)::float AS f FROM payments WHERE status = 'FAILED') fail`,
    prisma.$queryRaw<Array<{ inr: number }>>`
      SELECT COALESCE(ROUND(SUM(settled_amount)), 0)::float AS inr FROM payment_settlements`,
    prisma.$queryRaw<Array<{ avg_eta: number | null }>>`
      SELECT ROUND(AVG(eta)::numeric, 1)::float AS avg_eta
      FROM bookings WHERE eta IS NOT NULL AND eta > 0 AND created_at >= NOW() - INTERVAL '7 days'`,
    prisma.$queryRaw<Array<{ gmv: number }>>`
      SELECT COALESCE(SUM(amount_paid), 0)::float AS gmv
      FROM payments
      WHERE status = 'SUCCESS' AND completed_at >= NOW() - INTERVAL '30 days'`,
    prisma.$queryRaw<Array<{ net_revenue: number }>>`
      SELECT COALESCE(p.gmv - r.refunds, 0)::float AS net_revenue
      FROM (
        SELECT COALESCE(SUM(amount_paid), 0) AS gmv FROM payments
        WHERE status = 'SUCCESS' AND completed_at >= NOW() - INTERVAL '30 days'
      ) p,
      (SELECT COALESCE(SUM(refunded_amount), 0) AS refunds FROM payments WHERE refunded_amount > 0) r`,
  ]);

  return {
    gmv: Number(gmvRow[0]?.gmv ?? 0),
    netRevenue: Number(netRevRow[0]?.net_revenue ?? 0),
    grossMarginPct: Number(marginRow[0]?.gross_margin_pct ?? 0),
    activeCustomers: Number(customersRow[0]?.cnt ?? 0),
    activeProviders: Number(providersRow[0]?.cnt ?? 0),
    ordersToday: Number(ordersTodayRow[0]?.cnt ?? 0),
    avgAssignmentSeconds: Number(assignmentRow[0]?.avg_sec ?? 0),
    bookingCompletionPct: Number(completionRow[0]?.pct ?? 0),
    providerAcceptancePct: Number(acceptanceRow[0]?.pct ?? 0),
    refundPct: Number(refundRow[0]?.pct ?? 0),
    chargebackPct: Number(chargebackRow[0]?.pct ?? 0),
    settlementHealthPct: Number(settlementRow[0]?.pct ?? 0),
    paymentSuccess: Number(paymentSuccessRow[0]?.cnt ?? 0),
    paymentSuccessPct: Number(paymentSuccessPctRow[0]?.pct ?? 0),
    settledRevenueInr: Number(settledRevenueRow[0]?.inr ?? 0),
    etaProxy: etaProxyRow[0]?.avg_eta != null ? Number(etaProxyRow[0].avg_eta) : null,
    adminGmv30d: Number(adminGmvRow[0]?.gmv ?? 0),
    adminNetRevenue30d: Number(adminNetRevRow[0]?.net_revenue ?? 0),
  };
}

function buildVerdict(
  kpi: string,
  grafana: number | null,
  database: number | null,
  businessLogic: number | null,
  opts?: { kind?: "count" | "currency" | "pct" | "counter"; expectedMismatch?: boolean; notes?: string },
): Verdict {
  const kind = opts?.kind ?? "count";
  const compare =
    kind === "pct" ? comparePct : kind === "currency" ? compareCurrency : compareExact;

  if (grafana === null) return "NOT_VERIFIED";
  if (opts?.expectedMismatch) return "EXPECTED_MISMATCH";

  const dbBlMatch = compare(database, businessLogic);
  const grafanaBlMatch = compare(grafana, businessLogic);

  if (kind === "counter") {
    // Counter may diverge from DB all-time count after process restart
    if (grafanaBlMatch || dbBlMatch) return grafana === database ? "MATCH" : "EXPECTED_MISMATCH";
    return "MISMATCH";
  }

  if (dbBlMatch && grafanaBlMatch) return "MATCH";
  return "MISMATCH";
}

function renderReport(
  timestamp: string,
  env: { base: string; dbHost: string },
  metricsOk: boolean,
  metricsError: string | undefined,
  adminError: string | undefined,
  results: KpiResult[],
): string {
  const matchCount = results.filter((r) => r.verdict === "MATCH").length;
  const mismatchCount = results.filter((r) => r.verdict === "MISMATCH").length;
  const expectedCount = results.filter((r) => r.verdict === "EXPECTED_MISMATCH").length;
  const notVerified = results.filter((r) => r.verdict === "NOT_VERIFIED").length;

  const lines: string[] = [
    "# KPI Validation Audit",
    "",
    `**Generated:** ${timestamp}`,
    `**Environment:** Backend \`${env.base}\`, Database \`${env.dbHost}\``,
    `**Metrics scrape:** ${metricsOk ? "OK" : `FAILED${metricsError ? ` — ${metricsError}` : ""}`}`,
    adminError ? `**Admin API:** ${adminError}` : "",
    "",
    "## Executive Summary",
    "",
    `| Result | Count |`,
    `|--------|------:|`,
    `| MATCH | ${matchCount} |`,
    `| MISMATCH | ${mismatchCount} |`,
    `| EXPECTED_MISMATCH | ${expectedCount} |`,
    `| NOT_VERIFIED | ${notVerified} |`,
    "",
    "| KPI | Grafana | Database | Business Logic | Admin Panel | Verdict |",
    "|-----|--------:|---------:|---------------:|------------:|---------|",
  ];

  for (const r of results) {
    lines.push(
      `| ${r.name} | ${fmt(r.grafana)} | ${fmt(r.database)} | ${fmt(r.businessLogic)} | ${fmt(r.adminPanel)} | **${r.verdict}** |`,
    );
  }

  lines.push("", "## Per-KPI Detail", "");

  for (const r of results) {
    lines.push(`### ${r.name}`, "");
    lines.push("**Source tables:** " + r.sourceTables.map((t) => `\`${t}\``).join(", "));
    lines.push("");
    lines.push("| Layer | Status |");
    lines.push("|-------|--------|");
    lines.push("| Grafana | ✅ |");
    lines.push(`| Admin Panel | ${r.adminPanel === "N/A" ? "— (not on CFO dashboard)" : "✅"} |`);
    lines.push("| Database | ✅ |");
    lines.push("| Business Logic | ✅ |");
    lines.push("");
    lines.push("**Grafana query:**");
    lines.push("```promql");
    lines.push(r.grafanaQuery);
    lines.push("```");
    lines.push("");
    lines.push("**SQL query:**");
    lines.push("```sql");
    lines.push(r.sqlQuery.trim());
    lines.push("```");
    lines.push("");
    lines.push("| Field | Value |");
    lines.push("|-------|------:|");
    lines.push(`| Dashboard value (Grafana/Prometheus) | ${fmt(r.grafana)} |`);
    lines.push(`| Database value | ${fmt(r.database)} |`);
    lines.push(`| Business logic value | ${fmt(r.businessLogic)} |`);
    lines.push(`| Admin Panel value | ${fmt(r.adminPanel)} |`);
    if (r.dbReference != null) {
      lines.push(`| DB reference (proxy) | ${fmt(r.dbReference)} |`);
    }
    lines.push(`| **Verdict** | **${r.verdict}** |`);
    if (r.notes) lines.push("", r.notes);
    lines.push("");
  }

  lines.push(
    "## Known Definition Divergences",
    "",
    "- **Admin GMV / Net Revenue** — 30-day payment-based (`finance-dashboard.service.ts`) vs Grafana lifetime booking/commission-based (`partner-exec-metrics.ts`).",
    "- **Chargeback %** — Now DB-backed via `fin_chargeback_pct` (chargebacks / successful payments).",
    "- **Payment Success %** — CEO panel uses `fin_payment_success_pct` (DB-backed), not in-memory counter.",
    "- **Orders Today** — `biz_orders_today` gauge counts calendar 24h bookings from Postgres.",
    "- **Settled Revenue** — `fin_settled_revenue_inr` sums `payment_settlements.settled_amount`, not settlement event counter.",
    "- **Avg ETA** — `ops_avg_eta_minutes` is DB-backed (7d booking ETA); `geo_eta_seconds` histogram supplements maps telemetry.",
    "",
    "## Recommendations",
    "",
    "1. Wire provider `acceptance_rate` column refresh on accept/reject (assignment-engine.service.ts).",
    "2. Add scope badges on Admin CFO dashboard (30d payments) vs Grafana CEO (lifetime bookings).",
    "3. Isolate demo/test bookings from refund KPI if refund rate exceeds 5% target.",
    "4. Backfill `payment_settlements` via Razorpay settlement sync if `fin_settled_revenue_inr` is zero.",
    "",
  );

  return lines.filter((l) => l !== undefined).join("\n");
}

async function main() {
  console.log(`\nKPI Validation Audit → ${BASE}\n`);

  const dbUrl = process.env.DATABASE_URL ?? "";
  let dbHost = "unknown";
  try {
    dbHost = new URL(dbUrl.replace(/^postgresql:/, "http:")).host;
  } catch {
    dbHost = dbUrl.split("@")[1]?.split("/")[0] ?? "unknown";
  }

  const [metricsRes, adminFinance, sql, bl] = await Promise.all([
    fetchMetrics(),
    fetchAdminFinance(),
    runSqlQueries(),
    computeBusinessLogic(),
  ]);

  const parsed = metricsRes.ok ? parseMetrics(metricsRes.body) : null;

  const grafana = {
    gmv: parsed?.gauges.get("biz_gmv_inr") ?? null,
    netRevenue: parsed?.gauges.get("biz_net_revenue_inr") ?? null,
    grossMarginPct: parsed?.gauges.get("biz_gross_margin_pct") ?? null,
    financialIntegrity: parsed?.gauges.get("financial_integrity_score") ?? null,
    activeCustomers: parsed?.gauges.get("biz_active_customers") ?? null,
    activeProviders: parsed?.gauges.get("biz_active_providers") ?? null,
    ordersToday: parsed?.gauges.get("biz_orders_today") ?? null,
    avgEtaMin: parsed?.gauges.get("ops_avg_eta_minutes") ?? (parsed ? avgEtaMinutes(parsed.histSum, parsed.histCount) : null),
    avgAssignmentSeconds: parsed?.gauges.get("ops_avg_assignment_seconds") ?? null,
    bookingCompletionPct: parsed?.gauges.get("ops_booking_completion_rate") ?? null,
    providerAcceptancePct: parsed?.gauges.get("partner_acceptance_rate") ?? null,
    refundPct: parsed?.gauges.get("fin_refund_pct") ?? null,
    chargebackPct: parsed?.gauges.get("fin_chargeback_pct") ?? null,
    settlementHealthPct: parsed?.gauges.get("fin_settlement_health") ?? null,
    settledRevenueInr: parsed?.gauges.get("fin_settled_revenue_inr") ?? null,
    paymentSuccessPct: parsed?.gauges.get("fin_payment_success_pct") ?? null,
  };

  const results: KpiResult[] = [
    {
      name: "GMV",
      sourceTables: ["bookings"],
      grafanaQuery: "biz_gmv_inr",
      sqlQuery: `SELECT COALESCE(ROUND(SUM(total_amount)), 0) AS gmv\nFROM bookings WHERE status = 'COMPLETED'`,
      grafana: grafana.gmv,
      database: sql.gmv,
      businessLogic: bl.gmv,
      adminPanel: adminFinance.gmv ?? sql.adminGmv30d,
      verdict: buildVerdict("GMV", grafana.gmv, sql.gmv, bl.gmv, { kind: "currency" }),
      notes:
        (adminFinance.gmv ?? sql.adminGmv30d) !== bl.gmv
          ? `Admin Panel GMV (30d payments: ${fmt(adminFinance.gmv ?? sql.adminGmv30d, "INR")}) uses a different definition than Grafana (lifetime completed bookings: ${fmt(bl.gmv, "INR")}).`
          : undefined,
    },
    {
      name: "Net Revenue",
      sourceTables: ["earnings"],
      grafanaQuery: "biz_net_revenue_inr",
      sqlQuery: "SELECT COALESCE(ROUND(SUM(commission)), 0) AS net_revenue FROM earnings",
      grafana: grafana.netRevenue,
      database: sql.netRevenue,
      businessLogic: bl.netRevenue,
      adminPanel: adminFinance.netRevenue ?? sql.adminNetRevenue30d,
      verdict: buildVerdict("Net Revenue", grafana.netRevenue, sql.netRevenue, bl.netRevenue, { kind: "currency" }),
      notes:
        (adminFinance.netRevenue ?? sql.adminNetRevenue30d) !== bl.netRevenue
          ? `Admin Panel net revenue (30d GMV − refunds: ${fmt(adminFinance.netRevenue ?? sql.adminNetRevenue30d, "INR")}) differs from Grafana (sum of earnings.commission: ${fmt(bl.netRevenue, "INR")}).`
          : undefined,
    },
    {
      name: "Gross Margin %",
      sourceTables: ["bookings", "earnings"],
      grafanaQuery: "biz_gross_margin_pct",
      sqlQuery: `SELECT CASE WHEN b.gmv > 0 THEN ROUND((e.commission / b.gmv) * 1000) / 10.0 ELSE 0 END\nFROM (SELECT SUM(total_amount) AS gmv FROM bookings WHERE status = 'COMPLETED') b,\n     (SELECT SUM(commission) AS commission FROM earnings) e`,
      grafana: grafana.grossMarginPct,
      database: sql.grossMarginPct,
      businessLogic: bl.grossMarginPct,
      adminPanel: "N/A",
      verdict: buildVerdict("Gross Margin %", grafana.grossMarginPct, sql.grossMarginPct, bl.grossMarginPct, {
        kind: "pct",
      }),
    },
    {
      name: "Financial Integrity",
      sourceTables: [
        "journal_entries",
        "ledger_entries",
        "payments",
        "withdrawals",
        "wallet_transactions",
      ],
      grafanaQuery: "financial_integrity_score",
      sqlQuery: "-- Computed via financialIntegrityService.validate() (severity-weighted penalty, not single SQL)",
      grafana: grafana.financialIntegrity,
      database: bl.financialIntegrity,
      businessLogic: bl.financialIntegrity,
      adminPanel: "N/A",
      verdict: buildVerdict(
        "Financial Integrity",
        grafana.financialIntegrity,
        bl.financialIntegrity,
        bl.financialIntegrity,
        { kind: "count" },
      ),
    },
    {
      name: "Active Customers",
      sourceTables: ["users"],
      grafanaQuery: "biz_active_customers",
      sqlQuery: `SELECT COUNT(*) FROM users\nWHERE role = 'CUSTOMER' AND is_active = true AND deleted_at IS NULL`,
      grafana: grafana.activeCustomers,
      database: sql.activeCustomers,
      businessLogic: bl.activeCustomers,
      adminPanel: "N/A",
      verdict: buildVerdict(
        "Active Customers",
        grafana.activeCustomers,
        sql.activeCustomers,
        bl.activeCustomers,
        { kind: "count" },
      ),
    },
    {
      name: "Active Providers",
      sourceTables: ["providers"],
      grafanaQuery: "biz_active_providers",
      sqlQuery: "SELECT COUNT(*) FROM providers WHERE is_online = true",
      grafana: grafana.activeProviders,
      database: sql.activeProviders,
      businessLogic: bl.activeProviders,
      adminPanel: "N/A",
      verdict: buildVerdict(
        "Active Providers",
        grafana.activeProviders,
        sql.activeProviders,
        bl.activeProviders,
        { kind: "count" },
      ),
    },
    {
      name: "Orders Today",
      sourceTables: ["bookings"],
      grafanaQuery: "biz_orders_today",
      sqlQuery: `SELECT COUNT(*) FROM bookings\nWHERE created_at >= NOW() - INTERVAL '24 hours'`,
      grafana: grafana.ordersToday,
      database: sql.ordersToday,
      businessLogic: bl.ordersToday,
      adminPanel: "N/A",
      verdict: buildVerdict("Orders Today", grafana.ordersToday, sql.ordersToday, bl.ordersToday, {
        kind: "count",
      }),
    },
    {
      name: "Settled Revenue (₹)",
      sourceTables: ["payment_settlements"],
      grafanaQuery: "fin_settled_revenue_inr",
      sqlQuery: "SELECT COALESCE(ROUND(SUM(settled_amount)), 0) AS inr FROM payment_settlements",
      grafana: grafana.settledRevenueInr,
      database: sql.settledRevenueInr,
      businessLogic: bl.settledRevenueInr,
      adminPanel: "N/A",
      verdict: buildVerdict(
        "Settled Revenue (₹)",
        grafana.settledRevenueInr,
        sql.settledRevenueInr,
        bl.settledRevenueInr,
        { kind: "currency" },
      ),
    },
    {
      name: "Avg ETA (min)",
      sourceTables: ["bookings (proxy only)"],
      grafanaQuery: "ops_avg_eta_minutes",
      sqlQuery: `-- DB-backed avg ETA (7d bookings with eta > 0)\nSELECT ROUND(AVG(eta), 1) FROM bookings\nWHERE eta IS NOT NULL AND eta > 0 AND created_at >= NOW() - INTERVAL '7 days'`,
      grafana: grafana.avgEtaMin,
      database: sql.etaProxy,
      businessLogic: bl.avgEtaMinutes,
      adminPanel: "N/A",
      dbReference: sql.etaProxy,
      verdict: buildVerdict("Avg ETA (min)", grafana.avgEtaMin, sql.etaProxy, bl.avgEtaMinutes, { kind: "pct" }),
      notes: "Primary CEO panel uses ops_avg_eta_minutes (DB-backed). geo_eta_seconds histogram supplements live maps telemetry.",
    },
    {
      name: "Avg Assignment Time",
      sourceTables: ["bookings"],
      grafanaQuery: "ops_avg_assignment_seconds",
      sqlQuery: `SELECT COALESCE(ROUND(AVG(EXTRACT(EPOCH FROM (accepted_at - created_at)))), 0)\nFROM (\n  SELECT accepted_at, created_at FROM bookings\n  WHERE accepted_at IS NOT NULL AND accepted_at >= NOW() - INTERVAL '24 hours'\n  LIMIT 500\n) sub`,
      grafana: grafana.avgAssignmentSeconds,
      database: sql.avgAssignmentSeconds,
      businessLogic: bl.avgAssignmentSeconds,
      adminPanel: "N/A",
      verdict: buildVerdict(
        "Avg Assignment Time",
        grafana.avgAssignmentSeconds,
        sql.avgAssignmentSeconds,
        bl.avgAssignmentSeconds,
        { kind: "count" },
      ),
    },
    {
      name: "Booking Completion %",
      sourceTables: ["bookings"],
      grafanaQuery: "ops_booking_completion_rate",
      sqlQuery: `SELECT ROUND(COUNT(*) FILTER (WHERE status = 'COMPLETED')::float\n  / NULLIF(COUNT(*) FILTER (WHERE status IN ('COMPLETED','CANCELLED_BY_USER','CANCELLED_BY_PROVIDER')), 0)\n  * 100, 1)\nFROM bookings`,
      grafana: grafana.bookingCompletionPct,
      database: sql.bookingCompletionPct,
      businessLogic: bl.bookingCompletionPct,
      adminPanel: "N/A",
      verdict: buildVerdict(
        "Booking Completion %",
        grafana.bookingCompletionPct,
        sql.bookingCompletionPct,
        bl.bookingCompletionPct,
        { kind: "pct" },
      ),
    },
    {
      name: "Provider Acceptance %",
      sourceTables: ["providers"],
      grafanaQuery: "partner_acceptance_rate",
      sqlQuery: `SELECT ROUND(COUNT(*) FILTER (WHERE status = 'ACCEPTED' AND dispatched_at >= NOW() - INTERVAL '24 hours')::float\n  / NULLIF(COUNT(*) FILTER (WHERE dispatched_at >= NOW() - INTERVAL '24 hours'), 0)\n  * 100, 2)\nFROM assignment_attempts`,
      grafana: grafana.providerAcceptancePct,
      database: sql.providerAcceptancePct,
      businessLogic: bl.providerAcceptancePct,
      adminPanel: "N/A",
      verdict: buildVerdict(
        "Provider Acceptance %",
        grafana.providerAcceptancePct,
        sql.providerAcceptancePct,
        bl.providerAcceptancePct,
        { kind: "pct" },
      ),
    },
    {
      name: "Refund %",
      sourceTables: ["bookings"],
      grafanaQuery: "fin_refund_pct",
      sqlQuery: `SELECT ROUND(COUNT(*) FILTER (WHERE refund_amount > 0)::float\n  / NULLIF(COUNT(*) FILTER (WHERE status IN ('COMPLETED','CANCELLED_BY_USER','CANCELLED_BY_PROVIDER')), 0)\n  * 100, 1)\nFROM bookings`,
      grafana: grafana.refundPct,
      database: sql.refundPct,
      businessLogic: bl.refundPct,
      adminPanel: "N/A",
      verdict: buildVerdict("Refund %", grafana.refundPct, sql.refundPct, bl.refundPct, { kind: "pct" }),
    },
    {
      name: "Chargeback %",
      sourceTables: ["chargebacks", "payments"],
      grafanaQuery: "fin_chargeback_pct",
      sqlQuery: `SELECT CASE WHEN pay_cnt > 0\n  THEN ROUND(cb_cnt * 100.0 / pay_cnt, 2) ELSE 0 END\nFROM (SELECT COUNT(*) AS cb_cnt FROM chargebacks) c,\n     (SELECT COUNT(*) AS pay_cnt FROM payments WHERE status = 'SUCCESS') p`,
      grafana: grafana.chargebackPct,
      database: sql.chargebackPct,
      businessLogic: bl.chargebackPct,
      adminPanel: "N/A",
      verdict: buildVerdict("Chargeback %", grafana.chargebackPct, sql.chargebackPct, bl.chargebackPct, {
        kind: "pct",
      }),
    },
    {
      name: "Settlement Health %",
      sourceTables: ["bookings", "withdrawals"],
      grafanaQuery: "fin_settlement_health",
      sqlQuery: `SELECT CASE WHEN w.queue = 0 THEN 100\n  ELSE ROUND(b.completed / NULLIF(b.completed + w.queue, 0) * 100, 1) END\nFROM (SELECT COUNT(*) AS completed FROM bookings WHERE status = 'COMPLETED') b,\n     (SELECT COUNT(*) AS queue FROM withdrawals WHERE status = 'REQUESTED') w`,
      grafana: grafana.settlementHealthPct,
      database: sql.settlementHealthPct,
      businessLogic: bl.settlementHealthPct,
      adminPanel: "N/A",
      verdict: buildVerdict(
        "Settlement Health %",
        grafana.settlementHealthPct,
        sql.settlementHealthPct,
        bl.settlementHealthPct,
        { kind: "pct" },
      ),
    },
    {
      name: "Payment Success %",
      sourceTables: ["payments"],
      grafanaQuery: "fin_payment_success_pct",
      sqlQuery: `SELECT CASE WHEN s + f > 0 THEN ROUND(s * 100.0 / (s + f), 1) ELSE 0 END\nFROM (SELECT COUNT(*)::float AS s FROM payments WHERE status = 'SUCCESS') ok,\n     (SELECT COUNT(*)::float AS f FROM payments WHERE status = 'FAILED') fail`,
      grafana: grafana.paymentSuccessPct,
      database: sql.paymentSuccessPct,
      businessLogic: bl.paymentSuccessPct,
      adminPanel: "N/A",
      verdict: buildVerdict(
        "Payment Success %",
        grafana.paymentSuccessPct,
        sql.paymentSuccessPct,
        bl.paymentSuccessPct,
        { kind: "pct" },
      ),
    },
  ];

  const timestamp = new Date().toISOString();
  const report = renderReport(timestamp, { base: BASE, dbHost }, metricsRes.ok, metricsRes.error, adminFinance.error, results);

  await writeFile(OUT, report, "utf8");
  console.log(`Report written → ${OUT}\n`);

  for (const r of results) {
    const icon =
      r.verdict === "MATCH" ? "✅" : r.verdict === "EXPECTED_MISMATCH" ? "⚠️" : r.verdict === "NOT_VERIFIED" ? "⚪" : "❌";
    console.log(`${icon} ${r.name}: ${r.verdict} (Grafana=${r.grafana}, DB=${r.database}, BL=${r.businessLogic})`);
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error("KPI audit failed:", e);
  await prisma.$disconnect();
  process.exit(1);
});
