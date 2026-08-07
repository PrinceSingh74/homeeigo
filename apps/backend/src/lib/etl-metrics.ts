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

export function registerEtlMetricSamplers(): void {
  registerScrapeSampler(async () => {
    try {
      const { default: prisma } = await import("./prisma");
      const pending = await prisma.etlJobExecution.count({ where: { status: "RUNNING" } });
      const failed24h = await prisma.etlJobExecution.count({
        where: { status: "FAILED", createdAt: { gte: new Date(Date.now() - 86400_000) } },
      });
      setGauge("homigo_etl_jobs_running", pending);
      setGauge("homigo_etl_jobs_failed_24h", failed24h);
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
  setGauge("homigo_etl_jobs_failed_24h", 0);
}
