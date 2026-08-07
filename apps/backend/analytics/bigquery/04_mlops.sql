-- ============================================================================
-- HOMIGO MLOps — Model Registry + Governance + Feature Store + Data Quality
-- ============================================================================

-- ---- Model Registry (Part A/B): one row per model, real metrics + lifecycle ----
CREATE TABLE IF NOT EXISTS `homigo-497619.homigo_analytics.model_registry` (
  model_name STRING, version STRING, model_type STRING, created_at TIMESTAMP,
  training_dataset STRING, training_rows INT64,
  status STRING,            -- TRAINED | PARTIALLY_TRAINED | BLOCKED
  lifecycle STRING,         -- production | staging | blocked
  owner STRING,
  metrics JSON,             -- real eval metrics (AIC/MAE/RMSE/R2/…)
  blocker_reason STRING,
  evaluated_at TIMESTAMP
);

-- ---- Feature Store (Part F): centralised, reusable feature views ----
CREATE OR REPLACE VIEW `homigo-497619.homigo_analytics.fs_provider_features` AS
SELECT zone_id, hour_of_day, day_of_week, active_providers, bookings, load_per_provider
FROM `homigo-497619.homigo_analytics.vw_provider_availability`;

CREATE OR REPLACE VIEW `homigo-497619.homigo_analytics.fs_booking_features` AS
SELECT city, category, hour_of_day, day_of_week,
       COUNT(*) AS bookings, COUNTIF(is_completed) AS completed, COUNTIF(is_cancelled) AS cancelled,
       AVG(total_amount) AS avg_amount, AVG(eta_min) AS avg_eta_min
FROM `homigo-497619.homigo_analytics.fact_bookings`
GROUP BY city, category, hour_of_day, day_of_week;

CREATE OR REPLACE VIEW `homigo-497619.homigo_analytics.fs_customer_features` AS
SELECT customer_hash, bookings, completed, lifetime_revenue, avg_order_value, tenure_days, recency_days, avg_interval_days, churned_30d
FROM `homigo-497619.homigo_analytics.vw_customer_churn_features`;

-- ---- Data Quality checks (Part G): one row of warehouse health ----
CREATE OR REPLACE VIEW `homigo-497619.homigo_analytics.dq_checks` AS
SELECT
  (SELECT COUNT(*) FROM `homigo-497619.homigo_analytics.fact_bookings`) AS fact_bookings_rows,
  (SELECT COUNTIF(total_amount < 0) FROM `homigo-497619.homigo_analytics.fact_bookings`) AS negative_amounts,
  (SELECT COUNTIF(customer_hash IS NULL) FROM `homigo-497619.homigo_analytics.fact_bookings`) AS null_customer_hash,
  (SELECT COUNT(*) FROM `homigo-497619.homigo_analytics.fact_gps_pings`) AS gps_rows,
  (SELECT COUNTIF(lat NOT BETWEEN -90 AND 90 OR lng NOT BETWEEN -180 AND 180) FROM `homigo-497619.homigo_analytics.fact_gps_pings`) AS invalid_coords,
  (SELECT MAX(loaded_at) FROM `homigo-497619.homigo_analytics.fact_bookings`) AS warehouse_freshness;
