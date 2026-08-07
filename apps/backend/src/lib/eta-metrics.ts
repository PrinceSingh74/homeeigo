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

export function initEtaMetricsAtZero(): void {
  incCounter("homigo_eta_labels_total", { city: "unknown", status: "created" }, 0);
  incCounter("homigo_eta_label_failures_total", { reason: "validation" }, 0);
  incCounter("homigo_eta_label_failures_total", { reason: "bq_load" }, 0);
  incCounter("homigo_eta_distance_bucket", { bucket: "short" }, 0);
  incCounter("homigo_eta_distance_bucket", { bucket: "medium" }, 0);
  incCounter("homigo_eta_distance_bucket", { bucket: "long" }, 0);
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
