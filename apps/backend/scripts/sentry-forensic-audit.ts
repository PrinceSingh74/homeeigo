/**
 * Sentry Forensic Audit — query Postgres logs, activity, ops alerts.
 *   bun --env-file=.env run scripts/sentry-forensic-audit.ts
 */
import { writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import "../src/load-env";
import prisma from "../src/lib/prisma";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..", "..");
const OUT = join(REPO, "sentry-forensic-evidence.json");

async function main() {
  const since30d = new Date(Date.now() - 30 * 24 * 3600_000);
  const since7d = new Date(Date.now() - 7 * 24 * 3600_000);

  const [
    logLevels,
    prismaErrors,
    unhandledErrors,
    validationLogs,
    badRequestLogs,
    httpErrors,
    activityFailures,
    opsAlerts,
    recentUnhandled,
    prismaByMessage,
  ] = await Promise.all([
    prisma.$queryRaw<Array<{ level: string; cnt: bigint }>>`
      SELECT level, COUNT(*)::bigint AS cnt FROM app_log_entries
      WHERE created_at >= ${since30d} GROUP BY level ORDER BY cnt DESC`,
    prisma.$queryRaw<Array<{ pattern: string; cnt: bigint }>>`
      SELECT
        CASE
          WHEN message ILIKE '%P2024%' THEN 'P2024_pool_timeout'
          WHEN message ILIKE '%P2034%' THEN 'P2034_write_conflict'
          WHEN message ILIKE '%P2010%' THEN 'P2010_raw_query_failed'
          WHEN message ILIKE '%P2028%' THEN 'P2028_transaction_timeout'
          WHEN message ILIKE '%P2037%' THEN 'P2037_connection_exhausted'
          WHEN message ILIKE '%P2002%' THEN 'P2002_unique_violation'
          WHEN message ILIKE '%P1001%' OR message ILIKE '%P1000%' THEN 'P100x_connection'
          WHEN message ILIKE '%PrismaClientKnownRequestError%' THEN 'PrismaClientKnownRequestError_other'
          WHEN message ILIKE '%PrismaClientUnknownRequestError%' THEN 'PrismaClientUnknownRequestError'
          WHEN message ILIKE '%prisma%' THEN 'prisma_other'
          ELSE 'other'
        END AS pattern,
        COUNT(*)::bigint AS cnt
      FROM app_log_entries
      WHERE created_at >= ${since30d}
        AND (message ILIKE '%prisma%' OR message ILIKE '%P20%')
      GROUP BY 1 ORDER BY cnt DESC`,
    prisma.$queryRaw<Array<{ cnt: bigint }>>`
      SELECT COUNT(*)::bigint AS cnt FROM app_log_entries
      WHERE created_at >= ${since30d} AND message ILIKE '%unhandled error%'`,
    prisma.$queryRaw<Array<{ cnt: bigint }>>`
      SELECT COUNT(*)::bigint AS cnt FROM app_log_entries
      WHERE created_at >= ${since30d}
        AND (message ILIKE '%validation%' OR metadata ILIKE '%VALIDATION_ERROR%')`,
    prisma.$queryRaw<Array<{ cnt: bigint }>>`
      SELECT COUNT(*)::bigint AS cnt FROM app_log_entries
      WHERE created_at >= ${since30d}
        AND (message ILIKE '%bad request%' OR metadata ILIKE '%"status":400%' OR metadata ILIKE '%statusCode":400%')`,
    prisma.$queryRaw<Array<{ status: string; cnt: bigint }>>`
      SELECT
        COALESCE(
          NULLIF(regexp_replace(metadata, '.*"status"\\s*:\\s*(\\d+).*', '\\1'), metadata),
          'unknown'
        ) AS status,
        COUNT(*)::bigint AS cnt
      FROM app_log_entries
      WHERE created_at >= ${since7d}
        AND category = 'APPLICATION'
        AND metadata IS NOT NULL
        AND message ILIKE '%request.completed%'
      GROUP BY 1
      ORDER BY cnt DESC
      LIMIT 20`,
    prisma.$queryRaw<Array<{ action: string; cnt: bigint }>>`
      SELECT action, COUNT(*)::bigint AS cnt FROM activity_logs
      WHERE created_at >= ${since30d}
      GROUP BY action ORDER BY cnt DESC LIMIT 15`,
    prisma.$queryRaw<Array<{ alert_type: string; severity: string; cnt: bigint; sample: string }>>`
      SELECT alert_type, severity::text, COUNT(*)::bigint AS cnt,
        MIN(message) AS sample
      FROM ops_alerts
      WHERE created_at >= ${since30d}
      GROUP BY alert_type, severity ORDER BY cnt DESC LIMIT 20`,
    prisma.$queryRaw<
      Array<{ id: string; message: string; metadata: string | null; request_id: string | null; created_at: Date }>
    >`
      SELECT id, message, metadata, request_id, created_at
      FROM app_log_entries
      WHERE created_at >= ${since30d} AND message ILIKE '%unhandled error%'
      ORDER BY created_at DESC LIMIT 10`,
    prisma.$queryRaw<Array<{ msg: string; cnt: bigint }>>`
      SELECT LEFT(message, 200) AS msg, COUNT(*)::bigint AS cnt
      FROM app_log_entries
      WHERE created_at >= ${since30d}
        AND level IN ('error', 'fatal')
      GROUP BY 1 ORDER BY cnt DESC LIMIT 20`,
  ]);

  const sentryProbe = process.env.SENTRY_DSN ? "configured" : "missing";
  let sentryApiStatus = "skipped_no_auth_token";
  if (process.env.SENTRY_AUTH_TOKEN && process.env.SENTRY_ORG && process.env.SENTRY_PROJECT) {
    try {
      const url = `https://sentry.io/api/0/projects/${process.env.SENTRY_ORG}/${process.env.SENTRY_PROJECT}/issues/?statsPeriod=14d&query=is:unresolved`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${process.env.SENTRY_AUTH_TOKEN}` } });
      sentryApiStatus = res.ok ? `ok_${res.status}` : `fail_${res.status}`;
    } catch (e) {
      sentryApiStatus = `error_${e instanceof Error ? e.message : String(e)}`;
    }
  }

  const evidence = {
    generatedAt: new Date().toISOString(),
    window: { since30d: since30d.toISOString(), since7d: since7d.toISOString() },
    sentry: { dsn: sentryProbe, api: sentryApiStatus },
    logLevels: logLevels.map((r) => ({ level: r.level, count: Number(r.cnt) })),
    prismaErrors: prismaErrors.map((r) => ({ pattern: r.pattern, count: Number(r.cnt) })),
    unhandledErrorCount30d: Number(unhandledErrors[0]?.cnt ?? 0),
    validationLogCount30d: Number(validationLogs[0]?.cnt ?? 0),
    badRequestLogCount30d: Number(badRequestLogs[0]?.cnt ?? 0),
    httpStatusBreakdown7d: httpErrors.map((r) => ({ status: r.status, count: Number(r.cnt) })),
    activityFailures: activityFailures.map((r) => ({ action: r.action, count: Number(r.cnt) })),
    opsAlerts: opsAlerts.map((r) => ({
      alertType: r.alert_type,
      severity: r.severity,
      count: Number(r.cnt),
      sample: r.sample,
    })),
    topErrorMessages: prismaByMessage.map((r) => ({ message: r.msg, count: Number(r.cnt) })),
    recentUnhandled: recentUnhandled.map((r) => ({
      id: r.id,
      message: r.message,
      requestId: r.request_id,
      metadata: r.metadata,
      createdAt: r.created_at.toISOString(),
    })),
  };

  await writeFile(OUT, JSON.stringify(evidence, null, 2), "utf8");
  console.log(JSON.stringify(evidence, null, 2));
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
