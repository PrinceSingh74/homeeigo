/**
 * Phase 2 ETA Intelligence Prometheus metrics — extends Phase 0/1 observability.
 * No ML inference metrics; collection and quality only.
 */
import { incCounter, setGauge, observeHist, registerScrapeSampler } from "./metrics";

export function recordEtaLabelCreated(city: string | null, qualityScore: number): void {
  incCounter("homigo_eta_labels_total", { city: city ?? "unknown", status: "created" });
  setGauge("homigo_eta_quality_score", qualityScore);
}

export function recordEtaLabelFailure(reason: string): void {
  incCounter("homigo_eta_label_failures_total", { reason });
}

export function recordEtaGoogleLatency(latencyMs: number, status: string): void {
  observeHist("homigo_eta_google_latency", latencyMs / 1000, { status });
}

export function recordEtaDistanceBucket(bucket: string): void {
  incCounter("homigo_eta_distance_bucket", { bucket });
}

export function recordEtaTrainingReady(count: number): void {
  setGauge("homigo_eta_training_ready", count);
}

export function recordEtaMissingLabels(count: number): void {
  setGauge("homigo_eta_missing_labels", count);
}

export function recordEtaCollectionLatency(durationMs: number): void {
  observeHist("homigo_eta_collection_latency", durationMs / 1000);
}

/**
 * Lifecycle transition outcome. `applied` is a real transition; `duplicate` is an
 * idempotent no-op. The ratio between the two proves the endpoints are safe to retry,
 * and the absolute `applied` counts expose the dispatched -> en_route -> arrived funnel
 * that previously collapsed 212 -> 3 -> 4 without any signal.
 */
export function recordEtaLifecycleTransition(
  transition: "en_route" | "arrived",
  source: string,
  result: "applied" | "duplicate",
): void {
  incCounter("homigo_eta_lifecycle_total", { transition, source, result });
}

/** Job-start arrival fallback. Previously invisible — its errors were swallowed. */
export function recordEtaJobStartFallback(result: "applied" | "duplicate" | "error"): void {
  incCounter("homigo_eta_job_start_fallback_total", { result });
}

/** Why a collected label did not reach TRAINING_READY. */
export function recordEtaTrainingExcluded(reason: string): void {
  incCounter("homigo_eta_training_excluded_total", { reason });
}

export function initEtaMetricsAtZero(): void {
  incCounter("homigo_eta_labels_total", { city: "unknown", status: "created" }, 0);
  incCounter("homigo_eta_label_failures_total", { reason: "validation" }, 0);
  incCounter("homigo_eta_label_failures_total", { reason: "bq_load" }, 0);
  incCounter("homigo_eta_distance_bucket", { bucket: "short" }, 0);
  incCounter("homigo_eta_distance_bucket", { bucket: "medium" }, 0);
  incCounter("homigo_eta_distance_bucket", { bucket: "long" }, 0);
  // Seed the funnel series so a zero reads as "no transitions yet" rather than NO DATA.
  for (const source of ["explicit_partner_action", "gps_geofence"]) {
    for (const result of ["applied", "duplicate"] as const) {
      incCounter("homigo_eta_lifecycle_total", { transition: "en_route", source, result }, 0);
      incCounter("homigo_eta_lifecycle_total", { transition: "arrived", source, result }, 0);
    }
  }
  incCounter("homigo_eta_lifecycle_total", { transition: "arrived", source: "job_start", result: "applied" }, 0);
  incCounter("homigo_eta_lifecycle_total", { transition: "arrived", source: "job_start", result: "duplicate" }, 0);
  for (const result of ["applied", "duplicate", "error"] as const) {
    incCounter("homigo_eta_job_start_fallback_total", { result }, 0);
  }
  incCounter("homigo_eta_training_excluded_total", { reason: "missing_travel_start" }, 0);
  incCounter("homigo_eta_training_excluded_total", { reason: "duration_below_min" }, 0);
  incCounter("homigo_eta_training_excluded_total", { reason: "duration_outlier" }, 0);
  setGauge("homigo_eta_training_ready", 0);
  setGauge("homigo_eta_missing_labels", 0);
  setGauge("homigo_eta_quality_score", 100);
}

export function registerEtaMetricSamplers(): void {
  registerScrapeSampler(async () => {
    try {
      const { default: prisma } = await import("./prisma");
      const [ready, missing, avgQuality] = await Promise.all([
        prisma.etaTrainingLabel.count({ where: { status: "TRAINING_READY" } }),
        prisma.etaTrainingLabel.count({ where: { status: "REJECTED" } }),
        prisma.etaTrainingLabel.aggregate({ _avg: { qualityScore: true } }),
      ]);
      setGauge("homigo_eta_training_ready", ready);
      setGauge("homigo_eta_missing_labels", missing);
      if (avgQuality._avg.qualityScore != null) {
        setGauge("homigo_eta_quality_score", avgQuality._avg.qualityScore);
      }
    } catch {
      /* DB unavailable */
    }
  });
}
