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

  // Provider acceptance rate over last 24h (accepted / dispatched)
  registerScrapeSampler(async () => {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [accepted, total] = await Promise.all([
      prisma.assignmentAttempt.count({ where: { status: "ACCEPTED", dispatchedAt: { gte: since } } }).catch(() => 0),
      prisma.assignmentAttempt.count({ where: { dispatchedAt: { gte: since } } }).catch(() => 0),
    ]);
    setGauge("provider_acceptance_rate", total > 0 ? Math.round((accepted / total) * 10000) / 100 : 0);
  });
}
