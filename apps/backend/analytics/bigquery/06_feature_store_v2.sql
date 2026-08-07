-- ============================================================================
-- HOMIGO Phase 1 — Feature Store v2 (versioned, reproducible)
-- ============================================================================

-- Customer features
CREATE OR REPLACE VIEW `homigo-497619.homigo_analytics_feature.fs_customer_features_v2` AS
SELECT
  customer_hash,
  COUNT(*) AS booking_frequency,
  COUNTIF(is_cancelled) AS cancellations,
  SAFE_DIVIDE(COUNTIF(is_cancelled), COUNT(*)) AS cancellation_rate,
  SUM(total_amount) AS ltv,
  AVG(total_amount) AS avg_order_value,
  DATE_DIFF(CURRENT_DATE(), DATE(MIN(created_at)), DAY) AS tenure_days,
  DATE_DIFF(CURRENT_DATE(), DATE(MAX(created_at)), DAY) AS recency_days,
  CURRENT_TIMESTAMP() AS feature_generated_at
FROM `homigo-497619.homigo_analytics.fact_bookings`
WHERE customer_hash IS NOT NULL
GROUP BY customer_hash;

-- Partner features
CREATE OR REPLACE VIEW `homigo-497619.homigo_analytics_feature.fs_partner_features_v2` AS
SELECT
  p.provider_hash,
  p.acceptance_rate,
  p.cancellation_rate,
  p.rating,
  p.total_bookings AS utilization_proxy,
  p.city,
  COALESCE(SUM(b.total_amount), 0) AS revenue,
  CURRENT_TIMESTAMP() AS feature_generated_at
FROM `homigo-497619.homigo_analytics.dim_partner` p
LEFT JOIN `homigo-497619.homigo_analytics.fact_bookings` b ON b.provider_hash = p.provider_hash AND b.is_completed
GROUP BY p.provider_hash, p.acceptance_rate, p.cancellation_rate, p.rating, p.total_bookings, p.city;

-- Payment features
CREATE OR REPLACE VIEW `homigo-497619.homigo_analytics_feature.fs_payment_features_v2` AS
SELECT
  customer_hash,
  COUNT(*) AS total_payments,
  COUNTIF(status = 'SUCCESS') AS success_count,
  COUNTIF(status = 'FAILED') AS failure_count,
  SAFE_DIVIDE(COUNTIF(status = 'SUCCESS'), COUNT(*)) AS success_ratio,
  SAFE_DIVIDE(COUNTIF(status = 'FAILED'), COUNT(*)) AS failure_ratio,
  CURRENT_TIMESTAMP() AS feature_generated_at
FROM `homigo-497619.homigo_analytics.fact_payments`
WHERE customer_hash IS NOT NULL
GROUP BY customer_hash;

-- Finance features
CREATE OR REPLACE VIEW `homigo-497619.homigo_analytics_feature.fs_finance_features_v2` AS
SELECT
  DATE(created_at) AS txn_date,
  SUM(CAST(debit_paise AS INT64)) AS total_debits_paise,
  SUM(CAST(credit_paise AS INT64)) AS total_credits_paise,
  COUNT(*) AS entry_count,
  CURRENT_TIMESTAMP() AS feature_generated_at
FROM `homigo-497619.homigo_analytics.fact_ledger_entries`
GROUP BY txn_date;

-- Fraud features
CREATE OR REPLACE VIEW `homigo-497619.homigo_analytics_feature.fs_fraud_features_v2` AS
SELECT
  customer_hash,
  COUNT(*) AS signal_count,
  COUNT(DISTINCT signal_type) AS distinct_signal_types,
  MAX(created_at) AS last_signal_at,
  CURRENT_TIMESTAMP() AS feature_generated_at
FROM `homigo-497619.homigo_analytics.fact_fraud_signals`
WHERE customer_hash IS NOT NULL
GROUP BY customer_hash;

-- Geo features
CREATE OR REPLACE VIEW `homigo-497619.homigo_analytics_feature.fs_geo_features_v2` AS
SELECT
  city,
  COUNT(*) AS booking_count,
  AVG(dest_lat) AS avg_lat,
  AVG(dest_lng) AS avg_lng,
  COUNT(DISTINCT customer_hash) AS unique_customers,
  CURRENT_TIMESTAMP() AS feature_generated_at
FROM `homigo-497619.homigo_analytics.fact_bookings`
WHERE city IS NOT NULL
GROUP BY city;

-- Demand features (hourly/daily/weekly seasonality)
CREATE OR REPLACE VIEW `homigo-497619.homigo_analytics_feature.fs_demand_features_v2` AS
SELECT
  COALESCE(zone_id, 'unzoned') AS zone_id,
  city,
  EXTRACT(HOUR FROM hour_ts) AS hour_of_day,
  EXTRACT(DAYOFWEEK FROM hour_ts) AS day_of_week,
  AVG(bookings) AS hourly_demand,
  AVG(revenue) AS hourly_revenue,
  STDDEV(bookings) AS demand_volatility,
  CURRENT_TIMESTAMP() AS feature_generated_at
FROM `homigo-497619.homigo_analytics_analytics.agg_hourly_demand`
GROUP BY zone_id, city, hour_of_day, day_of_week;

-- ML Feature Sink staging (ETA labels from Phase 0 boundary)
CREATE TABLE IF NOT EXISTS `homigo-497619.homigo_analytics_feature.ml_eta_labels` (
  event_id STRING, booking_id STRING, provider_hash STRING,
  travel_duration_min FLOAT64, distance_km FLOAT64, google_eta_min FLOAT64,
  hour_of_day INT64, day_of_week INT64, city STRING, service_category STRING,
  ingested_at TIMESTAMP
) PARTITION BY DATE(ingested_at);

-- Extended data quality view
CREATE OR REPLACE VIEW `homigo-497619.homigo_analytics.dq_checks_v2` AS
SELECT
  (SELECT COUNT(*) FROM `homigo-497619.homigo_analytics.fact_bookings`) AS fact_bookings_rows,
  (SELECT COUNTIF(total_amount < 0) FROM `homigo-497619.homigo_analytics.fact_bookings`) AS negative_amounts,
  (SELECT COUNTIF(customer_hash IS NULL) FROM `homigo-497619.homigo_analytics.fact_bookings`) AS null_customer_hash,
  (SELECT COUNT(*) FROM `homigo-497619.homigo_analytics.fact_payments`) AS payment_rows,
  (SELECT COUNT(*) FROM (SELECT booking_id, COUNT(*) c FROM `homigo-497619.homigo_analytics.fact_bookings` GROUP BY booking_id HAVING c > 1)) AS duplicate_bookings,
  (SELECT COUNT(*) FROM (SELECT payment_id, COUNT(*) c FROM `homigo-497619.homigo_analytics.fact_payments` GROUP BY payment_id HAVING c > 1)) AS duplicate_payments,
  (SELECT COUNTIF(lat NOT BETWEEN -90 AND 90 OR lng NOT BETWEEN -180 AND 180) FROM `homigo-497619.homigo_analytics.fact_gps_pings`) AS invalid_coords,
  (SELECT MAX(loaded_at) FROM `homigo-497619.homigo_analytics.fact_bookings`) AS warehouse_freshness,
  CURRENT_TIMESTAMP() AS evaluated_at;
