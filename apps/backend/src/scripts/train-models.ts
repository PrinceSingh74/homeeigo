/**
 * Phase 1 model retraining — extends ARIMA_PLUS with multi-granularity forecasts.
 *   bun run --env-file=.env src/scripts/train-models.ts
 */
import { BigQuery } from "@google-cloud/bigquery";

const P = process.env.GCP_PROJECT_ID ?? "homigo-497619";
const D = process.env.BQ_DATASET ?? "homigo_analytics";
const LOC = process.env.BQ_LOCATION ?? "asia-south1";
const bq = new BigQuery({ projectId: P });
const run = async (sql: string) => (await bq.query({ query: sql, location: LOC }))[0];
const count = async (view: string) => Number((await run(`SELECT COUNT(*) AS n FROM \`${P}.${D}.${view}\``))[0].n);

async function trainArima(name: string, sql: string, minRows: number, view: string): Promise<void> {
  const rows = await count(view);
  if (rows >= minRows) {
    await run(sql);
    console.log(`✅ ${name} retrained (${rows} rows)`);
  } else {
    console.log(`⛔ ${name} BLOCKED — only ${rows} rows (need ${minRows})`);
  }
}

async function main() {
  console.log("HOMIGO Phase 1 model retraining — ARIMA_PLUS upgrade\n");

  await trainArima("model_demand_forecast (hourly/zone)",
    `CREATE OR REPLACE MODEL \`${P}.${D}.model_demand_forecast\` OPTIONS(model_type='ARIMA_PLUS', time_series_timestamp_col='hour_ts', time_series_data_col='demand', time_series_id_col='zone_id', horizon=168, auto_arima=TRUE, data_frequency='HOURLY', holiday_region='IN', clean_spikes_and_dips=TRUE) AS SELECT zone_id, hour_ts, demand FROM \`${P}.${D}.vw_train_demand\``,
    24, "vw_train_demand");

  await trainArima("model_demand_forecast_daily",
    `CREATE OR REPLACE MODEL \`${P}.${D}.model_demand_forecast_daily\` OPTIONS(model_type='ARIMA_PLUS', time_series_timestamp_col='ts', time_series_data_col='demand', time_series_id_col='zone_id', horizon=30, auto_arima=TRUE, data_frequency='DAILY', holiday_region='IN') AS SELECT zone_id, ts, demand FROM \`${P}.${D}.vw_train_demand_daily\``,
    14, "vw_train_demand_daily");

  await trainArima("model_demand_forecast_weekly",
    `CREATE OR REPLACE MODEL \`${P}.${D}.model_demand_forecast_weekly\` OPTIONS(model_type='ARIMA_PLUS', time_series_timestamp_col='ts', time_series_data_col='demand', time_series_id_col='zone_id', horizon=12, auto_arima=TRUE, data_frequency='WEEKLY') AS SELECT zone_id, ts, demand FROM \`${P}.${D}.vw_train_demand_weekly\``,
    8, "vw_train_demand_weekly");

  await trainArima("model_city_demand_forecast",
    `CREATE OR REPLACE MODEL \`${P}.${D}.model_city_demand_forecast\` OPTIONS(model_type='ARIMA_PLUS', time_series_timestamp_col='hour_ts', time_series_data_col='demand', time_series_id_col='city', horizon=168, auto_arima=TRUE, data_frequency='HOURLY', holiday_region='IN') AS SELECT city, hour_ts, demand FROM \`${P}.${D}.vw_train_city_demand\``,
    24, "vw_train_city_demand");

  await trainArima("model_partner_earnings_forecast",
    `CREATE OR REPLACE MODEL \`${P}.${D}.model_partner_earnings_forecast\` OPTIONS(model_type='ARIMA_PLUS', time_series_timestamp_col='hour_ts', time_series_data_col='revenue', time_series_id_col='zone_id', horizon=168, auto_arima=TRUE, data_frequency='HOURLY') AS SELECT COALESCE(zone_id,'all') AS zone_id, hour_ts, COALESCE(revenue,0) AS revenue FROM \`${P}.${D}_analytics.agg_hourly_demand\``,
    24, "agg_hourly_demand");

  await trainArima("model_revenue_forecast",
    `CREATE OR REPLACE MODEL \`${P}.${D}.model_revenue_forecast\` OPTIONS(model_type='ARIMA_PLUS', time_series_timestamp_col='hour_ts', time_series_data_col='revenue', time_series_id_col='zone_id', horizon=168, auto_arima=TRUE, data_frequency='HOURLY') AS SELECT COALESCE(zone_id,'all') AS zone_id, hour_ts, COALESCE(revenue,0) AS revenue FROM \`${P}.${D}_analytics.agg_hourly_demand\``,
    24, "agg_hourly_demand");

  const clvRows = await count("vw_customer_clv");
  if (clvRows >= 10) {
    await run(`CREATE OR REPLACE MODEL \`${P}.${D}.model_clv\` OPTIONS(model_type='LINEAR_REG', input_label_cols=['lifetime_revenue']) AS SELECT bookings, completed, tenure_days, recency_days, avg_order_value, lifetime_revenue FROM \`${P}.${D}.vw_customer_clv\` WHERE lifetime_revenue IS NOT NULL`);
    console.log(`⚠️  model_clv retrained (${clvRows} rows) — PARTIAL: validate on holdout`);
  } else console.log(`⛔ model_clv BLOCKED — only ${clvRows} rows`);

  const etaRows = await count("vw_train_eta");
  console.log(etaRows >= 50 ? `✅ model_eta trainable (${etaRows} rows)` : `⛔ model_eta BLOCKED — ${etaRows} labelled rows`);

  console.log("\nDone. Run ML.EVALUATE and update model_registry with fresh metrics.");
  process.exit(0);
}
main().catch((e) => { console.error("retrain failed:", e?.message ?? e); process.exit(1); });
