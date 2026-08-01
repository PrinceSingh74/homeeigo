/**
 * PHASE 6/8/9 — Log health: size/growth metrics, capacity forecast, and SELF-HEALING.
 *
 * A scrape sampler measures `app_log_entries` every Prometheus pull and:
 *  - emits gauges (size, rows/day, MB/day, 30/90/180/365-day projections) for the Grafana dashboard,
 *  - classifies the table size against the self-heal thresholds and, on breach, raises an ops alert
 *    and (at emergency level) triggers an immediate purge — so the explosion self-corrects.
 */
import { setGauge, registerScrapeSampler } from "./metrics";
import { classifyTableSize, forecastLogGrowth, SELF_HEAL_THRESHOLDS, type SelfHealAction } from "./log-governance";
import prisma from "./prisma";
import { logger } from "./logger";

const GROWTH_ALERT_MB_PER_DAY = Number(process.env.LOG_GROWTH_ALERT_MB_PER_DAY || 2);
let lastEmergencyPurgeAt = 0;
const EMERGENCY_PURGE_COOLDOWN_MS = 60 * 60 * 1000;

interface LogTableStats {
  sizeMB: number;
  rows: number;
  rowsPerDay: number;
  bytesPerRow: number;
}

async function measure(): Promise<LogTableStats> {
  const rows = await prisma.$queryRaw<Array<{ bytes: bigint; total: bigint; last24h: bigint }>>`
    SELECT pg_total_relation_size('app_log_entries') AS bytes,
           (SELECT count(*) FROM app_log_entries) AS total,
           (SELECT count(*) FROM app_log_entries WHERE created_at > now() - interval '1 day') AS last24h`;
  const r = rows[0];
  const bytes = Number(r?.bytes ?? 0n);
  const total = Number(r?.total ?? 0n);
  const rowsPerDay = Number(r?.last24h ?? 0n);
  return {
    sizeMB: Math.round((bytes / 1_048_576) * 100) / 100,
    rows: total,
    rowsPerDay,
    bytesPerRow: total > 0 ? Math.round(bytes / total) : 520,
  };
}

async function selfHeal(stats: LogTableStats, action: SelfHealAction): Promise<void> {
  setGauge("log_self_heal_level", { ok: 0, warn: 1, archive: 2, emergency_cleanup: 3, critical_alert: 4 }[action]);
  if (action === "ok") return;
  const { opsAlertService } = await import("../services/ops-alert.service");
  const sev = action === "critical_alert" ? "CRITICAL" : action === "emergency_cleanup" ? "CRITICAL" : "WARNING";
  await opsAlertService
    .raise("log_table_growth", sev, `app_log_entries self-heal: ${action} at ${stats.sizeMB} MB`, {
      sizeMB: stats.sizeMB, rows: stats.rows, action, thresholds: SELF_HEAL_THRESHOLDS,
    })
    .catch(() => undefined);
  // ≥500 MB → actually purge now (cooldown-guarded) so the table self-corrects without a human.
  if ((action === "emergency_cleanup" || action === "critical_alert") && Date.now() - lastEmergencyPurgeAt > EMERGENCY_PURGE_COOLDOWN_MS) {
    lastEmergencyPurgeAt = Date.now();
    logger.error("log_self_heal_emergency_purge_triggered", { sizeMB: stats.sizeMB });
    const { dataRetentionService } = await import("../services/data-retention.service");
    await dataRetentionService.purgeAppLogEntries().catch((e) => logger.error("log_self_heal_purge_failed", { error: String(e) }));
  }
}

export function registerLogHealthSamplers(): void {
  registerScrapeSampler(async () => {
    try {
      const stats = await measure();
      const retentionDays = Number(process.env.APP_LOG_RETENTION_DAYS ?? 30);
      const fc = forecastLogGrowth(stats.rowsPerDay, stats.bytesPerRow, retentionDays);

      setGauge("log_table_size_mb", stats.sizeMB);
      setGauge("log_rows_total", stats.rows);
      setGauge("log_rows_per_day", stats.rowsPerDay);
      setGauge("log_mb_per_day", fc.dailyMB);
      setGauge("log_projected_mb", fc.d30.boundedMB, { horizon: "30d" });
      setGauge("log_projected_mb", fc.d90.boundedMB, { horizon: "90d" });
      setGauge("log_projected_mb", fc.d180.boundedMB, { horizon: "180d" });
      setGauge("log_projected_mb", fc.d365.boundedMB, { horizon: "365d" });
      setGauge("log_projected_unbounded_mb", fc.d365.unboundedMB, { horizon: "365d" });

      if (fc.dailyMB > GROWTH_ALERT_MB_PER_DAY) {
        const { opsAlertService } = await import("../services/ops-alert.service");
        await opsAlertService
          .raise("log_growth_rate", "WARNING", `Log growth ${fc.dailyMB} MB/day exceeds ${GROWTH_ALERT_MB_PER_DAY} MB/day`, { mbPerDay: fc.dailyMB, rowsPerDay: stats.rowsPerDay })
          .catch(() => undefined);
      }
      await selfHeal(stats, classifyTableSize(stats.sizeMB));
    } catch (e) {
      logger.error("log_health_sampler_failed", { error: String(e) });
    }
  });
}
