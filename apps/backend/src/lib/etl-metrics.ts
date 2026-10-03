/**
 * Phase 1 ETL / Data Platform Prometheus metrics — extends Phase 0 observability.
 */
import { incCounter, setGauge, observeHist, registerScrapeSampler } from "./metrics";

type EtlMetricInput = {
  jobId: string;
  domain: string;
  status: "success" | "failure";
  durationMs: number;
  rowsLoaded: number;
  runMode: string;
};

export function recordEtlMetrics(input: EtlMetricInput): void {
  incCounter("homigo_etl_jobs_total", { job_id: input.jobId, domain: input.domain, status: input.status, run_mode: input.runMode });
  observeHist("homigo_etl_duration_seconds", input.durationMs / 1000, { job_id: input.jobId });
  if (input.status === "success") {
    incCounter("homigo_etl_rows_loaded_total", { job_id: input.jobId }, input.rowsLoaded);
  }
}

export function recordSchedulerMetrics(input: { trigger: string; status: string; durationMs: number; jobsRun: number }): void {
  incCounter("homigo_etl_scheduler_runs_total", { trigger: input.trigger, status: input.status });
  observeHist("homigo_etl_scheduler_duration_seconds", input.durationMs / 1000, { trigger: input.trigger });
  setGauge("homigo_etl_scheduler_jobs_last_run", input.jobsRun);
}

export function recordDataQualityMetrics(score: number, criticalFailures: number, warnings: number): void {
  setGauge("homigo_data_quality_score", score);
  setGauge("homigo_data_quality_critical_failures", criticalFailures);
  setGauge("homigo_data_quality_warnings", warnings);
}

export function recordFreshnessMetrics(dataset: string, lagSeconds: number | null, freshnessScore: number, slaMet: boolean): void {
  setGauge("homigo_data_freshness_lag_seconds", lagSeconds ?? -1, { dataset });
  setGauge("homigo_data_freshness_score", freshnessScore, { dataset });
  setGauge("homigo_data_freshness_sla_met", slaMet ? 1 : 0, { dataset });
}

export function recordForecastMetrics(modelName: string, durationMs: number, horizon: number): void {
  observeHist("homigo_forecast_runtime_seconds", durationMs / 1000, { model: modelName });
  setGauge("homigo_forecast_horizon", horizon, { model: modelName });
}

export function recordFeatureGenerationMetrics(group: string, rowCount: number, durationMs: number): void {
  incCounter("homigo_feature_generation_total", { group }, rowCount);
  observeHist("homigo_feature_generation_duration_seconds", durationMs / 1000, { group });
}

/**
 * An ETL execution row is created as RUNNING and finalized to SUCCEEDED / RECOVERING / FAILED by
 * `finalizeExecution`. If the process dies mid-run, nothing finalizes it and the row stays RUNNING
 * forever.
 *
 * Beyond this age a RUNNING row is not running. It is the residue of a process that went away.
 * Twelve hours is far longer than any observed successful run, so nothing healthy is misreported.
 */
const ETL_ABANDONED_AFTER_MS = 12 * 60 * 60 * 1000;

export function registerEtlMetricSamplers(): void {
  registerScrapeSampler(async () => {
    try {
      const { default: prisma } = await import("./prisma");
      const abandonedBefore = new Date(Date.now() - ETL_ABANDONED_AFTER_MS);

      /**
       * `homigo_etl_jobs_running` used to be `count(status = 'RUNNING')` with no age condition. On
       * 2026-09-21 that read **111** — every one of them a crashed execution, the oldest from
       * 2026-08-07 and the newest from 2026-09-04, with the pipeline itself having produced no
       * successful run since 2026-08-19. A gauge that reports 111 concurrent ETL jobs on a dead
       * pipeline is not a small inaccuracy: it is the number an operator would use to decide the
       * pipeline was busy rather than broken.
       *
       * The two populations are now counted separately, because they call for opposite responses —
       * "in flight, wait" versus "abandoned, investigate".
       */
      const [running, abandoned, failed24h, recovering24h] = await Promise.all([
        prisma.etlJobExecution.count({ where: { status: "RUNNING", startedAt: { gte: abandonedBefore } } }),
        prisma.etlJobExecution.count({ where: { status: "RUNNING", startedAt: { lt: abandonedBefore } } }),
        prisma.etlJobExecution.count({
          where: { status: "FAILED", createdAt: { gte: new Date(Date.now() - 86400_000) } },
        }),
        prisma.etlJobExecution.count({
          where: { status: "RECOVERING", createdAt: { gte: new Date(Date.now() - 86400_000) } },
        }),
      ]);

      setGauge("homigo_etl_jobs_running", running);
      /** Crashed mid-run and never finalized. Non-zero means executions are being lost. */
      setGauge("homigo_etl_jobs_abandoned", abandoned);
      setGauge("homigo_etl_jobs_failed_24h", failed24h);
      /**
       * Retry attempts in the last day. Sustained non-zero with zero successes is the signature of
       * a pipeline failing for a reason retrying cannot fix — which is exactly what BigQuery
       * billing being disabled produced here.
       */
      setGauge("homigo_etl_jobs_recovering_24h", recovering24h);
    } catch {
      /* DB unavailable */
    }
  });
}

export function initEtlMetricsAtZero(): void {
  for (const domain of ["booking", "partner", "payment", "wallet", "ledger", "fraud", "location"]) {
    incCounter("homigo_etl_jobs_total", { job_id: `etl.${domain}`, domain, status: "success", run_mode: "INCREMENTAL" }, 0);
    incCounter("homigo_etl_jobs_total", { job_id: `etl.${domain}`, domain, status: "failure", run_mode: "INCREMENTAL" }, 0);
  }
  incCounter("homigo_etl_scheduler_runs_total", { trigger: "interval", status: "success" }, 0);
  incCounter("homigo_etl_scheduler_runs_total", { trigger: "interval", status: "failure" }, 0);
  setGauge("homigo_data_quality_score", 100);
  setGauge("homigo_data_quality_critical_failures", 0);
  setGauge("homigo_data_quality_warnings", 0);
  setGauge("homigo_etl_jobs_running", 0);
  // Initialised alongside the others so a dashboard shows 0 rather than NO-DATA before the first
  // scrape — an absent series and a healthy zero look the same on a panel, and only one is good news.
  setGauge("homigo_etl_jobs_abandoned", 0);
  setGauge("homigo_etl_jobs_recovering_24h", 0);
  setGauge("homigo_etl_jobs_failed_24h", 0);
}
