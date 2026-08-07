/**
 * HOMIGO MLOps Service (Phase-4 Track 5) — Vertex AI / BigQuery ML model platform.
 *
 * Reads the REAL BigQuery model registry + data-quality views and exposes them for the
 * AI-Operations API and Grafana. Honest by construction: status/metrics come straight from
 * the warehouse `model_registry` table (populated only after a model actually trains/evaluates).
 */
import { BigQuery } from "@google-cloud/bigquery";
import { cacheService } from "./cache.service";
import { setGauge, registerScrapeSampler } from "../lib/metrics";

const PROJECT_ID = process.env.GCP_PROJECT_ID ?? "homigo-497619";
const DATASET = process.env.BQ_DATASET ?? "homigo_analytics";
const LOCATION = process.env.BQ_LOCATION ?? "asia-south1";

let _bq: BigQuery | null = null;
const bq = () => (_bq ??= new BigQuery({ projectId: PROJECT_ID }));
async function q<T = Record<string, unknown>>(sql: string): Promise<T[]> {
  const [rows] = await bq().query({ query: sql, location: LOCATION });
  return rows as T[];
}

export type ModelRecord = { model_name: string; version: string; model_type: string; training_dataset: string; training_rows: number; status: string; lifecycle: string; owner: string; metrics: unknown; blocker_reason: string | null };

export class MlopsService {
  /** Full model registry with governance metrics + lifecycle + blockers. */
  async registry(): Promise<{ models: ModelRecord[]; summary: Record<string, number>; freshness: string }> {
    return cacheService.getOrFetch("mlops:registry", 60, async () => {
      const models = await q<ModelRecord>(`SELECT model_name, version, model_type, training_dataset, training_rows, status, lifecycle, owner, TO_JSON_STRING(metrics) AS metrics, blocker_reason FROM \`${PROJECT_ID}.${DATASET}.model_registry\` ORDER BY status, model_name`);
      const summary = models.reduce((a, m) => { a[m.status] = (a[m.status] ?? 0) + 1; return a; }, {} as Record<string, number>);
      return { models: models.map((m) => ({ ...m, metrics: safeJson(m.metrics) })), summary, freshness: new Date().toISOString() };
    }, 5);
  }

  /** Warehouse data-quality snapshot (row counts + integrity checks). */
  async dataQuality(): Promise<Record<string, unknown>> {
    return cacheService.getOrFetch("mlops:dq", 120, async () => {
      const [row] = await q(`SELECT * FROM \`${PROJECT_ID}.${DATASET}.dq_checks\``);
      return row ?? {};
    }, 5);
  }

  /** Roll-up model-platform health for the AI-ops dashboard + alerts. */
  async health(): Promise<{ total: number; trained: number; partial: number; blocked: number; productionModels: number; freshness: string }> {
    const { models } = await this.registry();
    return {
      total: models.length,
      trained: models.filter((m) => m.status === "TRAINED").length,
      partial: models.filter((m) => m.status === "PARTIALLY_TRAINED").length,
      blocked: models.filter((m) => m.status === "BLOCKED").length,
      productionModels: models.filter((m) => m.lifecycle === "production").length,
      freshness: new Date().toISOString(),
    };
  }

  /** Model metrics — MAE, RMSE, MAPE, Precision, Recall, F1, AUC, drift, timing. */
  async modelMetrics(): Promise<{ models: Array<Record<string, unknown>>; evaluatedAt: string }> {
    return cacheService.getOrFetch("mlops:metrics", 120, async () => {
      const models = await q<{ model_name: string; version: string; metrics: unknown; evaluated_at: unknown }>(
        `SELECT model_name, version, metrics, evaluated_at FROM \`${PROJECT_ID}.${DATASET}.model_registry\` WHERE metrics IS NOT NULL ORDER BY model_name`,
      );
      return {
        models: models.map((m) => ({
          modelName: m.model_name,
          version: m.version,
          metrics: safeJson(m.metrics),
          evaluatedAt: m.evaluated_at,
          mae: extractMetric(m.metrics, "mae"),
          rmse: extractMetric(m.metrics, "rmse"),
          mape: extractMetric(m.metrics, "mape"),
          precision: extractMetric(m.metrics, "precision"),
          recall: extractMetric(m.metrics, "recall"),
          f1: extractMetric(m.metrics, "f1_score"),
          auc: extractMetric(m.metrics, "auc"),
        })),
        evaluatedAt: new Date().toISOString(),
      };
    }, 5);
  }
}

function extractMetric(metrics: unknown, key: string): number | null {
  const obj = safeJson(metrics);
  if (obj && typeof obj === "object" && key in (obj as Record<string, unknown>)) {
    const v = (obj as Record<string, unknown>)[key];
    return typeof v === "number" ? v : null;
  }
  return null;
}

function safeJson(s: unknown): unknown { try { return typeof s === "string" ? JSON.parse(s) : s; } catch { return {}; } }

export const mlopsService = new MlopsService();

/** Live model-platform gauges for Grafana (registry counts by status). */
export function registerMlopsSamplers(): void {
  registerScrapeSampler(async () => {
    try {
      const h = await mlopsService.health();
      setGauge("ml_models_total", h.total);
      setGauge("ml_models_by_status", h.trained, { status: "trained" });
      setGauge("ml_models_by_status", h.partial, { status: "partially_trained" });
      setGauge("ml_models_by_status", h.blocked, { status: "blocked" });
      setGauge("ml_models_production", h.productionModels);
    } catch {
      /* registry unavailable — leave last-known gauges */
    }
  });
}
