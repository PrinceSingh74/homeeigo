import prisma from "../lib/prisma";
import { logger } from "../lib/logger";
import { modelRegistryEntries } from "../lib/model-identity";
import { geoIntelligenceService, DEMAND_FORECAST_UNAVAILABLE } from "./geo-intelligence.service";
import { isDemandForecastStale } from "./shift-planning.service";

/**
 * Phase 9, Capability 7 — forecast explanations.
 *
 * ── Three things the sources get wrong, surfaced rather than repeated ──────────
 *
 * **Confidence is derived and clamped, not published by the model.**
 * `geoIntelligenceService.demandForecast()` computes
 * `clamp(1 - mean((hi - lo) / (2 * max(predicted, 1))), 0.5, 0.97)` — the exact
 * interval-to-percentage conversion this capability must not repeat. Observed live at **0.50**,
 * which is the clamp *floor*: the true derived value was at or below it, so the clamp is hiding how
 * wide the intervals actually are. It is reported as `derivedConfidence` with its formula, never as
 * model confidence.
 *
 * **`freshness` is the retrieval time, not the forecast's generation time.** The wrapper sets
 * `new Date().toISOString()` when it fills its cache. ARIMA exposes no generation timestamp at all,
 * so `forecastGeneratedAt` is `UNAVAILABLE` rather than filled with the fetch time. (The Capability-1
 * comment that called it "the model's own timestamp" was wrong and has been corrected.)
 *
 * **`zone_id` is not a zone.** The only value ARIMA returns is the literal string `"unzoned"`, which
 * matches no geofence id. Scope is therefore GLOBAL, and it is validated against real geofences at
 * runtime rather than assumed from the field's name.
 *
 * ── What is authoritative ──────────────────────────────────────────────────────
 *
 * The prediction interval is real: the query asks for `0.8 AS confidence_level`, so `lo`/`hi` are an
 * 80% prediction interval and may be described as one. Model identity and version are real too —
 * `mlopsService.registry()` publishes `model_demand_forecast v1 ARIMA_PLUS TRAINED`.
 */

export const FORECAST_EXPLAINER_RULES_VERSION = "exec.forecast.v1";

/** The confidence level the ARIMA query requests. Read from the source, not chosen here. */
export const PREDICTION_INTERVAL_LEVEL = 0.8;

export type ForecastState =
  | "FORECAST_AVAILABLE"
  | "FORECAST_STALE"
  | "FORECAST_UNAVAILABLE"
  | "MODEL_UNAVAILABLE"
  | "INSUFFICIENT_DATA";

export type ForecastScope = "GLOBAL" | "ZONE" | "CITY";

export const FORECAST_REASON = {
  HORIZON_ELAPSED: "FORECAST_HORIZON_ELAPSED",
  NO_POINTS: "FORECAST_NO_POINTS",
  SOURCE_UNAVAILABLE: DEMAND_FORECAST_UNAVAILABLE,
  GENERATED_AT_UNAVAILABLE: "FORECAST_GENERATED_AT_UNAVAILABLE",
  MODEL_VERSION_UNAVAILABLE: "MODEL_VERSION_UNAVAILABLE",
  UNZONED_SCOPE: "FORECAST_SCOPE_UNZONED",
  DRIFT_MONITORING_UNAVAILABLE: "DRIFT_MONITORING_UNAVAILABLE",
  DERIVED_CONFIDENCE_NOT_MODEL_CONFIDENCE: "DERIVED_CONFIDENCE_NOT_MODEL_CONFIDENCE",
  /** The interval extends below zero for a quantity that cannot be negative. */
  INTERVAL_PHYSICALLY_IMPOSSIBLE: "INTERVAL_PHYSICALLY_IMPOSSIBLE",
} as const;

export type PredictionInterval = {
  /** Point estimate summed across the horizon, exactly as the source reports it. */
  point: number;
  lower: number;
  upper: number;
  /** The level the source requested. Described as a prediction interval, never an "error margin". */
  level: number;
};

export type ForecastExplanation = {
  metric: string;
  state: ForecastState;
  /** Always the forecast value — never presented as an actual. */
  value: number | null;
  unit: string;
  /** Explicit, so a reader can never mistake this for an observation. */
  valueKind: "FORECAST";
  scope: ForecastScope;
  /** Why the scope is what it is, e.g. the zone id was `unzoned`. */
  scopeReason: string;
  /** When the model produced the forecast. Null when the source does not expose it. */
  forecastGeneratedAt: string | null;
  /** When the platform fetched it. Distinct from the above, and labelled. */
  retrievedAt: string | null;
  /** The window the forecast is about, read from the predicted hours themselves. */
  forecastFor: { from: string | null; to: string | null; horizonHours: number | null };
  model: string | null;
  modelVersion: string | null;
  modelStatus: string | null;
  /** Present only when the source publishes bounds. */
  interval: PredictionInterval | null;
  /**
   * The wrapper's derived figure, carried with its provenance so it can never be read as the
   * model's own confidence.
   */
  derivedConfidence: { value: number; formula: string; clamped: boolean } | null;
  /** Model confidence as published by the model. Null — ARIMA_PLUS publishes none. */
  modelConfidence: null;
  freshness: "CURRENT" | "STALE" | "UNKNOWN";
  limitations: string[];
  evidence: Array<{ signal: string; value: number | string | null; source: string }>;
  reasonCode?: string;
  rulesVersion: string;
  generatedAt: string;
};

export type ModelInventoryEntry = {
  model: string;
  version: string;
  type: string;
  status: string;
  /** True only when the registry says TRAINED. A blocked model is never described as usable. */
  usable: boolean;
};

/** Wording that would turn a forecast into a promise. Asserted absent by test. */
const FORBIDDEN_TERMS = ["will definitely", "guaranteed", "certain", "assured"] as const;

export const forecastExplainerService = {
  /**
   * Explain the demand forecast.
   *
   * Everything is quoted. The only computation is the interval sum across the horizon, which is
   * addition of numbers the source already produced, and the scope validation, which is a lookup
   * rather than a judgement.
   */
  async explainDemandForecast(opts?: { now?: Date }): Promise<ForecastExplanation> {
    const now = opts?.now ?? new Date();
    const generatedAt = now.toISOString();

    /**
     * Model identity is resolved BEFORE the forecast source is consulted.
     *
     * It used to be read after, which meant the `catch` below returned the shell's hardcoded
     * `modelVersion: null` whenever the source failed — so an explanation that said "the forecast
     * source did not respond" could not say WHICH model had not responded, even though the registry
     * knew perfectly well. A null written by a shell literal is exactly the defaulting this method
     * claims not to do: the identity of a model does not depend on whether its data source answered.
     *
     * If the registry itself is unavailable the version stays null, which is then an honest absence
     * rather than a discarded answer.
     */
    const registry = await this.modelInventory();
    const entry = registry.find((m) => m.model === "model_demand_forecast") ?? null;

    const shell = {
      metric: "demand",
      unit: "bookings",
      valueKind: "FORECAST" as const,
      modelConfidence: null as null,
      rulesVersion: FORECAST_EXPLAINER_RULES_VERSION,
      generatedAt,
      value: null,
      interval: null,
      derivedConfidence: null,
      forecastGeneratedAt: null,
      retrievedAt: null,
      model: "model_demand_forecast",
      modelVersion: entry?.version ?? null,
      modelStatus: entry?.status ?? null,
      evidence: [] as ForecastExplanation["evidence"],
      forecastFor: { from: null, to: null, horizonHours: null },
    };

    let res: Awaited<ReturnType<typeof geoIntelligenceService.demandForecast>>;
    try {
      res = await geoIntelligenceService.demandForecast(24);
    } catch (err) {
      logger.warn("forecast_explainer_source_unavailable", { error: String(err).slice(0, 200) });
      return {
        ...shell,
        state: "FORECAST_UNAVAILABLE",
        scope: "GLOBAL",
        scopeReason: "source unavailable",
        freshness: "UNKNOWN",
        limitations: ["The forecast source did not respond."],
        reasonCode: FORECAST_REASON.SOURCE_UNAVAILABLE,
      };
    }

    const data = res.data as {
      horizonHours?: number;
      totalPredicted?: number;
      points?: Array<{ zone_id?: string; hour?: string; predicted?: number; lo?: number; hi?: number }>;
    } | null;
    const points = Array.isArray(data?.points) ? data!.points! : [];

    if (points.length === 0) {
      return {
        ...shell,
        state: "INSUFFICIENT_DATA",
        scope: "GLOBAL",
        scopeReason: "no points returned",
        modelVersion: entry?.version ?? null,
        modelStatus: entry?.status ?? null,
        retrievedAt: res.freshness ?? null,
        freshness: "UNKNOWN",
        limitations: ["The model returned no forecast points."],
        reasonCode: FORECAST_REASON.NO_POINTS,
      };
    }

    /**
     * Scope is validated, not inferred from the field name.
     *
     * A `zone_id` column does not make a forecast zone-scoped. The values are checked against real
     * geofence ids; anything that matches none — `"unzoned"` in practice — is global.
     */
    const zoneIds = [...new Set(points.map((p) => String(p.zone_id ?? "")))];
    const realZones = await prisma.geofence.findMany({
      where: { id: { in: zoneIds } },
      select: { id: true },
    });
    const scope: ForecastScope = realZones.length > 0 ? "ZONE" : "GLOBAL";
    const scopeReason = realZones.length > 0
      ? `${realZones.length} of ${zoneIds.length} zone id(s) match a geofence`
      : `no zone id matches a geofence (values: ${zoneIds.join(", ")})`;

    const hours = points.map((p) => String(p.hour ?? "")).filter(Boolean).sort();
    const forecastFor = {
      from: hours.length > 0 ? hours[0]! : null,
      to: hours.length > 0 ? hours[hours.length - 1]! : null,
      horizonHours: data?.horizonHours ?? null,
    };

    const point = data?.totalPredicted ?? 0;
    const lower = Math.round(points.reduce((s, p) => s + (p.lo ?? 0), 0) * 100) / 100;
    const upper = Math.round(points.reduce((s, p) => s + (p.hi ?? 0), 0) * 100) / 100;

    const stale = isDemandForecastStale(res.freshness ?? null, data, now.getTime());

    /**
     * The wrapper's confidence, carried with its formula.
     *
     * `0.5` is the clamp floor, so a value exactly at it means the derivation went at least that low
     * and was cut off. Reporting that is the difference between a number and a number a reader can
     * evaluate.
     */
    const derived = typeof res.confidence === "number"
      ? {
          value: res.confidence,
          formula: "clamp(1 - mean((hi - lo) / (2 * max(predicted, 1))), 0.5, 0.97) — computed by " +
            "geo-intelligence from interval width, not published by the model",
          clamped: res.confidence <= 0.5 || res.confidence >= 0.97,
        }
      : null;

    const limitations: string[] = [
      "The model does not expose when it generated this forecast, so only the retrieval time is known.",
      "The model publishes no confidence score; the interval is an " +
        PREDICTION_INTERVAL_LEVEL * 100 + "% prediction interval.",
    ];
    if (scope === "GLOBAL") {
      limitations.push("This forecast is not zone-scoped and must not be attributed to any zone.");
    }
    if (derived?.clamped) {
      limitations.push("The derived confidence figure sits at a clamp boundary, so it understates the spread.");
    }
    /**
     * An interval that extends below zero for a count is a statement the world cannot satisfy.
     *
     * Measured live: a point estimate of 48.7 bookings carried an 80% interval of
     * [-39.12, 136.66]. Bookings cannot be negative, so the lower bound is not a possible outcome —
     * it is evidence that the interval is too wide to inform a decision, which is also why the
     * derived confidence figure sat on its clamp floor. Flagged rather than silently truncated to
     * zero: clipping it would make an uninformative forecast look usable.
     */
    if (lower < 0) {
      limitations.push(
        "The " + PREDICTION_INTERVAL_LEVEL * 100 + "% interval extends below zero (" + lower +
        "), which is not a possible booking count. The interval is too wide to be informative.",
      );
    }
    limitations.push("No drift monitoring exists for this model.");

    const evidence: ForecastExplanation["evidence"] = [
      { signal: "POINTS", value: points.length, source: "bigquery:arima_plus" },
      { signal: "TOTAL_PREDICTED", value: point, source: "bigquery:arima_plus" },
      { signal: "INTERVAL_LOWER", value: lower, source: "bigquery:arima_plus" },
      { signal: "INTERVAL_UPPER", value: upper, source: "bigquery:arima_plus" },
      { signal: "INTERVAL_LEVEL", value: PREDICTION_INTERVAL_LEVEL, source: "ML.FORECAST confidence_level" },
      { signal: "FIRST_PREDICTED_HOUR", value: forecastFor.from, source: "bigquery:arima_plus" },
      { signal: "LAST_PREDICTED_HOUR", value: forecastFor.to, source: "bigquery:arima_plus" },
      { signal: "ZONE_IDS", value: zoneIds.join(","), source: "bigquery:arima_plus" },
      { signal: "MODEL_STATUS", value: entry?.status ?? null, source: "mlops:registry" },
    ];

    return {
      ...shell,
      state: stale ? "FORECAST_STALE" : "FORECAST_AVAILABLE",
      value: point,
      scope,
      scopeReason,
      /** ARIMA exposes no generation timestamp; the fetch time is reported separately. */
      forecastGeneratedAt: null,
      retrievedAt: res.freshness ?? null,
      forecastFor,
      modelVersion: entry?.version ?? null,
      modelStatus: entry?.status ?? null,
      interval: { point, lower, upper, level: PREDICTION_INTERVAL_LEVEL },
      derivedConfidence: derived,
      freshness: stale ? "STALE" : "CURRENT",
      limitations,
      evidence,
      ...(stale
        ? { reasonCode: FORECAST_REASON.HORIZON_ELAPSED }
        : lower < 0
          ? { reasonCode: FORECAST_REASON.INTERVAL_PHYSICALLY_IMPOSSIBLE }
          : {}),
    };
  },

  /**
   * The model registry, carried through with its real statuses.
   *
   * `usable` is TRAINED and nothing else — a BLOCKED or PARTIALLY_TRAINED model must never be
   * described as one an executive can rely on.
   */
  async modelInventory(): Promise<ModelInventoryEntry[]> {
    // Delegates to the shared resolver so this service and the executive surfaces cannot disagree
    // about what version a model is — see lib/model-identity.ts.
    return modelRegistryEntries();
  },

  /** Exposed so a test asserts the forbidden vocabulary rather than restating it. */
  forbiddenTerms(): readonly string[] {
    return FORBIDDEN_TERMS;
  },
};
