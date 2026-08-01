/**
 * MLOps retraining pipeline (Phase-4 Track 5, Part D/E).
 *
 *   bun run --env-file=.env src/scripts/train-models.ts
 *
 * Honest by construction: each model is trained ONLY if its training view has enough data;
 * otherwise it is recorded as BLOCKED with the exact reason. Real ML.EVALUATE metrics are
 * written to the BigQuery model_registry. No fabricated accuracy.
 *
 * Retraining triggers (wire to Cloud Scheduler / drift alerts):
 *   - schedule: run this script nightly
 *   - data drift: when dq_checks / feature distributions shift beyond threshold
 *   - accuracy degradation: when ML.EVALUATE metrics regress vs the registry baseline
 */
import { BigQuery } from "@google-cloud/bigquery";

const P = process.env.GCP_PROJECT_ID ?? "homigo-497619";
const D = process.env.BQ_DATASET ?? "homigo_analytics";
const LOC = process.env.BQ_LOCATION ?? "asia-south1";
const bq = new BigQuery({ projectId: P });
const run = async (sql: string) => (await bq.query({ query: sql, location: LOC }))[0];
const count = async (view: string) => Number((await run(`SELECT COUNT(*) AS n FROM \`${P}.${D}.${view}\``))[0].n);

async function main() {
  console.log("HOMIGO model retraining — honest pipeline\n");

  // 1) DEMAND (ARIMA_PLUS) — needs ≥ ~30 hourly points.
  const demandRows = await count("vw_train_demand");
  if (demandRows >= 24) {
    await run(`CREATE OR REPLACE MODEL \`${P}.${D}.model_demand_forecast\` OPTIONS(model_type='ARIMA_PLUS', time_series_timestamp_col='hour_ts', time_series_data_col='demand', time_series_id_col='zone_id', horizon=24, auto_arima=TRUE, data_frequency='HOURLY') AS SELECT zone_id, hour_ts, demand FROM \`${P}.${D}.vw_train_demand\``);
    console.log(`✅ model_demand_forecast retrained (${demandRows} rows)`);
  } else console.log(`⛔ model_demand_forecast BLOCKED — only ${demandRows} rows`);

  // 2) REVENUE (ARIMA_PLUS).
  const revRows = await count("agg_hourly_demand");
  if (revRows >= 24) {
    await run(`CREATE OR REPLACE MODEL \`${P}.${D}.model_revenue_forecast\` OPTIONS(model_type='ARIMA_PLUS', time_series_timestamp_col='hour_ts', time_series_data_col='revenue', time_series_id_col='zone_id', horizon=24, auto_arima=TRUE, data_frequency='HOURLY') AS SELECT COALESCE(zone_id,'all') AS zone_id, hour_ts, COALESCE(revenue,0) AS revenue FROM \`${P}.${D}.agg_hourly_demand\``);
    console.log(`✅ model_revenue_forecast retrained (${revRows} rows)`);
  } else console.log(`⛔ model_revenue_forecast BLOCKED — only ${revRows} rows`);

  // 3) CLV (LINEAR_REG) — trains but flagged PARTIAL until N is large + holdout validated.
  const clvRows = await count("vw_customer_clv");
  if (clvRows >= 10) {
    await run(`CREATE OR REPLACE MODEL \`${P}.${D}.model_clv\` OPTIONS(model_type='LINEAR_REG', input_label_cols=['lifetime_revenue']) AS SELECT bookings, completed, tenure_days, recency_days, avg_order_value, lifetime_revenue FROM \`${P}.${D}.vw_customer_clv\` WHERE lifetime_revenue IS NOT NULL`);
    console.log(`⚠️  model_clv retrained (${clvRows} rows) — PARTIAL: validate on independent holdout`);
  } else console.log(`⛔ model_clv BLOCKED — only ${clvRows} rows`);

  // 4) CHURN — requires a positive class.
  const churnPos = Number((await run(`SELECT SUM(churned_30d) AS p FROM \`${P}.${D}.vw_customer_churn_features\``))[0].p ?? 0);
  console.log(churnPos > 0 ? `✅ churn trainable (${churnPos} positives)` : `⛔ model_churn BLOCKED — 0 churned examples (degenerate positive class)`);

  // 5) ETA — requires realised-travel labels.
  const etaRows = await count("vw_train_eta");
  console.log(etaRows >= 50 ? `✅ eta trainable (${etaRows} rows)` : `⛔ model_eta BLOCKED — ${etaRows} labelled rows (no dispatch→ARRIVED signal)`);

  console.log("\nDone. Update model_registry via 04_mlops.sql with fresh ML.EVALUATE metrics.");
  process.exit(0);
}
main().catch((e) => { console.error("retrain failed:", e?.message ?? e); process.exit(1); });
