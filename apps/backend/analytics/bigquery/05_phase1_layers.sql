-- ============================================================================
-- HOMIGO Phase 1 — Multi-layer Warehouse (Raw / Validated / Curated / Feature / Analytics)
-- Project: homigo-497619   Location: asia-south1
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS `homigo-497619.homigo_analytics_raw`
  OPTIONS (location = "asia-south1", description = "Raw ingestion layer — append-only, minimal transforms");

CREATE SCHEMA IF NOT EXISTS `homigo-497619.homigo_analytics_validated`
  OPTIONS (location = "asia-south1", description = "DQ-validated layer — quarantine-ready");

CREATE SCHEMA IF NOT EXISTS `homigo-497619.homigo_analytics_feature`
  OPTIONS (location = "asia-south1", description = "Versioned ML feature store views");

CREATE SCHEMA IF NOT EXISTS `homigo-497619.homigo_analytics_analytics`
  OPTIONS (location = "asia-south1", description = "Curated aggregates for dashboards and forecasting");

-- ---- Raw layer tables -------------------------------------------------------
CREATE TABLE IF NOT EXISTS `homigo-497619.homigo_analytics_raw.fact_notifications` (
  notification_id STRING, user_hash STRING, type STRING, is_read BOOL,
  created_at TIMESTAMP, loaded_at TIMESTAMP
) PARTITION BY DATE(created_at) OPTIONS (partition_expiration_days = 365);

CREATE TABLE IF NOT EXISTS `homigo-497619.homigo_analytics_raw.fact_scheduled_jobs` (
  job_id STRING, job_type STRING, status STRING, run_at TIMESTAMP,
  attempts INT64, created_at TIMESTAMP, completed_at TIMESTAMP, loaded_at TIMESTAMP
) PARTITION BY DATE(created_at) OPTIONS (partition_expiration_days = 180);

CREATE TABLE IF NOT EXISTS `homigo-497619.homigo_analytics_raw.fact_domain_events` (
  outbox_id STRING, event_id STRING, event_type STRING, aggregate_type STRING,
  aggregate_id STRING, published_at TIMESTAMP, created_at TIMESTAMP, loaded_at TIMESTAMP
) PARTITION BY DATE(created_at) OPTIONS (partition_expiration_days = 90);

CREATE TABLE IF NOT EXISTS `homigo-497619.homigo_analytics_raw.fact_audit_logs` (
  audit_id STRING, action STRING, actor_hash STRING, actor_type STRING,
  resource_type STRING, resource_id STRING, created_at TIMESTAMP, loaded_at TIMESTAMP
) PARTITION BY DATE(created_at) OPTIONS (partition_expiration_days = 2555);

-- ---- Curated layer extensions (homigo_analytics) ------------------------------
CREATE TABLE IF NOT EXISTS `homigo-497619.homigo_analytics.dim_partner` (
  provider_hash STRING, user_hash STRING, is_verified BOOL, is_active BOOL,
  rating FLOAT64, total_bookings INT64, acceptance_rate FLOAT64, cancellation_rate FLOAT64,
  city STRING, created_at TIMESTAMP, updated_at TIMESTAMP, loaded_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS `homigo-497619.homigo_analytics.dim_customer` (
  customer_hash STRING, city STRING, created_at TIMESTAMP, updated_at TIMESTAMP, loaded_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS `homigo-497619.homigo_analytics.fact_payments` (
  payment_id STRING, booking_id STRING, customer_hash STRING, amount FLOAT64,
  amount_paise STRING, status STRING, method STRING, created_at TIMESTAMP, updated_at TIMESTAMP, loaded_at TIMESTAMP
) PARTITION BY DATE(created_at) CLUSTER BY status;

CREATE TABLE IF NOT EXISTS `homigo-497619.homigo_analytics.fact_wallet_txns` (
  txn_id STRING, customer_hash STRING, amount FLOAT64, type STRING,
  description STRING, created_at TIMESTAMP, loaded_at TIMESTAMP
) PARTITION BY DATE(created_at);

CREATE TABLE IF NOT EXISTS `homigo-497619.homigo_analytics.fact_ledger_entries` (
  entry_id STRING, account_id STRING, journal_id STRING,
  debit_paise STRING, credit_paise STRING, created_at TIMESTAMP, loaded_at TIMESTAMP
) PARTITION BY DATE(created_at);

CREATE TABLE IF NOT EXISTS `homigo-497619.homigo_analytics.fact_fraud_signals` (
  signal_id STRING, customer_hash STRING, signal_type STRING,
  reference_id STRING, reference_type STRING, city STRING, created_at TIMESTAMP, loaded_at TIMESTAMP
) PARTITION BY DATE(created_at);

CREATE TABLE IF NOT EXISTS `homigo-497619.homigo_analytics.fact_reviews` (
  review_id STRING, booking_id STRING, customer_hash STRING, provider_hash STRING,
  stars INT64, created_at TIMESTAMP, loaded_at TIMESTAMP
) PARTITION BY DATE(created_at);

CREATE TABLE IF NOT EXISTS `homigo-497619.homigo_analytics.fact_referrals` (
  referral_id STRING, referrer_hash STRING, referred_hash STRING,
  status STRING, fraud_flagged BOOL, created_at TIMESTAMP, loaded_at TIMESTAMP
) PARTITION BY DATE(created_at);

CREATE TABLE IF NOT EXISTS `homigo-497619.homigo_analytics.fact_hcoin_txns` (
  txn_id STRING, customer_hash STRING, amount INT64, type STRING,
  reason STRING, created_at TIMESTAMP, loaded_at TIMESTAMP
) PARTITION BY DATE(created_at);

-- ---- Analytics aggregates ---------------------------------------------------
CREATE TABLE IF NOT EXISTS `homigo-497619.homigo_analytics_analytics.agg_hourly_demand` (
  zone_id STRING, city STRING, hour_ts TIMESTAMP NOT NULL,
  bookings INT64, completed INT64, cancelled INT64, revenue FLOAT64,
  avg_eta_min FLOAT64, avg_surge FLOAT64, loaded_at TIMESTAMP
) PARTITION BY DATE(hour_ts) CLUSTER BY zone_id
OPTIONS (partition_expiration_days = 730);

CREATE TABLE IF NOT EXISTS `homigo-497619.homigo_analytics_analytics.agg_daily_demand` (
  zone_id STRING, city STRING, day_ts DATE NOT NULL,
  bookings INT64, completed INT64, revenue FLOAT64, loaded_at TIMESTAMP
) PARTITION BY day_ts CLUSTER BY city;

CREATE TABLE IF NOT EXISTS `homigo-497619.homigo_analytics_analytics.agg_weekly_demand` (
  zone_id STRING, city STRING, week_ts DATE NOT NULL,
  bookings INT64, completed INT64, revenue FLOAT64, loaded_at TIMESTAMP
) PARTITION BY week_ts;

CREATE TABLE IF NOT EXISTS `homigo-497619.homigo_analytics_analytics.agg_monthly_demand` (
  zone_id STRING, city STRING, month_ts DATE NOT NULL,
  bookings INT64, completed INT64, revenue FLOAT64, loaded_at TIMESTAMP
) PARTITION BY month_ts;

-- ---- Validated views (pass-through from curated with DQ filters) ------------
CREATE OR REPLACE VIEW `homigo-497619.homigo_analytics_validated.v_bookings_clean` AS
SELECT * FROM `homigo-497619.homigo_analytics.fact_bookings`
WHERE customer_hash IS NOT NULL AND (total_amount IS NULL OR total_amount >= 0)
  AND created_at <= CURRENT_TIMESTAMP();

CREATE OR REPLACE VIEW `homigo-497619.homigo_analytics_validated.v_payments_clean` AS
SELECT * FROM `homigo-497619.homigo_analytics.fact_payments`
WHERE customer_hash IS NOT NULL AND (amount IS NULL OR amount >= 0);
