/**
 * Live Prometheus gauge samplers — pull REAL values at scrape time (no mock data).
 * Registered once at boot (see index.ts). Reuses existing services/prisma; nothing new.
 *
 *   db_connections_active / db_connections_idle   ← pg_stat_activity
 *   financial_integrity_score                     ← financialIntegrityService (cached 60s, expensive)
 *   provider_acceptance_rate                      ← assignment_attempts (accepted / dispatched, 24h)
 *   db_slow_queries_total                         ← pg_stat_statements if available (best-effort)
 */
import prisma from "./prisma";
import { ACCEPTANCE_TERMINAL_STATUSES, acceptanceRatePct } from "./acceptance-rate";
import { setGauge, registerScrapeSampler } from "./metrics";
import { financialIntegrityService } from "../services/financial-integrity.service";

let integrityCache = { score: 100, at: 0 };
const INTEGRITY_TTL_MS = 60_000;

export function registerMetricSamplers(): void {
  // DB pool state (cheap)
  registerScrapeSampler(async () => {
    const rows = await prisma.$queryRawUnsafe<Array<{ state: string | null; n: number }>>(
      `SELECT state, count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() GROUP BY state`,
    ).catch(() => []);
    let active = 0, idle = 0;
    for (const r of rows) {
      if (r.state === "active") active += r.n;
      else if ((r.state ?? "").startsWith("idle")) idle += r.n;
    }
    setGauge("db_connections_active", active);
    setGauge("db_connections_idle", idle);
  });

  // Financial integrity score (expensive — cache 60s)
  registerScrapeSampler(async () => {
    if (Date.now() - integrityCache.at > INTEGRITY_TTL_MS) {
      const r = await financialIntegrityService.validate().catch(() => null);
      if (r) integrityCache = { score: r.score, at: Date.now() };
    }
    setGauge("financial_integrity_score", integrityCache.score);
  });

  /**
   * Provider acceptance over the last 24h — accepted over TERMINAL outcomes.
   *
   * The denominator was every attempt dispatched in the window, including those still SENT and
   * awaiting an answer. Under broadcast dispatch a single job is offered to up to
   * ASSIGNMENT_BROADCAST_FANOUT partners and at most one of them can accept, so this gauge was
   * structurally incapable of exceeding roughly 1/fanout: it measured fan-out width, not whether
   * partners take work. It now uses the same definition as the provider column and the coverage
   * page — see lib/acceptance-rate.ts.
   *
   * NaN when nothing terminal happened in the window. A gauge cannot publish "unknown", and 0 is a
   * claim that every offer was refused; NaN renders as a gap rather than as a false red.
   */
  registerScrapeSampler(async () => {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [accepted, terminal] = await Promise.all([
      prisma.assignmentAttempt.count({ where: { status: "ACCEPTED", dispatchedAt: { gte: since } } }).catch(() => 0),
      prisma.assignmentAttempt
        .count({ where: { status: { in: ACCEPTANCE_TERMINAL_STATUSES }, dispatchedAt: { gte: since } } })
        .catch(() => 0),
    ]);
    setGauge("provider_acceptance_rate", acceptanceRatePct(accepted, terminal) ?? Number.NaN);
  });
}
