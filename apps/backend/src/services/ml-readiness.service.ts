import prisma from "../lib/prisma";
import { logger } from "../lib/logger";
import { incCounter } from "../lib/metrics";
import { BigQuery } from "@google-cloud/bigquery";
import { assertBqAdcAvailable } from "../lib/bigquery-adc";

/**
 * Phase 12 — model data readiness, measured rather than asserted.
 *
 * ── The rule this enforces ─────────────────────────────────────────────────────
 *
 * Data justifies the model. Not the roadmap, not the fact that a registry row already exists, not
 * that a service of the same name is already deployed. Each assessment below counts real rows in
 * real tables and returns one of four states with the counts attached, so the decision to build or
 * not build is reviewable by someone who disagrees with it.
 *
 * ── Why leakage is computed, not reviewed ──────────────────────────────────────
 *
 * Two of this platform's model definitions leak, and neither is visible by reading the SQL quickly:
 *
 *   CLV    `avg_order_value` is `lifetime_revenue / completed`, and `lifetime_revenue` is the label.
 *          The label is reconstructable as `avg_order_value * completed` — exactly, for every row.
 *          That is why the recorded R² was 0.9994. It measured arithmetic, not customer value.
 *
 *   CHURN  the label is `IF(recency_days >= 30, 1, 0)` and `recency_days` is a feature. A model
 *          given that feature scores perfectly by restating the threshold.
 *
 * Both are checked numerically here — `exactReconstruction` counts rows where the label is
 * recoverable from features, and `labelDefiningFeature` names a feature the label is a function of.
 * A prose warning in a report is not a control; a count is.
 */

export const ML_READINESS_RULES_VERSION = "ml.readiness.v1";

export const READINESS = {
  DATA_READY: "DATA_READY",
  DATA_PARTIAL: "DATA_PARTIAL",
  DATA_INSUFFICIENT: "DATA_INSUFFICIENT",
  DATA_UNTRUSTED: "DATA_UNTRUSTED",
  NOT_APPLICABLE: "NOT_APPLICABLE",
} as const;
export type Readiness = (typeof READINESS)[keyof typeof READINESS];

export type LeakageFinding = {
  kind: "TARGET_RECONSTRUCTION" | "LABEL_DEFINING_FEATURE" | "NON_REPRODUCIBLE_DEFINITION" | "FUTURE_INFORMATION";
  detail: string;
  /** Rows affected where countable. Null when the finding is structural rather than per-row. */
  affectedRows: number | null;
  severity: "BLOCKING" | "WARNING";
};

export type ModelReadiness = {
  model: string;
  purpose: string;
  readiness: Readiness;
  /** Counts that produced the verdict. Every number here came from a query in this run. */
  evidence: Record<string, number | string | null>;
  leakage: LeakageFinding[];
  /** What would have to change for this to become DATA_READY. Never "more data" without a number. */
  blocker: string | null;
  decision: "BUILD_NOW" | "READINESS_ONLY" | "DATA_INSUFFICIENT" | "HUMAN_DECISION_REQUIRED" | "KEEP_EXISTING";
  source: string;
};

const P = process.env.GCP_PROJECT_ID ?? "homigo-497619";
const CURATED = process.env.BQ_DATASET ?? "homigo_analytics";
const ANALYTICS = `${CURATED}_analytics`;
const LOC = process.env.BQ_LOCATION ?? "asia-south1";

let _bq: BigQuery | null = null;
/**
 * Refuses before constructing the client under NODE_ENV=test without ADC — see
 * lib/bigquery-adc.ts. Without it this module made LIVE warehouse calls during tests, so the
 * suite's result depended on network reachability and on what the warehouse happened to hold.
 */
const bq = () => {
  assertBqAdcAvailable();
  return (_bq ??= new BigQuery({ projectId: P }));
};

/**
 * Warehouse reads return null on failure rather than throwing.
 *
 * The warehouse is a separate cloud system with its own billing and availability, and a readiness
 * report that 500s when BigQuery is down tells an operator nothing. A null propagates into the
 * evidence as `WAREHOUSE_UNAVAILABLE`, which is a different and more useful statement than zero.
 */
async function bqRows<T = Record<string, unknown>>(sql: string): Promise<T[] | null> {
  try {
    const [rows] = await bq().query({ query: sql, location: LOC });
    return rows as T[];
  } catch (err) {
    logger.warn("ml_readiness_warehouse_unavailable", { error: String(err).split("\n")[0].slice(0, 200) });
    return null;
  }
}

const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));

export const mlReadinessService = {
  /** Assess every Phase-12 model. One call, one reproducible snapshot. */
  async assessAll(): Promise<{
    models: ModelReadiness[];
    summary: Record<Readiness, number>;
    warehouseReachable: boolean;
    generatedAt: string;
    rulesVersion: string;
  }> {
    const models = await Promise.all([
      this.demand(), this.eta(), this.churn(), this.clv(),
      this.providerRanking(), this.recommendations(), this.gpsFraud(), this.supportClassification(),
    ]);
    const summary = models.reduce((a, m) => { a[m.readiness] = (a[m.readiness] ?? 0) + 1; return a; },
      {} as Record<Readiness, number>);
    const warehouseReachable = models.some((m) => m.evidence.warehouse !== "WAREHOUSE_UNAVAILABLE");
    for (const m of models) incCounter("ml_readiness_assessments_total", { model: m.model, readiness: m.readiness });
    return { models, summary, warehouseReachable, generatedAt: new Date().toISOString(), rulesVersion: ML_READINESS_RULES_VERSION };
  },

  // ── A. Demand ──────────────────────────────────────────────────────────────
  async demand(): Promise<ModelReadiness> {
    const source = `${P}.${ANALYTICS}.agg_daily_demand`;
    const rows = await bqRows<{ days: number; dup_days: number; total: number; lo: { value: string }; hi: { value: string }; zones: number }>(`
      WITH byday AS (
        SELECT DATE(day_ts) d, SUM(bookings) b, COUNT(*) c, COUNT(DISTINCT zone_id) z
          FROM \`${source}\` GROUP BY d
      )
      SELECT COUNT(*) AS days, COUNTIF(c > 1) AS dup_days, SUM(b) AS total,
             MIN(d) AS lo, MAX(d) AS hi, MAX(z) AS zones FROM byday
    `);
    if (!rows) {
      return {
        model: "demand_forecast", purpose: "Forecast booking volume per day.",
        readiness: READINESS.DATA_UNTRUSTED, evidence: { warehouse: "WAREHOUSE_UNAVAILABLE" }, leakage: [],
        blocker: "The warehouse could not be read, so demand readiness is unknown rather than zero.",
        decision: "READINESS_ONLY", source,
      };
    }
    const r = rows[0];
    const days = num(r?.days), dup = num(r?.dup_days), total = num(r?.total);
    const lastDate = r?.hi?.value ?? "";
    const ageDays = lastDate ? Math.floor((Date.now() - Date.parse(`${lastDate}T00:00:00Z`)) / 86_400_000) : -1;

    const leakage: LeakageFinding[] = [];
    if (dup > 0) {
      leakage.push({
        kind: "NON_REPRODUCIBLE_DEFINITION", severity: "WARNING", affectedRows: dup,
        detail: `${dup} date(s) appear more than once in the daily aggregate. Any training run silently sees a different total depending on whether duplicates are summed or de-duplicated.`,
      });
    }

    /**
     * Staleness is a readiness question, not just an operational one. A model retrained today on a
     * series that stops three weeks ago has learned a window that no longer describes the present,
     * and its holdout error will understate its live error.
     */
    let readiness: Readiness = READINESS.DATA_PARTIAL;
    let blocker: string | null;
    if (days < 45) {
      readiness = READINESS.DATA_INSUFFICIENT;
      blocker = `${days} distinct days observed; a daily model with weekly seasonality needs at least 45 to leave a holdout after training.`;
    } else if (ageDays > 7) {
      readiness = READINESS.DATA_UNTRUSTED;
      blocker = `The newest observation is ${ageDays} days old. The pipeline that fills this table is not running, so any model trained now is trained on history, not on current demand.`;
    } else {
      blocker = `${days} days is enough to evaluate but thin for seasonality; a candidate must beat the naive baseline before it is worth serving.`;
    }

    return {
      model: "demand_forecast",
      purpose: "Forecast booking volume per day.",
      readiness,
      evidence: {
        observedDays: days, duplicateDates: dup, totalBookings: total, distinctZones: num(r?.zones),
        firstDate: r?.lo?.value ?? null, lastDate: lastDate || null, dataAgeDays: ageDays,
        meanPerDay: days ? Math.round((total / days) * 100) / 100 : 0,
      },
      leakage, blocker,
      /**
       * Untrusted is not buildable.
       *
       * An earlier version of this mapped anything that was not DATA_INSUFFICIENT to BUILD_NOW, and
       * returned `DATA_UNTRUSTED` alongside `BUILD_NOW` — a contradiction that would have told an
       * operator to train on a series the pipeline stopped filling three weeks ago.
       */
      decision:
        readiness === READINESS.DATA_INSUFFICIENT ? "DATA_INSUFFICIENT"
        : readiness === READINESS.DATA_UNTRUSTED ? "READINESS_ONLY"
        : "BUILD_NOW",
      source,
    };
  },

  // ── B. ETA ─────────────────────────────────────────────────────────────────
  async eta(): Promise<ModelReadiness> {
    const source = "postgres:eta_training_labels";
    const [agg] = await prisma.$queryRawUnsafe<Array<{
      total: bigint; validated: bigint; training_ready: bigint; rejected: bigint;
      has_duration: bigint; has_distance: bigint; has_google: bigint; partners: bigint; lo: Date | null; hi: Date | null;
    }>>(`
      SELECT COUNT(*) AS total,
             COUNT(*) FILTER (WHERE status = 'VALIDATED')      AS validated,
             COUNT(*) FILTER (WHERE status = 'TRAINING_READY') AS training_ready,
             COUNT(*) FILTER (WHERE status = 'REJECTED')       AS rejected,
             COUNT(actual_travel_duration_min)                 AS has_duration,
             COUNT(travel_distance_meters)                     AS has_distance,
             COUNT(google_eta_minutes)                         AS has_google,
             COUNT(DISTINCT partner_hash)                      AS partners,
             MIN(created_at) AS lo, MAX(created_at) AS hi
        FROM eta_training_labels
    `);

    const trainingReady = num(agg?.training_ready);
    const hasDistance = num(agg?.has_distance);
    const hasDuration = num(agg?.has_duration);
    /** The gate the promotion path already declares. Not invented here. */
    const REQUIRED_LABELS = 50;

    return {
      model: "eta",
      purpose: "Predict partner travel duration to the customer.",
      readiness: trainingReady >= REQUIRED_LABELS ? READINESS.DATA_PARTIAL : READINESS.DATA_INSUFFICIENT,
      evidence: {
        totalLabels: num(agg?.total), validated: num(agg?.validated), trainingReady,
        rejected: num(agg?.rejected), withDurationLabel: hasDuration, withTravelDistance: hasDistance,
        withGoogleEta: num(agg?.has_google), distinctPartners: num(agg?.partners),
        requiredForTraining: REQUIRED_LABELS,
        firstLabel: agg?.lo ? new Date(agg.lo).toISOString().slice(0, 10) : null,
        lastLabel: agg?.hi ? new Date(agg.hi).toISOString().slice(0, 10) : null,
      },
      leakage: [],
      /**
       * The binding constraint is distance, not duration — a distinction that changes what has to be
       * fixed. 39 of 40 validated labels carry the outcome; only 5 carry travel distance, which is
       * the single most predictive input any ETA model has. Collecting more bookings will not help
       * until distance is captured on them.
       */
      blocker:
        `${trainingReady}/${REQUIRED_LABELS} labels are TRAINING_READY. The binding constraint is travel distance, not the outcome: ` +
        `${hasDuration} label(s) carry a duration but only ${hasDistance} carry travel_distance_meters. ` +
        `More bookings will not make this trainable until distance is captured at dispatch and arrival.`,
      decision: "DATA_INSUFFICIENT",
      source,
    };
  },

  // ── C. Churn ───────────────────────────────────────────────────────────────
  async churn(): Promise<ModelReadiness> {
    const source = `${P}.${CURATED}.vw_customer_churn_features`;
    const rows = await bqRows<{ n: number; churned: number; not_churned: number; leak_rows: number; min_rec: number; max_rec: number }>(`
      SELECT COUNT(*) AS n,
             COUNTIF(churned_30d = 1) AS churned,
             COUNTIF(churned_30d = 0) AS not_churned,
             -- The label restated from the feature it is defined by.
             COUNTIF(churned_30d = IF(recency_days >= 30, 1, 0)) AS leak_rows,
             MIN(recency_days) AS min_rec, MAX(recency_days) AS max_rec
        FROM \`${source}\`
    `);
    if (!rows) {
      return {
        model: "churn", purpose: "Predict customer churn.", readiness: READINESS.DATA_UNTRUSTED,
        evidence: { warehouse: "WAREHOUSE_UNAVAILABLE" }, leakage: [],
        blocker: "The warehouse could not be read.", decision: "READINESS_ONLY", source,
      };
    }
    const r = rows[0];
    const n = num(r?.n), churned = num(r?.churned), leak = num(r?.leak_rows);

    const leakage: LeakageFinding[] = [];
    if (n > 0 && leak === n) {
      leakage.push({
        kind: "LABEL_DEFINING_FEATURE", severity: "BLOCKING", affectedRows: leak,
        detail:
          `The label is defined as IF(recency_days >= 30, 1, 0) and recency_days is offered as a feature. ` +
          `The label is reproduced exactly from that feature in ${leak}/${n} rows, so any model trained on this ` +
          `view scores perfectly by restating the threshold and has learned nothing about churn.`,
      });
    }
    leakage.push({
      kind: "NON_REPRODUCIBLE_DEFINITION", severity: "BLOCKING", affectedRows: null,
      detail:
        "recency_days is computed against CURRENT_DATE(), so the label changes every day the query is run. " +
        "Two training runs a week apart see different labels for the same customers, and neither is reproducible.",
    });

    return {
      model: "churn",
      purpose: "Predict customer churn.",
      readiness: READINESS.DATA_INSUFFICIENT,
      evidence: {
        customers: n, churned, notChurned: num(r?.not_churned),
        labelReconstructedFromFeature: leak,
        minRecencyDays: num(r?.min_rec), maxRecencyDays: num(r?.max_rec),
      },
      leakage,
      blocker:
        `${n} customers with ${churned} churn events. Two things must change before this is trainable, and more rows fixes neither: ` +
        `the label must be defined on a fixed observation date rather than CURRENT_DATE(), and recency_days must be excluded from the features or ` +
        `the label must stop being a function of it.`,
      decision: "HUMAN_DECISION_REQUIRED",
      source,
    };
  },

  // ── D. CLV ─────────────────────────────────────────────────────────────────
  async clv(): Promise<ModelReadiness> {
    const source = `${P}.${CURATED}.vw_customer_clv`;
    const rows = await bqRows<{ n: number; exact: number; zero_rev: number; repeat: number; max_bookings: number; mean_rev: number }>(`
      SELECT COUNT(*) AS n,
             -- avg_order_value * completed reconstructs lifetime_revenue, which is the label.
             COUNTIF(ABS(IFNULL(avg_order_value, 0) * completed - lifetime_revenue) < 0.01) AS exact,
             COUNTIF(lifetime_revenue = 0) AS zero_rev,
             COUNTIF(bookings > 1) AS repeat,
             MAX(bookings) AS max_bookings,
             ROUND(AVG(lifetime_revenue), 2) AS mean_rev
        FROM \`${source}\`
    `);
    if (!rows) {
      return {
        model: "clv", purpose: "Predict customer lifetime value.", readiness: READINESS.DATA_UNTRUSTED,
        evidence: { warehouse: "WAREHOUSE_UNAVAILABLE" }, leakage: [],
        blocker: "The warehouse could not be read.", decision: "READINESS_ONLY", source,
      };
    }
    const r = rows[0];
    const n = num(r?.n), exact = num(r?.exact);

    const leakage: LeakageFinding[] = [];
    if (n > 0 && exact === n) {
      leakage.push({
        kind: "TARGET_RECONSTRUCTION", severity: "BLOCKING", affectedRows: exact,
        detail:
          `avg_order_value is lifetime_revenue / completed, and lifetime_revenue is the training label. ` +
          `The label is reconstructed exactly as avg_order_value * completed in ${exact}/${n} rows. ` +
          `A linear model given both features recovers the target by arithmetic — this is the mechanism behind the recorded R² of 0.9994, ` +
          `which measures the identity and not customer value.`,
      });
    }
    leakage.push({
      kind: "NON_REPRODUCIBLE_DEFINITION", severity: "WARNING", affectedRows: null,
      detail: "tenure_days and recency_days are computed against CURRENT_DATE(), so the feature values change every day the view is read.",
    });

    return {
      model: "clv",
      purpose: "Predict customer lifetime value.",
      readiness: READINESS.DATA_INSUFFICIENT,
      evidence: {
        customers: n, labelReconstructedFromFeatures: exact,
        zeroRevenueCustomers: num(r?.zero_rev), repeatCustomers: num(r?.repeat),
        maxBookingsOneCustomer: num(r?.max_bookings), meanLifetimeRevenue: num(r?.mean_rev),
      },
      leakage,
      blocker:
        `${n} customers, of whom ${num(r?.repeat)} booked more than once. A lifetime-value model needs repeat customers observed over a value horizon; ` +
        `this population has neither. The feature set must also drop avg_order_value before any figure it produces means anything.`,
      decision: "DATA_INSUFFICIENT",
      source,
    };
  },

  // ── E. Provider ranking / LTR ──────────────────────────────────────────────
  async providerRanking(): Promise<ModelReadiness> {
    const source = "postgres:provider_match_scores, assignment_attempts";
    const [r] = await prisma.$queryRawUnsafe<Array<{ scores: bigint; attempts: bigint; accepted: bigint; bookings: bigint }>>(`
      SELECT (SELECT COUNT(*) FROM provider_match_scores)                            AS scores,
             (SELECT COUNT(*) FROM assignment_attempts)                              AS attempts,
             (SELECT COUNT(*) FROM assignment_attempts WHERE status = 'ACCEPTED')    AS accepted,
             (SELECT COUNT(DISTINCT job_id) FROM assignment_attempts)                AS bookings
    `);
    const attempts = num(r?.attempts), accepted = num(r?.accepted);

    return {
      model: "provider_ranking_ltr",
      purpose: "Rank providers for a booking.",
      readiness: READINESS.DATA_INSUFFICIENT,
      evidence: {
        matchScoreRows: num(r?.scores), assignmentAttempts: attempts,
        acceptedAttempts: accepted, distinctBookings: num(r?.bookings),
        /**
         * DELIBERATELY NOT lib/acceptance-rate.ts. This is a training set's LABEL BALANCE — the
         * proportion of positive examples among all candidate rows — not a partner's willingness to
         * take work, so its denominator is every attempt rather than the terminal ones, and no time
         * window applies. Both counts are printed beside it, so the ratio cannot mislead on its own.
         */
        acceptanceRate: attempts ? Math.round((accepted / attempts) * 1000) / 1000 : 0,
      },
      leakage: [{
        kind: "FUTURE_INFORMATION", severity: "BLOCKING", affectedRows: null,
        detail:
          "provider_match_scores records what the existing rule scorer decided, not what a customer or outcome judged relevant. " +
          "Training a ranker on it teaches the model to imitate the rules it is meant to improve on, and the resulting feedback loop " +
          "means the only providers that can ever accumulate positive labels are the ones the rules already surfaced.",
      }],
      /**
       * The row count is read from this run, never quoted from a previous one. An earlier draft of
       * this text said "953k score rows"; a retention job has since pruned the table, and a blocker
       * that cites a number the reader cannot reproduce is indistinguishable from a fabricated one.
       */
      blocker:
        `No relevance label exists. Ranking needs an outcome saying which of the shown providers was the right one — acceptance is confounded ` +
        `by who was offered the job at all, and the ${num(r?.scores)} score rows present are the scorer's own output, not judgements of it.`,
      decision: "KEEP_EXISTING",
      source,
    };
  },

  // ── F. Personalised recommendations ────────────────────────────────────────
  async recommendations(): Promise<ModelReadiness> {
    const source = "postgres:ratings, bookings";
    const [r] = await prisma.$queryRawUnsafe<Array<{ ratings: bigint; customers: bigint; repeat_customers: bigint; services: bigint }>>(`
      SELECT (SELECT COUNT(*) FROM ratings)                                        AS ratings,
             (SELECT COUNT(DISTINCT user_id) FROM bookings)                        AS customers,
             (SELECT COUNT(*) FROM (SELECT user_id FROM bookings GROUP BY user_id HAVING COUNT(*) > 1) x) AS repeat_customers,
             (SELECT COUNT(*) FROM services WHERE is_active = true)                AS services
    `);
    return {
      model: "personalized_recommendations",
      purpose: "Recommend services to a specific customer.",
      readiness: READINESS.DATA_INSUFFICIENT,
      evidence: {
        ratings: num(r?.ratings), customers: num(r?.customers),
        repeatCustomers: num(r?.repeat_customers), activeServices: num(r?.services),
      },
      leakage: [{
        kind: "FUTURE_INFORMATION", severity: "WARNING", affectedRows: null,
        detail:
          "There is no impression log. Without a record of what was shown, a 'click' cannot be separated from 'was the only option displayed', " +
          "and any measured lift would be the layout's, not the model's.",
      }],
      blocker:
        `${num(r?.ratings)} ratings across ${num(r?.customers)} customers, of whom ${num(r?.repeat_customers)} booked more than once. ` +
        `Personalisation needs per-user preference signal; platform-wide popularity is not personalisation and must not be presented as it.`,
      decision: "DATA_INSUFFICIENT",
      source,
    };
  },

  // ── G. GPS fraud ───────────────────────────────────────────────────────────
  async gpsFraud(): Promise<ModelReadiness> {
    const source = "postgres:location_history, partner_risk_signals";
    const [r] = await prisma.$queryRawUnsafe<Array<{ pings: bigint; signals: bigint; partners: bigint; confirmed: bigint }>>(`
      SELECT (SELECT COUNT(*) FROM location_history)                                     AS pings,
             (SELECT COUNT(*) FROM partner_risk_signals)                                 AS signals,
             (SELECT COUNT(DISTINCT provider_id) FROM location_history)                  AS partners,
             (SELECT COUNT(*) FROM partner_safety_incidents WHERE resolved_at IS NOT NULL) AS confirmed
    `);
    return {
      model: "gps_fraud",
      purpose: "Detect location spoofing from movement patterns.",
      readiness: READINESS.DATA_INSUFFICIENT,
      evidence: {
        gpsPings: num(r?.pings), riskSignals: num(r?.signals),
        partnersWithLocation: num(r?.partners), resolvedIncidents: num(r?.confirmed),
      },
      leakage: [{
        kind: "LABEL_DEFINING_FEATURE", severity: "BLOCKING", affectedRows: null,
        detail:
          "The only available 'labels' are the rule detector's own firings (implied speed > 120 km/h). Training on them reproduces the rule " +
          "and cannot discover anything the rule misses, while inheriting every false positive as ground truth.",
      }],
      blocker:
        `${num(r?.pings)} location pings and ${num(r?.signals)} risk signals, with no adjudicated fraud outcomes. ` +
        `A trajectory classifier needs confirmed spoofing cases; the deterministic rules remain the control layer until those exist.`,
      decision: "KEEP_EXISTING",
      source,
    };
  },

  // ── H. Support classification ──────────────────────────────────────────────
  async supportClassification(): Promise<ModelReadiness> {
    const source = "postgres:support_tickets";
    const [r] = await prisma.$queryRawUnsafe<Array<{ tickets: bigint; categories: bigint; resolved: bigint; lo: Date | null; hi: Date | null }>>(`
      SELECT COUNT(*) AS tickets, COUNT(DISTINCT category) AS categories,
             COUNT(*) FILTER (WHERE status = 'RESOLVED') AS resolved,
             MIN(created_at) AS lo, MAX(created_at) AS hi
        FROM support_tickets
    `);
    const tickets = num(r?.tickets);
    return {
      model: "support_classification",
      purpose: "Classify support tickets by intent.",
      readiness: READINESS.DATA_INSUFFICIENT,
      evidence: {
        tickets, distinctCategories: num(r?.categories), resolved: num(r?.resolved),
        firstTicket: r?.lo ? new Date(r.lo).toISOString().slice(0, 10) : null,
        lastTicket: r?.hi ? new Date(r.hi).toISOString().slice(0, 10) : null,
      },
      leakage: [],
      blocker:
        `${tickets} tickets across ${num(r?.categories)} categories. Supervised classification would need thousands of human-labelled examples ` +
        `to beat the existing LLM classifier, and at this volume the LLM's per-ticket cost is not material enough for a trained model to pay for itself.`,
      decision: "KEEP_EXISTING",
      source,
    };
  },
};
